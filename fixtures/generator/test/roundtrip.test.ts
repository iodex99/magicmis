/**
 * Phase 3 acceptance (SPEC §34): every fixture parses to ground truth.
 *
 * Each generated file goes through the production path — SheetJS or the CSV reader into a
 * grid, header detection, report detection, the Tally parser — and the result is compared
 * with the generator's ground truth. Broken variants must be detected as broken.
 */

import {
  readCsvGrid,
  readExcel,
  detectHeader,
  loadSheet,
  profileSheet,
  type SheetGrid,
} from "@magicmis/ingest";
import {
  detectReport,
  parseBalanceReport,
  parseBills,
  parsePaySheet,
  parseStatement,
  parseStockSummary,
  parseVoucherReport,
  type BalanceReport,
} from "@magicmis/tally";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildFixtureSet, type FixtureFile } from "../src/fixtures";

import { openTestDuck } from "../../../packages/ingest/test/duck";

const set = buildFixtureSet();

function gridOf(f: FixtureFile): SheetGrid {
  const bytes = f.bytes();
  if (f.format === "csv")
    return readCsvGrid(bytes, f.name.split("/").pop() ?? f.name).grid;
  const sheet = readExcel(bytes).sheets[0];
  if (!sheet) throw new Error(`${f.name}: no sheet`);
  return sheet;
}

const abs = (n: bigint) => (n < 0n ? -n : n);

function checkTrialBalance(f: FixtureFile, report: BalanceReport): string[] {
  if (f.truth.kind !== "trial_balance") return ["wrong truth kind"];
  const problems: string[] = [];
  const parsed = report.ledgers;
  const findLedger = (path: readonly string[]) => {
    const name = path[path.length - 1] ?? "";
    const parent = path[path.length - 2] ?? null;
    return parsed.filter((l) => {
      const lname = l.name;
      const nameOk =
        lname === name || (lname.endsWith("...") && name.startsWith(lname.slice(0, -3)));
      if (!nameOk) return false;
      if (report.hierarchy === "parent_column" || report.hierarchy === "flat") {
        return parent === null || l.path.includes(parent) || l.path.length === 1;
      }
      return l.path.slice(0, -1).join(" > ") === path.slice(0, -1).join(" > ");
    });
  };
  let mismatches = 0;
  for (const t of f.truth.ledgers) {
    const found = findLedger(t.path);
    if (found.length !== 1) {
      problems.push(`${t.path.join(" > ")}: found ${found.length.toString()}`);
      continue;
    }
    const got = found[0]?.amounts ?? {};
    const fields: ("opening" | "debit" | "credit" | "closing")[] =
      f.truth.columns === "full"
        ? ["opening", "debit", "credit", "closing"]
        : ["closing"];
    for (const field of fields) {
      const expected = BigInt(t[field]);
      const actual = got[field] ?? 0n;
      if (actual !== expected) {
        mismatches += 1;
        if (f.broken === undefined)
          problems.push(
            `${t.path.join(" > ")} ${field}: expected ${expected.toString()} got ${actual.toString()}`,
          );
      }
    }
  }
  if (parsed.length !== f.truth.ledgers.length)
    problems.push(
      `ledger count ${parsed.length.toString()} vs ${f.truth.ledgers.length.toString()}`,
    );

  const sum = parsed.reduce((s, l) => s + (l.amounts.closing ?? 0n), 0n);
  const failedChecks = report.checks.filter((c) => !c.ok);
  switch (f.broken) {
    case undefined:
      if (sum !== 0n) problems.push(`ledgers do not balance: ${sum.toString()}`);
      if (failedChecks.length > 0)
        problems.push(
          `subtotal checks failed: ${JSON.stringify(failedChecks.slice(0, 2), (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`,
        );
      break;
    case "unbalanced_tb":
      if (sum === 0n) problems.push("unbalanced TB was not detected");
      break;
    case "subtotal_mismatch":
      if (failedChecks.length === 0) problems.push("subtotal mismatch was not detected");
      if (sum !== 0n)
        problems.push("subtotal-mismatch variant should still balance at ledger level");
      break;
    case "duplicate_period":
    case "backdated_change":
      if (mismatches !== 1)
        problems.push(
          `expected exactly one differing ledger, got ${mismatches.toString()}`,
        );
      break;
    case "missing_month":
      break;
  }
  return problems;
}

function check(f: FixtureFile): string[] {
  const grid = gridOf(f);
  const header = detectHeader(grid);
  if (header === null) return ["no header detected"];
  const detection = detectReport(grid, header);
  const problems: string[] = [];
  if (detection.type !== f.report)
    problems.push(`detected ${detection.type}, expected ${f.report}`);
  if (
    f.report !== "balance_sheet" &&
    f.report !== "bills_receivable" &&
    f.report !== "bills_payable"
  ) {
    if (header.period?.from !== f.period.from)
      problems.push(`period from ${String(header.period?.from)} vs ${f.period.from}`);
  }

  const t = f.truth;
  switch (t.kind) {
    case "trial_balance":
      return [...problems, ...checkTrialBalance(f, parseBalanceReport(grid, header))];
    case "group_summary": {
      const r = parseBalanceReport(grid, header);
      const got = Object.fromEntries(
        r.ledgers.map((l) => [l.name, (l.amounts.closing ?? 0n).toString()]),
      );
      const want = Object.fromEntries(t.ledgers.map((l) => [l.name, l.closing]));
      if (JSON.stringify(got) !== JSON.stringify(want))
        problems.push(`group summary ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
      return problems;
    }
    case "profit_and_loss": {
      const st = parseStatement(grid, header);
      const items = st.sides.flatMap((s) => s.items);
      const profit = items.find((i) => /^nett\s+profit$/iu.test(i.name));
      const loss = items.find((i) => /^nett\s+loss$/iu.test(i.name));
      const net = profit ? profit.amount : loss ? -loss.amount : null;
      if (net?.toString() !== t.netProfit)
        problems.push(`net profit ${String(net)} vs ${t.netProfit}`);
      const failed = st.sides.flatMap((s) => s.checks).filter((c) => !c.ok);
      if (failed.length > 0)
        problems.push(`P&L group checks failed: ${failed.length.toString()}`);
      if (st.layout === "horizontal" && st.sides[0]?.total !== st.sides[1]?.total)
        problems.push("P&L sides do not agree");
      return problems;
    }
    case "balance_sheet": {
      const st = parseStatement(grid, header);
      for (const side of st.sides)
        if (side.total?.toString() !== t.total)
          problems.push(`BS side total ${String(side.total)} vs ${t.total}`);
      const failed = st.sides.flatMap((s) => s.checks).filter((c) => !c.ok);
      if (failed.length > 0)
        problems.push(`BS group checks failed: ${failed.length.toString()}`);
      if (header.asAt === null) problems.push("as-at date not detected");
      return problems;
    }
    case "vouchers": {
      const r = parseVoucherReport(grid, header);
      const debit = r.lines.reduce(
        (s, l) => s + (l.amount !== null && l.amount > 0n ? l.amount : 0n),
        0n,
      );
      const credit = r.lines.reduce(
        (s, l) => s + (l.amount !== null && l.amount < 0n ? -l.amount : 0n),
        0n,
      );
      if (r.lines.length !== t.lines)
        problems.push(`lines ${r.lines.length.toString()} vs ${t.lines.toString()}`);
      if (debit.toString() !== t.debit || credit.toString() !== t.credit)
        problems.push(
          `day book ${debit.toString()}/${credit.toString()} vs ${t.debit}/${t.credit}`,
        );
      if (r.lines.some((l) => l.date === null || l.vchNo === ""))
        problems.push("a line lost its carried-forward voucher identity");
      return problems;
    }
    case "ledger_vouchers": {
      const r = parseVoucherReport(grid, header);
      const debit = r.lines.reduce(
        (s, l) => s + (l.amount !== null && l.amount > 0n ? l.amount : 0n),
        0n,
      );
      const credit = r.lines.reduce(
        (s, l) => s + (l.amount !== null && l.amount < 0n ? -l.amount : 0n),
        0n,
      );
      if (r.lines.length !== t.entries)
        problems.push(`entries ${r.lines.length.toString()} vs ${t.entries.toString()}`);
      if (debit.toString() !== t.debit || credit.toString() !== t.credit)
        problems.push(
          `ledger vouchers ${debit.toString()}/${credit.toString()} vs ${t.debit}/${t.credit}`,
        );
      return problems;
    }
    case "register": {
      const r = parseVoucherReport(grid, header);
      const sum = (k: "taxable" | "cgst" | "sgst" | "igst") =>
        r.lines.reduce((s, l) => s + (l[k] ?? 0n), 0n).toString();
      if (r.lines.length !== t.vouchers)
        problems.push(
          `vouchers ${r.lines.length.toString()} vs ${t.vouchers.toString()}`,
        );
      for (const k of ["taxable", "cgst", "sgst", "igst"] as const)
        if (sum(k) !== t[k]) problems.push(`${k} ${sum(k)} vs ${t[k]}`);
      return problems;
    }
    case "bills": {
      const r = parseBills(grid, header);
      const total = r.bills.reduce((s, b) => s + abs(b.pending ?? 0n), 0n);
      const byParty: Record<string, string> = {};
      for (const b of r.bills)
        byParty[b.party] = (
          BigInt(byParty[b.party] ?? "0") + abs(b.pending ?? 0n)
        ).toString();
      if (r.bills.length !== t.bills)
        problems.push(`bills ${r.bills.length.toString()} vs ${t.bills.toString()}`);
      if (total.toString() !== t.pending)
        problems.push(`pending ${total.toString()} vs ${t.pending}`);
      const sortObj = (o: Record<string, string>) =>
        JSON.stringify(Object.entries(o).sort());
      if (sortObj(byParty) !== sortObj(t.byParty))
        problems.push("pending by party differs");
      return problems;
    }
    case "stock": {
      const r = parseStockSummary(grid, header);
      const value = r.items.reduce((s, i) => s + (i.value ?? 0n), 0n);
      if (
        r.items.length !== t.items ||
        value.toString() !== t.value ||
        r.total?.toString() !== t.value
      )
        problems.push(
          `stock ${r.items.length.toString()} items ${value.toString()} vs ${t.value}`,
        );
      return problems;
    }
    case "pay": {
      const r = parsePaySheet(grid, header);
      const net = r.lines.reduce((s, l) => s + (l.net ?? 0n), 0n);
      if (r.lines.length !== t.employees || net.toString() !== t.net)
        problems.push(
          `pay ${r.lines.length.toString()} / ${net.toString()} vs ${t.employees.toString()} / ${t.net}`,
        );
      return problems;
    }
  }
}

describe("fixture set (SPEC §16)", () => {
  it("covers three companies, fourteen months, every report type, every quirk and every broken variant", () => {
    expect(set.truths.map((t) => t.kind).sort()).toEqual([
      "manufacturing",
      "services",
      "trading",
    ]);
    expect(set.truths.every((t) => t.months.length === 14)).toBe(true);
    const reports = new Set(set.files.map((f) => f.report));
    expect(reports.size).toBe(12);
    const quirks = new Set(set.files.flatMap((f) => f.quirks));
    for (const q of [
      "title_rows",
      "indentation",
      "level_column",
      "subtotal_rows",
      "grand_total",
      "dr_cr_suffix",
      "blank_separators",
      "wrapped_names",
      "truncated_names",
      "period_split_across_files",
      "parent_column",
    ]) {
      expect(quirks, q).toContain(q);
    }
    // Same ledger name under different groups, in every trading book.
    expect(
      set.books[0]?.company.ledgers
        .filter((l) => l.name === "Security Deposit")
        .map((l) => l.group)
        .sort(),
    ).toEqual(["Current Liabilities", "Deposits (Asset)"]);
    expect(new Set(set.files.flatMap((f) => (f.broken ? [f.broken] : [])))).toEqual(
      new Set([
        "unbalanced_tb",
        "subtotal_mismatch",
        "duplicate_period",
        "backdated_change",
      ]),
    );
    // The missing month is a property of the set, not a file.
    const trading = set.truths.find((t) => t.company === "trading");
    expect(trading?.brokenSet.missingMonth).toBe("2025-09");
  });

  it("is deterministic", () => {
    const again = buildFixtureSet({ companies: ["services"], months: 2 });
    const first = set.files.filter(
      (f) =>
        f.company === "services" && f.variant === "clean" && /_2025-0[45]./u.test(f.name),
    );
    const second = again.files.filter((f) => f.variant === "clean");
    expect(second.map((f) => f.name)).toEqual(first.map((f) => f.name));
    expect(second.map((f) => JSON.stringify(f.truth))).toEqual(
      first.map((f) => JSON.stringify(f.truth)),
    );
  });
});

describe("every fixture parses to ground truth (Phase 3 acceptance)", () => {
  for (const company of ["trading", "services", "manufacturing"]) {
    it(company, () => {
      const failures: string[] = [];
      const files = set.files.filter((f) => f.company === company);
      for (const f of files) {
        for (const p of check(f)) failures.push(`${f.name}: ${p}`);
      }
      expect(failures.slice(0, 25)).toEqual([]);
      expect(files.length).toBeGreaterThan(150);
    });
  }
});

describe("fixtures through DuckDB with provenance", () => {
  let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
  beforeAll(async () => {
    duck = await openTestDuck();
  });
  afterAll(() => {
    duck?.close();
  });

  it("loads a month of sales registers and reproduces the taxable total in SQL", async () => {
    if (!duck) throw new Error("duck not open");
    const f = set.files.find(
      (x) =>
        x.company === "trading" && x.report === "sales_register" && x.variant === "clean",
    );
    if (!f || f.truth.kind !== "register") throw new Error("no register fixture");
    const grid = gridOf(f);
    const profile = await profileSheet(grid, (g, h) => detectReport(g, h).type);
    expect(profile.reportType).toBe("sales_register");
    const loaded = await loadSheet(duck, {
      fileId: "00000000-0000-4000-8000-00000000abcd",
      sheet: grid,
      profile,
      tableTaken: new Set(),
    });
    const rows = await duck.query(
      `select sum(taxable_value)::varchar as t, count(*)::int as n, min(_source_row)::int as first from "${loaded.table}"`,
    );
    expect(rows[0]).toEqual({ t: f.truth.taxable, n: f.truth.vouchers, first: 6 });
  });
});
