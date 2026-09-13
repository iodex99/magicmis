/**
 * Generate a company's books: balanced vouchers for every month, bill-wise outstandings,
 * month-end stock and payroll, and ledger × month balances. Every voucher's entries sum to
 * zero, which is asserted as it is created.
 */

import {
  addDays,
  addMonths,
  dayOf,
  daysInMonth,
  gst18,
  monthKey,
  pick,
  prng,
  randInt,
  randRupees,
  type Bill,
  type CompanySpec,
  type Entry,
  type LedgerDef,
  type Nature,
  type Voucher,
} from "./model";

export interface MonthBalance {
  readonly opening: bigint;
  readonly debit: bigint;
  readonly credit: bigint;
  readonly closing: bigint;
}

export interface StockLine {
  readonly item: string;
  readonly unit: string;
  readonly quantity: number;
  readonly rate: bigint;
  readonly value: bigint;
}

export interface PayLine {
  readonly code: string;
  readonly name: string;
  readonly designation: string;
  readonly basic: bigint;
  readonly hra: bigint;
  readonly gross: bigint;
  readonly pf: bigint;
  readonly tds: bigint;
  readonly net: bigint;
}

export interface Books {
  readonly company: CompanySpec;
  readonly months: readonly string[];
  readonly vouchers: readonly Voucher[];
  readonly bills: readonly Bill[];
  readonly balances: ReadonlyMap<string, ReadonlyMap<string, MonthBalance>>;
  readonly stock: ReadonlyMap<string, readonly StockLine[]>;
  readonly payroll: ReadonlyMap<string, readonly PayLine[]>;
  ledger(id: string): LedgerDef;
  /** Group chain from Tally primary group down to the ledger's own group. */
  groupPath(ledgerId: string): readonly string[];
  nature(ledgerId: string): Nature;
}

const PREDEFINED_PARENTS: Readonly<Record<string, string | null>> = {
  "Branch / Divisions": null,
  "Capital Account": null,
  "Current Assets": null,
  "Current Liabilities": null,
  "Fixed Assets": null,
  Investments: null,
  "Loans (Liability)": null,
  "Misc. Expenses (ASSET)": null,
  "Suspense A/c": null,
  "Direct Expenses": null,
  "Direct Incomes": null,
  "Indirect Expenses": null,
  "Indirect Incomes": null,
  "Purchase Accounts": null,
  "Sales Accounts": null,
  "Bank Accounts": "Current Assets",
  "Bank OD A/c": "Loans (Liability)",
  "Cash-in-hand": "Current Assets",
  "Deposits (Asset)": "Current Assets",
  "Duties & Taxes": "Current Liabilities",
  "Loans & Advances (Asset)": "Current Assets",
  Provisions: "Current Liabilities",
  "Reserves & Surplus": "Capital Account",
  "Secured Loans": "Loans (Liability)",
  "Stock-in-hand": "Current Assets",
  "Sundry Creditors": "Current Liabilities",
  "Sundry Debtors": "Current Assets",
  "Unsecured Loans": "Loans (Liability)",
};

const PRIMARY_NATURE: Readonly<Record<string, Nature>> = {
  "Branch / Divisions": "liability",
  "Capital Account": "liability",
  "Current Assets": "asset",
  "Current Liabilities": "liability",
  "Fixed Assets": "asset",
  Investments: "asset",
  "Loans (Liability)": "liability",
  "Misc. Expenses (ASSET)": "asset",
  "Suspense A/c": "liability",
  "Direct Expenses": "expense",
  "Direct Incomes": "income",
  "Indirect Expenses": "expense",
  "Indirect Incomes": "income",
  "Purchase Accounts": "expense",
  "Sales Accounts": "income",
};

export function generateBooks(company: CompanySpec): Books {
  const rand = prng(company.seed);
  const byId = new Map(company.ledgers.map((l) => [l.id, l]));
  const ledger = (id: string): LedgerDef => {
    const l = byId.get(id);
    if (!l) throw new Error(`unknown ledger ${id}`);
    return l;
  };
  const customParents = new Map(company.groups.map((g) => [g.name, g.parent]));
  const groupChain = (group: string): string[] => {
    const chain: string[] = [];
    let g: string | null = group;
    while (g !== null) {
      chain.unshift(g);
      g =
        g in PREDEFINED_PARENTS
          ? (PREDEFINED_PARENTS[g] ?? null)
          : (customParents.get(g) ?? null);
    }
    return chain;
  };
  const groupPath = (id: string) => groupChain(ledger(id).group);
  const nature = (id: string): Nature => {
    const primary = groupPath(id)[0] ?? "";
    const n = PRIMARY_NATURE[primary];
    if (!n) throw new Error(`no nature for ${primary}`);
    return n;
  };

  const months = Array.from({ length: company.months }, (_, i) =>
    addMonths(monthKey(company.booksStart), i),
  );
  const vouchers: Voucher[] = [];
  const bills: Bill[] = [];
  const counters = new Map<string, number>();
  const nextNo = (prefix: string, fy: string) => {
    const key = `${prefix}${fy}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return `${prefix}/${fy}/${n.toString().padStart(4, "0")}`;
  };
  const fyOf = (m: string) => {
    const [y = 0, mo = 1] = m.split("-").map((p) => Number.parseInt(p, 10));
    const start = mo >= 4 ? y : y - 1;
    return `${(start % 100).toString().padStart(2, "0")}-${((start + 1) % 100).toString().padStart(2, "0")}`;
  };
  const add = (v: Voucher) => {
    const sum = v.entries.reduce((s, e) => s + e.amount, 0n);
    if (sum !== 0n) throw new Error(`unbalanced voucher ${v.number}: ${sum.toString()}`);
    vouchers.push(v);
  };

  const debtors = company.ledgers.filter((l) => l.group === "Sundry Debtors");
  const creditors = company.ledgers.filter((l) => l.group === "Sundry Creditors");
  const bankId = company.ledgers.some((l) => l.id === "bank2") ? "bank2" : "bank";
  const hasStock = company.items.length > 0;

  const stock = new Map<string, StockLine[]>();
  const payroll = new Map<string, PayLine[]>();
  let stockValue = company.ledgers.find((l) => l.id === "stock")?.opening ?? 0n;

  for (const m of months) {
    const days = daysInMonth(m);
    const fy = fyOf(m);

    // Sales invoices.
    const salesCount = randInt(rand, 5, 11);
    for (let i = 0; i < salesCount; i += 1) {
      const party = pick(rand, debtors);
      const date = dayOf(m, randInt(rand, 1, days));
      const taxable = randRupees(rand, 12_000, 240_000);
      const intra = party.stateCode === company.stateCode;
      const tax = gst18(taxable, intra);
      const total = taxable + tax.cgst + tax.sgst + tax.igst;
      const number = nextNo(company.kind === "services" ? "PF" : "SI", fy);
      const entries: Entry[] = [
        { ledger: party.id, amount: total },
        { ledger: "sales", amount: -taxable },
      ];
      if (tax.cgst)
        entries.push(
          { ledger: "ocgst", amount: -tax.cgst },
          { ledger: "osgst", amount: -tax.sgst },
        );
      if (tax.igst) entries.push({ ledger: "oigst", amount: -tax.igst });
      const dueDate = addDays(date, 30);
      add({
        date,
        type: "Sales",
        number,
        narration: "Being goods/services invoiced",
        entries,
        party: party.id,
        billRef: number,
        dueDate,
        taxable,
        ...tax,
      });
      bills.push({
        party: party.id,
        ref: number,
        date,
        dueDate,
        amount: total,
        side: "receivable",
        settledOn: null,
      });
    }

    // Purchases (or subcontracted services).
    const purchCount = randInt(rand, 2, 6);
    for (let i = 0; i < purchCount; i += 1) {
      const party = pick(rand, creditors);
      const date = dayOf(m, randInt(rand, 1, days));
      const taxable = randRupees(
        rand,
        8_000,
        company.kind === "services" ? 60_000 : 160_000,
      );
      const intra = party.stateCode === company.stateCode;
      const tax = gst18(taxable, intra);
      const total = taxable + tax.cgst + tax.sgst + tax.igst;
      const ref = `${party.id.toUpperCase()}-${m.replace("-", "")}-${(i + 1).toString()}`;
      const entries: Entry[] = [
        { ledger: "purch", amount: taxable },
        { ledger: party.id, amount: -total },
      ];
      if (tax.cgst)
        entries.push(
          { ledger: "icgst", amount: tax.cgst },
          { ledger: "isgst", amount: tax.sgst },
        );
      if (tax.igst) entries.push({ ledger: "iigst", amount: tax.igst });
      const dueDate = addDays(date, 45);
      add({
        date,
        type: "Purchase",
        number: nextNo("PI", fy),
        narration: "Being purchase booked",
        entries,
        party: party.id,
        billRef: ref,
        dueDate,
        taxable,
        ...tax,
      });
      bills.push({
        party: party.id,
        ref,
        date,
        dueDate,
        amount: total,
        side: "payable",
        settledOn: null,
      });
    }

    // Receipts settle older receivables; payments settle older payables (bill-wise, in full).
    const monthEnd = dayOf(m, days);
    for (const b of bills) {
      if (b.settledOn !== null || b.date >= dayOf(m, 1)) continue;
      if (rand() < 0.7) {
        const date = dayOf(m, randInt(rand, 1, days));
        if (date < b.date) continue;
        b.settledOn = date;
        if (b.side === "receivable") {
          add({
            date,
            type: "Receipt",
            number: nextNo("RC", fy),
            narration: `Received against ${b.ref}`,
            entries: [
              { ledger: bankId, amount: b.amount },
              { ledger: b.party, amount: -b.amount },
            ],
            party: b.party,
            settles: [b.ref],
          });
        } else {
          add({
            date,
            type: "Payment",
            number: nextNo("PY", fy),
            narration: `Paid against ${b.ref}`,
            entries: [
              { ledger: b.party, amount: b.amount },
              { ledger: bankId, amount: -b.amount },
            ],
            party: b.party,
            settles: [b.ref],
          });
        }
      }
    }

    // Overheads.
    const overhead = (
      ledgerId: string,
      min: number,
      max: number,
      day: number,
      narration: string,
    ) => {
      const amount = randRupees(rand, min, max);
      add({
        date: dayOf(m, Math.min(day, days)),
        type: "Payment",
        number: nextNo("PY", fy),
        narration,
        entries: [
          { ledger: ledgerId, amount },
          { ledger: bankId, amount: -amount },
        ],
      });
    };
    overhead("rent", 45_000, 45_000, 5, "Monthly rent");
    overhead("phone", 2_500, 6_000, 12, "Telephone and internet bill");
    overhead("print", 800, 4_500, 18, "Stationery purchased");
    overhead(
      "freight",
      3_000,
      22_000,
      20,
      company.kind === "services" ? "Subscriptions" : "Freight / power charges",
    );
    const pettyCash = randRupees(rand, 500, 2_000);
    add({
      date: dayOf(m, 25),
      type: "Payment",
      number: nextNo("CP", fy),
      narration: "Petty expenses in cash",
      entries: [
        { ledger: "print", amount: pettyCash },
        { ledger: "cash", amount: -pettyCash },
      ],
    });
    add({
      date: dayOf(m, 26),
      type: "Contra",
      number: nextNo("CT", fy),
      narration: "Cash withdrawn",
      entries: [
        { ledger: "cash", amount: pettyCash },
        { ledger: bankId, amount: -pettyCash },
      ],
    });

    // Payroll: accrue on the last day, pay on the 7th of the next month.
    const lines: PayLine[] = company.employees.map((e) => {
      const gross = e.basic + e.hra;
      const pf = (e.basic * 12n + 50n) / 100n;
      const tds = gross > 4_000_000n ? (gross * 5n + 50n) / 100n : 0n;
      return {
        code: e.code,
        name: e.name,
        designation: e.designation,
        basic: e.basic,
        hra: e.hra,
        gross,
        pf,
        tds,
        net: gross - pf - tds,
      };
    });
    payroll.set(m, lines);
    const gross = lines.reduce((s, l) => s + l.gross, 0n);
    const tds = lines.reduce((s, l) => s + l.tds, 0n);
    const pfNet = lines.reduce((s, l) => s + l.pf, 0n);
    const net = gross - tds - pfNet;
    add({
      date: monthEnd,
      type: "Journal",
      number: nextNo("JV", fy),
      narration: "Salary for the month",
      entries: [
        { ledger: "salary", amount: gross },
        { ledger: "salpay", amount: -(net + pfNet) },
        { ledger: "tds", amount: -tds },
      ],
    });
    const prev = months.indexOf(m) > 0 ? payroll.get(addMonths(m, -1)) : undefined;
    if (prev) {
      const prevDue = prev.reduce((s, l) => s + l.gross - l.tds, 0n);
      add({
        date: dayOf(m, 7),
        type: "Payment",
        number: nextNo("PY", fy),
        narration: "Salary paid",
        entries: [
          { ledger: "salpay", amount: prevDue },
          { ledger: bankId, amount: -prevDue },
        ],
      });
    }

    // Depreciation.
    const assetId = company.ledgers.find((l) => l.group === "Fixed Assets")?.id ?? "";
    const depn = randRupees(rand, 3_000, 9_000);
    add({
      date: monthEnd,
      type: "Journal",
      number: nextNo("JV", fy),
      narration: "Depreciation for the month",
      entries: [
        { ledger: "depn", amount: depn },
        { ledger: assetId, amount: -depn },
      ],
    });

    // Quarterly interest income.
    if (["06", "09", "12", "03"].includes(m.slice(5))) {
      const interest = randRupees(rand, 1_500, 6_000);
      add({
        date: monthEnd,
        type: "Receipt",
        number: nextNo("RC", fy),
        narration: "Interest credited",
        entries: [
          { ledger: bankId, amount: interest },
          { ledger: "intinc", amount: -interest },
        ],
      });
    }

    // Month-end stock valuation.
    if (hasStock) {
      const lines2: StockLine[] = company.items.map((it) => {
        const quantity = randInt(rand, 200, 2_400);
        return {
          item: it.name,
          unit: it.unit,
          quantity,
          rate: it.rate,
          value: it.rate * BigInt(quantity),
        };
      });
      const newValue = lines2.reduce((s, l) => s + l.value, 0n);
      const delta = newValue - stockValue;
      if (delta !== 0n) {
        add({
          date: monthEnd,
          type: "Journal",
          number: nextNo("JV", fy),
          narration: "Closing stock adjustment",
          entries: [
            { ledger: "stock", amount: delta },
            { ledger: "inv_change", amount: -delta },
          ],
        });
      }
      stockValue = newValue;
      stock.set(m, lines2);
    }
  }

  vouchers.sort((a, b) =>
    a.date === b.date ? a.number.localeCompare(b.number) : a.date.localeCompare(b.date),
  );

  // Ledger × month balances.
  const balances = new Map<string, Map<string, MonthBalance>>();
  for (const l of company.ledgers) {
    let running = l.opening;
    const perMonth = new Map<string, MonthBalance>();
    for (const m of months) {
      let debit = 0n;
      let credit = 0n;
      for (const v of vouchers) {
        if (monthKey(v.date) !== m) continue;
        for (const e of v.entries) {
          if (e.ledger !== l.id) continue;
          if (e.amount > 0n) debit += e.amount;
          else credit -= e.amount;
        }
      }
      const closing = running + debit - credit;
      perMonth.set(m, { opening: running, debit, credit, closing });
      running = closing;
    }
    balances.set(l.id, perMonth);
  }

  return {
    company,
    months,
    vouchers,
    bills,
    balances,
    stock,
    payroll,
    ledger,
    groupPath,
    nature,
  };
}
