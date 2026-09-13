/**
 * The fixture set: every file, its expected report type, and machine-readable ground truth
 * (SPEC §16). Clean exports for every company and month; messy variants covering every export
 * quirk; deliberately broken variants for validation.
 */

import { generateBooks, type Books } from "./books";
import { COMPANIES } from "./companies";
import { dayOf, daysInMonth, monthKey, type CompanySpec } from "./model";
import {
  balanceSheet,
  balanceTree,
  dayBook,
  fyToDateStart,
  groupSummary,
  ledgerVouchers,
  outstandingBills,
  paySheet,
  profitAndLoss,
  register,
  reportBalance,
  stockSummary,
  trialBalance,
  PL_LEDGER,
  type TbOptions,
} from "./reports";
import { toCsv, toXlsx, type Table } from "./table";

export type ExpectedReport =
  | "trial_balance"
  | "profit_and_loss"
  | "balance_sheet"
  | "group_summary"
  | "ledger_vouchers"
  | "day_book"
  | "sales_register"
  | "purchase_register"
  | "stock_summary"
  | "bills_receivable"
  | "bills_payable"
  | "pay_sheet";

export type Broken =
  | "unbalanced_tb"
  | "subtotal_mismatch"
  | "duplicate_period"
  | "missing_month"
  | "backdated_change";

/** Ground truth for one file, in paise as decimal strings where amounts are involved. */
export type FileTruth =
  | {
      readonly kind: "trial_balance";
      readonly ledgers: readonly {
        path: readonly string[];
        opening: string;
        debit: string;
        credit: string;
        closing: string;
      }[];
      readonly columns: "closing" | "full";
    }
  | {
      readonly kind: "group_summary";
      readonly ledgers: readonly { name: string; closing: string }[];
    }
  | { readonly kind: "profit_and_loss"; readonly netProfit: string }
  | { readonly kind: "balance_sheet"; readonly total: string }
  | {
      readonly kind: "vouchers";
      readonly lines: number;
      readonly debit: string;
      readonly credit: string;
    }
  | {
      readonly kind: "ledger_vouchers";
      readonly debit: string;
      readonly credit: string;
      readonly entries: number;
    }
  | {
      readonly kind: "register";
      readonly vouchers: number;
      readonly taxable: string;
      readonly cgst: string;
      readonly sgst: string;
      readonly igst: string;
    }
  | {
      readonly kind: "bills";
      readonly bills: number;
      readonly pending: string;
      readonly byParty: Readonly<Record<string, string>>;
    }
  | { readonly kind: "stock"; readonly items: number; readonly value: string }
  | { readonly kind: "pay"; readonly employees: number; readonly net: string };

export interface FixtureFile {
  readonly company: string;
  readonly name: string;
  readonly format: "xlsx" | "csv";
  readonly report: ExpectedReport;
  readonly period: { from: string; to: string };
  readonly variant: string;
  readonly quirks: readonly string[];
  readonly broken?: Broken;
  readonly truth: FileTruth;
  bytes(): Uint8Array;
}

export interface CompanyTruth {
  readonly company: string;
  readonly name: string;
  readonly kind: CompanySpec["kind"];
  readonly months: readonly string[];
  readonly ledgers: readonly {
    id: string;
    name: string;
    path: readonly string[];
    nature: string;
  }[];
  /** ledger id → month → balances (paise strings). */
  readonly balances: Readonly<
    Record<
      string,
      Readonly<
        Record<
          string,
          { opening: string; debit: string; credit: string; closing: string }
        >
      >
    >
  >;
  readonly statements: Readonly<
    Record<
      string,
      {
        netProfitFytd: string;
        balanceSheetTotal: string;
        salesTaxable: string;
        closingStock: string;
        netPay: string;
      }
    >
  >;
  /** Periods whose files are deliberately absent or duplicated in the broken set. */
  readonly brokenSet: {
    readonly missingMonth: string;
    readonly duplicatePeriod: string;
    readonly backdatedMonth: string;
  };
}

const s = (n: bigint) => n.toString();

function tbTruth(
  books: Books,
  from: string,
  to: string,
  columns: "closing" | "full",
): FileTruth {
  const ledgers: {
    path: string[];
    opening: string;
    debit: string;
    credit: string;
    closing: string;
  }[] = [];
  const walk = (nodes: ReturnType<typeof balanceTree>, parents: string[]) => {
    for (const n of nodes) {
      if (n.kind === "ledger")
        ledgers.push({
          path: [...parents, n.name],
          opening: s(n.bal.opening),
          debit: s(n.bal.debit),
          credit: s(n.bal.credit),
          closing: s(n.bal.closing),
        });
      else walk(n.children, [...parents, n.name]);
    }
  };
  walk(balanceTree(books, from, to, undefined, columns === "closing"), []);
  return { kind: "trial_balance", ledgers, columns };
}

function file(
  company: CompanySpec,
  parts: {
    report: ExpectedReport;
    month: string;
    to?: string;
    from?: string;
    fromDay?: string;
    variant: string;
    format: "xlsx" | "csv";
    quirks?: string[];
    broken?: Broken;
    suffix?: string;
  },
  table: () => Table,
  truth: FileTruth,
): FixtureFile {
  const to = parts.to ?? parts.month;
  const name = `${company.id}/${parts.variant}/${parts.report}_${parts.month}${parts.suffix ?? ""}.${parts.format}`;
  return {
    company: company.id,
    name,
    format: parts.format,
    report: parts.report,
    period: {
      from: parts.fromDay ?? dayOf(parts.from ?? parts.month, 1),
      to: dayOf(to, daysInMonth(to)),
    },
    variant: parts.variant,
    quirks: parts.quirks ?? [],
    ...(parts.broken === undefined ? {} : { broken: parts.broken }),
    truth,
    bytes: () => (parts.format === "xlsx" ? toXlsx([table()]) : toCsv(table())),
  };
}

export interface FixtureSet {
  readonly files: readonly FixtureFile[];
  readonly truths: readonly CompanyTruth[];
  readonly books: readonly Books[];
}

export function buildFixtureSet(
  options: { companies?: readonly string[]; months?: number } = {},
): FixtureSet {
  const files: FixtureFile[] = [];
  const truths: CompanyTruth[] = [];
  const allBooks: Books[] = [];

  for (const company of COMPANIES().filter(
    (c) => options.companies === undefined || options.companies.includes(c.id),
  )) {
    const books = generateBooks(company);
    allBooks.push(books);
    const months = books.months.slice(0, options.months ?? books.months.length);
    const bankId = company.ledgers.some((l) => l.id === "bank2") ? "bank2" : "bank";

    for (const m of months) {
      const clean = "clean";
      const tbO: TbOptions = {
        layout: "indent",
        amounts: "split",
        columns: "full",
        grouping: "indian",
      };
      files.push(
        file(
          company,
          {
            report: "trial_balance",
            month: m,
            variant: clean,
            format: "xlsx",
            quirks: ["title_rows", "indentation", "two_level_header", "grand_total"],
          },
          () => trialBalance(books, m, m, tbO),
          tbTruth(books, m, m, "full"),
        ),
      );

      const pl = profitAndLoss(books, m, "horizontal", "indian");
      files.push(
        file(
          company,
          {
            report: "profit_and_loss",
            month: m,
            from: fyToDateStart(books, m),
            variant: clean,
            format: "xlsx",
            quirks: ["horizontal"],
          },
          () => pl.table,
          { kind: "profit_and_loss", netProfit: s(pl.netProfit) },
        ),
      );
      const bs = balanceSheet(books, m, "indian");
      files.push(
        file(
          company,
          {
            report: "balance_sheet",
            month: m,
            variant: clean,
            format: "xlsx",
            quirks: ["horizontal", "as_at"],
          },
          () => bs.table,
          { kind: "balance_sheet", total: s(bs.total) },
        ),
      );

      const debtors = company.ledgers.filter((l) => l.group === "Sundry Debtors");
      files.push(
        file(
          company,
          {
            report: "group_summary",
            month: m,
            variant: clean,
            format: "csv",
            quirks: ["csv"],
          },
          () => groupSummary(books, "Sundry Debtors", m, "indian"),
          {
            kind: "group_summary",
            ledgers: debtors
              .map((d) => ({
                name: d.name,
                closing: s(reportBalance(books, d.id, m, m).closing),
              }))
              .filter((d) => d.closing !== "0"),
          },
        ),
      );

      const inMonth = books.vouchers.filter((v) => monthKey(v.date) === m);
      const entries = inMonth.flatMap((v) => v.entries);
      files.push(
        file(
          company,
          {
            report: "day_book",
            month: m,
            variant: clean,
            format: "xlsx",
            quirks: ["multi_line_vouchers"],
          },
          () => dayBook(books, dayOf(m, 1), dayOf(m, daysInMonth(m)), "indian"),
          {
            kind: "vouchers",
            lines: entries.length,
            debit: s(entries.reduce((a, e) => a + (e.amount > 0n ? e.amount : 0n), 0n)),
            credit: s(entries.reduce((a, e) => a + (e.amount < 0n ? -e.amount : 0n), 0n)),
          },
        ),
      );

      const bankBal = reportBalance(books, bankId, m, m);
      files.push(
        file(
          company,
          {
            report: "ledger_vouchers",
            month: m,
            variant: clean,
            format: "csv",
            quirks: ["opening_closing_rows"],
          },
          () => ledgerVouchers(books, bankId, m, "international"),
          {
            kind: "ledger_vouchers",
            debit: s(bankBal.debit),
            credit: s(bankBal.credit),
            entries: inMonth.filter((v) => v.entries.some((e) => e.ledger === bankId))
              .length,
          },
        ),
      );

      for (const kind of ["Sales", "Purchase"] as const) {
        const vs = inMonth.filter((v) => v.type === kind);
        const sum = (f: "taxable" | "cgst" | "sgst" | "igst") =>
          s(vs.reduce((a, v) => a + (v[f] ?? 0n), 0n));
        files.push(
          file(
            company,
            {
              report: kind === "Sales" ? "sales_register" : "purchase_register",
              month: m,
              variant: clean,
              format: kind === "Sales" ? "csv" : "xlsx",
            },
            () => register(books, kind, m, "indian"),
            {
              kind: "register",
              vouchers: vs.length,
              taxable: sum("taxable"),
              cgst: sum("cgst"),
              sgst: sum("sgst"),
              igst: sum("igst"),
            },
          ),
        );
      }

      for (const side of ["receivable", "payable"] as const) {
        const asAt = dayOf(m, daysInMonth(m));
        const open = books.bills.filter(
          (b) =>
            b.side === side &&
            b.date <= asAt &&
            (b.settledOn === null || b.settledOn > asAt),
        );
        const byParty: Record<string, string> = {};
        for (const b of open) {
          const name = books.ledger(b.party).name;
          byParty[name] = (BigInt(byParty[name] ?? "0") + b.amount).toString();
        }
        files.push(
          file(
            company,
            {
              report: side === "receivable" ? "bills_receivable" : "bills_payable",
              month: m,
              variant: clean,
              format: side === "receivable" ? "xlsx" : "csv",
              quirks:
                side === "receivable"
                  ? ["party_headings", "dr_cr_suffix"]
                  : ["party_column", "dr_cr_suffix"],
            },
            () => outstandingBills(books, side, m, "indian", side === "receivable"),
            {
              kind: "bills",
              bills: open.length,
              pending: s(open.reduce((a, b) => a + b.amount, 0n)),
              byParty,
            },
          ),
        );
      }

      if (company.items.length > 0) {
        const lines = books.stock.get(m) ?? [];
        files.push(
          file(
            company,
            { report: "stock_summary", month: m, variant: clean, format: "xlsx" },
            () => stockSummary(books, m, "indian"),
            {
              kind: "stock",
              items: lines.length,
              value: s(lines.reduce((a, l) => a + l.value, 0n)),
            },
          ),
        );
      }
      const pay = books.payroll.get(m) ?? [];
      files.push(
        file(
          company,
          { report: "pay_sheet", month: m, variant: clean, format: "csv" },
          () => paySheet(books, m, "indian"),
          {
            kind: "pay",
            employees: pay.length,
            net: s(pay.reduce((a, p) => a + p.net, 0n)),
          },
        ),
      );
    }

    // Messy variants, on the first quarter of each company.
    for (const m of months.slice(0, 3)) {
      const messy: [string, TbOptions, "xlsx" | "csv", string[]][] = [
        [
          "messy_level_column",
          {
            layout: "level_column",
            amounts: "split",
            columns: "closing",
            grouping: "indian",
          },
          "csv",
          ["level_column"],
        ],
        [
          "messy_subtotal_rows",
          {
            layout: "subtotal_rows",
            amounts: "split",
            columns: "closing",
            grouping: "indian",
            blankSeparators: true,
          },
          "xlsx",
          ["subtotal_rows", "blank_separators"],
        ],
        [
          "messy_suffix",
          { layout: "indent", amounts: "suffix", columns: "closing", grouping: "indian" },
          "csv",
          ["dr_cr_suffix", "single_amount_column"],
        ],
        [
          "messy_parent_column",
          {
            layout: "parent_column",
            amounts: "split",
            columns: "full",
            grouping: "international",
          },
          "csv",
          ["parent_column", "international_grouping"],
        ],
        [
          "messy_wrapped",
          {
            layout: "indent",
            amounts: "split",
            columns: "closing",
            grouping: "plain",
            wrapLongNames: true,
            blankSeparators: true,
          },
          "xlsx",
          ["wrapped_names", "blank_separators", "plain_numbers"],
        ],
        [
          "messy_truncated",
          {
            layout: "indent",
            amounts: "split",
            columns: "closing",
            grouping: "indian",
            truncateLongNames: true,
          },
          "csv",
          ["truncated_names"],
        ],
      ];
      for (const [variant, o, format, quirks] of messy) {
        files.push(
          file(
            company,
            { report: "trial_balance", month: m, variant, format, quirks },
            () => trialBalance(books, m, m, o),
            tbTruth(books, m, m, o.columns),
          ),
        );
      }
      const pv = profitAndLoss(books, m, "vertical", "international");
      files.push(
        file(
          company,
          {
            report: "profit_and_loss",
            month: m,
            from: fyToDateStart(books, m),
            variant: "messy_vertical",
            format: "csv",
            quirks: ["vertical"],
          },
          () => pv.table,
          { kind: "profit_and_loss", netProfit: s(pv.netProfit) },
        ),
      );

      // A period split across two files: the day book for 1–15 and 16–end.
      const mid = dayOf(m, 15);
      for (const [suffix, fromDay, toDay] of [
        ["_part1", dayOf(m, 1), mid],
        ["_part2", dayOf(m, 16), dayOf(m, daysInMonth(m))],
      ] as const) {
        const es = books.vouchers
          .filter((v) => v.date >= fromDay && v.date <= toDay)
          .flatMap((v) => v.entries);
        files.push(
          file(
            company,
            {
              report: "day_book",
              month: m,
              variant: "messy_split_period",
              format: "xlsx",
              quirks: ["period_split_across_files"],
              suffix,
              fromDay,
            },
            () => dayBook(books, fromDay, toDay, "indian"),
            {
              kind: "vouchers",
              lines: es.length,
              debit: s(es.reduce((a, e) => a + (e.amount > 0n ? e.amount : 0n), 0n)),
              credit: s(es.reduce((a, e) => a + (e.amount < 0n ? -e.amount : 0n), 0n)),
            },
          ),
        );
      }
      // A quarter-to-date TB spanning three months.
      if (m === months[2]) {
        const q0 = months[0] ?? m;
        files.push(
          file(
            company,
            {
              report: "trial_balance",
              month: q0,
              to: m,
              variant: "messy_multi_month",
              format: "xlsx",
              quirks: ["multi_month_period"],
              suffix: `_to_${m}`,
            },
            () =>
              trialBalance(books, q0, m, {
                layout: "indent",
                amounts: "split",
                columns: "full",
                grouping: "indian",
              }),
            tbTruth(books, q0, m, "full"),
          ),
        );
      }
    }

    // Broken variants (trading company only, SPEC §16).
    const brokenSet = {
      missingMonth: months[5] ?? "",
      duplicatePeriod: months[3] ?? "",
      backdatedMonth: months[1] ?? "",
    };
    if (company.id === "trading" && months.length >= 6) {
      const base: TbOptions = {
        layout: "indent",
        amounts: "split",
        columns: "closing",
        grouping: "indian",
      };
      const m0 = months[0] ?? "";
      files.push(
        file(
          company,
          {
            report: "trial_balance",
            month: m0,
            variant: "broken",
            format: "xlsx",
            broken: "unbalanced_tb",
            suffix: "_unbalanced",
          },
          () => trialBalance(books, m0, m0, { ...base, corruptLedger: 100n }),
          tbTruth(books, m0, m0, "closing"),
        ),
      );
      files.push(
        file(
          company,
          {
            report: "trial_balance",
            month: m0,
            variant: "broken",
            format: "xlsx",
            broken: "subtotal_mismatch",
            suffix: "_subtotal_mismatch",
          },
          () => trialBalance(books, m0, m0, { ...base, corruptSubtotal: 5_000n }),
          tbTruth(books, m0, m0, "closing"),
        ),
      );
      const dup = brokenSet.duplicatePeriod;
      files.push(
        file(
          company,
          {
            report: "trial_balance",
            month: dup,
            variant: "broken",
            format: "xlsx",
            broken: "duplicate_period",
            suffix: "_copy",
          },
          () => trialBalance(books, dup, dup, { ...base, corruptLedger: 25_000n }),
          tbTruth(books, dup, dup, "closing"),
        ),
      );
      const back = brokenSet.backdatedMonth;
      files.push(
        file(
          company,
          {
            report: "trial_balance",
            month: back,
            variant: "broken",
            format: "xlsx",
            broken: "backdated_change",
            suffix: "_revised",
          },
          () => trialBalance(books, back, back, { ...base, corruptLedger: -75_000n }),
          tbTruth(books, back, back, "closing"),
        ),
      );
    }

    const balancesTruth: Record<
      string,
      Record<string, { opening: string; debit: string; credit: string; closing: string }>
    > = {};
    for (const l of company.ledgers) {
      const per: Record<
        string,
        { opening: string; debit: string; credit: string; closing: string }
      > = {};
      for (const m of months) {
        const b = books.balances.get(l.id)?.get(m);
        if (b)
          per[m] = {
            opening: s(b.opening),
            debit: s(b.debit),
            credit: s(b.credit),
            closing: s(b.closing),
          };
      }
      balancesTruth[l.id] = per;
    }
    const statements: CompanyTruth["statements"] = Object.fromEntries(
      months.map((m) => [
        m,
        {
          netProfitFytd: s(profitAndLoss(books, m, "horizontal", "indian").netProfit),
          balanceSheetTotal: s(balanceSheet(books, m, "indian").total),
          salesTaxable: s(
            books.vouchers
              .filter((v) => v.type === "Sales" && monthKey(v.date) === m)
              .reduce((a, v) => a + (v.taxable ?? 0n), 0n),
          ),
          closingStock: s((books.stock.get(m) ?? []).reduce((a, l) => a + l.value, 0n)),
          netPay: s((books.payroll.get(m) ?? []).reduce((a, p) => a + p.net, 0n)),
        },
      ]),
    );
    truths.push({
      company: company.id,
      name: company.name,
      kind: company.kind,
      months,
      ledgers: [
        ...company.ledgers.map((l) => ({
          id: l.id,
          name: l.name,
          path: [...books.groupPath(l.id), l.name],
          nature: books.nature(l.id),
        })),
        { id: "pl", name: PL_LEDGER, path: [PL_LEDGER], nature: "liability" },
      ],
      balances: balancesTruth,
      statements,
      brokenSet,
    });
  }
  return { files, truths, books: allBooks };
}
