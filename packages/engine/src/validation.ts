/**
 * Validation gate (SPEC §21), checks V1–V10. Runs after compute and before render. Results carry
 * aggregates only (no ledger names beyond tokenised keys), a plain-language message and a fix.
 * The failure class drives billing (SPEC §23).
 */

import {
  addMonths,
  financialYearOf,
  periodRange,
  type PeriodId,
} from "@magicmis/core/time";
import { ancestry, head as headDef, isHeadCode } from "@magicmis/semantic";
import type { SubtotalCheck } from "@magicmis/tally";

import type { HeadCube } from "./compute";
import type { LedgerFact, TxnFact } from "./facts";

export type CheckId =
  "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8" | "V9" | "V10";
export type Severity = "blocking" | "warning";
export type FailureClass = "data_fault" | "platform_fault";

export interface CheckResult {
  readonly id: CheckId;
  readonly status: "pass" | "fail" | "not_applicable";
  readonly severity: Severity;
  readonly failureClass: FailureClass;
  readonly message: string;
  readonly fix: string;
  /** Aggregates only, paise as decimal strings. */
  readonly amounts: Readonly<Record<string, string>>;
  readonly details: readonly {
    readonly label: string;
    readonly amounts: Readonly<Record<string, string>>;
  }[];
  /** V7: the period's figures differ from a stored snapshot. */
  readonly restatement?: boolean;
}

const abs = (x: bigint) => (x < 0n ? -x : x);
const s = (x: bigint) => x.toString();

function result(
  id: CheckId,
  severity: Severity,
  failureClass: FailureClass,
  failed: boolean,
  text: { pass: string; fail: string; fix: string },
  amounts: Record<string, string> = {},
  details: CheckResult["details"] = [],
): CheckResult {
  return {
    id,
    status: failed ? "fail" : "pass",
    severity,
    failureClass,
    message: failed ? text.fail : text.pass,
    fix: failed ? text.fix : "",
    amounts,
    details,
  };
}

const notApplicable = (
  id: CheckId,
  severity: Severity,
  failureClass: FailureClass,
  why: string,
): CheckResult => ({
  id,
  status: "not_applicable",
  severity,
  failureClass,
  message: why,
  fix: "",
  amounts: {},
  details: [],
});

/** V1 — every source balance is in exactly one head or in Unmapped; counts and sums reconcile. */
export function checkCoverage(
  cube: HeadCube,
  input: { unmappedAccepted: boolean },
): CheckResult[] {
  const lost = cube.coverage.filter(
    (c) =>
      c.sourceRows !== c.mappedRows + c.unmappedRows ||
      c.sourceClosing !== c.mappedClosing + c.unmappedClosing,
  );
  if (lost.length > 0) {
    return [
      result(
        "V1",
        "blocking",
        "platform_fault",
        true,
        {
          pass: "",
          fail: "Some source balances did not reach any MIS head. This is our error, not your data.",
          fix: "No action is needed from you; the job will not be charged. Please contact support if it repeats.",
        },
        {},
        lost.map((c) => ({
          label: c.period,
          amounts: {
            source_rows: c.sourceRows.toString(),
            reconciled_rows: (c.mappedRows + c.unmappedRows).toString(),
            source_closing: s(c.sourceClosing),
            reconciled_closing: s(c.mappedClosing + c.unmappedClosing),
          },
        })),
      ),
    ];
  }
  const unmapped = cube.coverage.filter(
    (c) => c.unmappedRows > 0 && c.unmappedClosing !== 0n,
  );
  const unmappedMovement = cube.periods.some((p) => {
    const v = cube.get("UNMAPPED", p);
    return v !== null && (v.closing !== 0n || (v.movement ?? 0n) !== 0n);
  });
  const failed = (unmapped.length > 0 || unmappedMovement) && !input.unmappedAccepted;
  return [
    result(
      "V1",
      "blocking",
      "data_fault",
      failed,
      {
        pass:
          input.unmappedAccepted && unmappedMovement
            ? "All balances are accounted for; you accepted the Unmapped amounts."
            : "Every source balance is in exactly one MIS head.",
        fail: "Some ledgers with balances are not mapped to an MIS head.",
        fix: "Map the ledgers listed under Unmapped, or confirm that they should be shown as Unmapped.",
      },
      {},
      cube.periods.map((p) => ({
        label: p,
        amounts: {
          unmapped_closing: s(cube.get("UNMAPPED", p)?.closing ?? 0n),
          unmapped_movement: s(cube.get("UNMAPPED", p)?.movement ?? 0n),
        },
      })),
    ),
  ];
}

export type StatementTotal =
  | {
      readonly kind: "tb_grand_total";
      readonly period: PeriodId;
      /** The grand total row as parsed (signed, debit positive); absent fields are not compared. */
      readonly reported: Partial<
        Record<"opening" | "debit" | "credit" | "closing", bigint>
      >;
    }
  | {
      readonly kind: "balance_sheet_total";
      readonly period: PeriodId;
      readonly total: bigint;
    };

/**
 * V2 — the source statement's own totals equal the MIS totals, to the paisa. Only balances that
 * reached a valid MIS head (including Unmapped) count on the MIS side, so a ledger lost by our code
 * shows here as well as in V1.
 */
export function checkStatementTotals(
  cube: HeadCube,
  facts: readonly LedgerFact[],
  totals: readonly StatementTotal[],
): CheckResult {
  if (totals.length === 0)
    return notApplicable(
      "V2",
      "blocking",
      "platform_fault",
      "The source files carry no statement totals to compare.",
    );
  const details: { label: string; amounts: Record<string, string> }[] = [];
  let failed = false;
  for (const t of totals) {
    const rows = cube.ledgerRows.filter(
      (r) => r.period === t.period && isHeadCode(r.head),
    );
    if (t.kind === "tb_grand_total") {
      const reached = new Set(rows.map((r) => r.ledgerKey));
      const periodFacts = facts.filter(
        (f) => f.period === t.period && reached.has(f.ledgerKey),
      );
      const mis: Record<string, bigint> = {
        closing: rows.reduce((a, r) => a + r.closing, 0n),
        opening: periodFacts.reduce((a, f) => a + (f.opening ?? 0n), 0n),
        debit: periodFacts.reduce((a, f) => a + (f.debit ?? 0n), 0n),
        credit: periodFacts.reduce((a, f) => a + (f.credit ?? 0n), 0n),
      };
      const amounts: Record<string, string> = {};
      for (const field of ["opening", "debit", "credit", "closing"] as const) {
        const reported = t.reported[field];
        if (reported === undefined) continue;
        const computed = mis[field] ?? 0n;
        amounts[`reported_${field}`] = s(reported);
        amounts[`mis_${field}`] = s(computed);
        if (reported !== computed) failed = true;
      }
      details.push({ label: `${t.period} trial balance`, amounts });
    } else {
      const assets = rows
        .filter((r) => headDef(r.head).class === "asset")
        .reduce((a, r) => a + r.closing, 0n);
      if (assets !== t.total) failed = true;
      details.push({
        label: `${t.period} balance sheet`,
        amounts: { reported_total: s(t.total), mis_assets: s(assets) },
      });
    }
  }
  return result(
    "V2",
    "blocking",
    "platform_fault",
    failed,
    {
      pass: "Source statement totals equal the MIS totals.",
      fail: "The MIS total differs from the total printed in your source statement. This is our error.",
      fix: "No action is needed from you; the job will not be charged.",
    },
    {},
    details,
  );
}

/** V3 — trial balance debits equal credits within the configured tolerance. */
export function checkTrialBalance(
  facts: readonly LedgerFact[],
  tolerancePaise: bigint,
): CheckResult {
  if (facts.length === 0)
    return notApplicable("V3", "blocking", "data_fault", "No trial balance was loaded.");
  const byPeriod = new Map<string, bigint>();
  for (const f of facts)
    byPeriod.set(f.period, (byPeriod.get(f.period) ?? 0n) + f.closing);
  const off = [...byPeriod.entries()].filter(([, diff]) => abs(diff) > tolerancePaise);
  return result(
    "V3",
    "blocking",
    "data_fault",
    off.length > 0,
    {
      pass: "Every trial balance balances: total debits equal total credits.",
      fail: "A trial balance does not balance: total debits and total credits differ.",
      fix: "Re-export the trial balance from Tally after checking for a difference in opening balances or a suspense entry, then upload it again.",
    },
    {},
    off.map(([period, diff]) => ({ label: period, amounts: { difference: s(diff) } })),
  );
}

/** V4 — every exported group subtotal equals the sum of its child ledgers. */
export function checkSubtotals(
  checks: readonly { period: PeriodId; checks: readonly SubtotalCheck[] }[],
): CheckResult {
  const bad = checks.flatMap((c) =>
    c.checks.filter((x) => !x.ok).map((x) => ({ period: c.period, x })),
  );
  if (checks.every((c) => c.checks.length === 0))
    return notApplicable(
      "V4",
      "blocking",
      "data_fault",
      "The exports carry no group subtotals.",
    );
  return result(
    "V4",
    "blocking",
    "data_fault",
    bad.length > 0,
    {
      pass: "Every group subtotal equals the sum of its ledgers.",
      fail: "A group subtotal in the export does not equal the sum of its ledgers.",
      fix: "Re-export the report from Tally without manual edits, then upload it again.",
    },
    {},
    bad.slice(0, 50).map(({ period, x }) => ({
      label: `${period} row ${x.sourceRow.toString()} (${x.field})`,
      amounts: { reported: s(x.reported), computed: s(x.computed) },
    })),
  );
}

/** V5 — assets equal equity and liabilities plus the year's profit to date. */
export function checkBalanceSheet(cube: HeadCube, tolerancePaise: bigint): CheckResult {
  const periods = cube.periods.filter((p) => (cube.get("BS", p)?.ledgers ?? 0) > 0);
  if (periods.length === 0)
    return notApplicable(
      "V5",
      "blocking",
      "data_fault",
      "No balance sheet data was loaded.",
    );
  const details: { label: string; amounts: Record<string, string> }[] = [];
  for (const p of periods) {
    const assets = cube.get("NCA", p)?.closing ?? 0n;
    const current = cube.get("CA", p)?.closing ?? 0n;
    const funds =
      -(cube.get("EQ", p)?.closing ?? 0n) -
      (cube.get("NCL", p)?.closing ?? 0n) -
      (cube.get("CL", p)?.closing ?? 0n);
    const profit = -(cube.get("PL", p)?.closing ?? 0n);
    const unmapped = cube.get("UNMAPPED", p)?.closing ?? 0n;
    const diff = assets + current + unmapped - funds - profit;
    if (abs(diff) > tolerancePaise)
      details.push({
        label: p,
        amounts: {
          assets: s(assets + current),
          equity_and_liabilities: s(funds),
          profit_to_date: s(profit),
          unmapped: s(unmapped),
          difference: s(diff),
        },
      });
  }
  return result(
    "V5",
    "blocking",
    "data_fault",
    details.length > 0,
    {
      pass: "The balance sheet balances: assets equal equity and liabilities plus profit to date.",
      fail: "The balance sheet does not balance.",
      fix: "Check the trial balance for a difference in opening balances, then re-export and upload it.",
    },
    {},
    details,
  );
}

/** V6 — the profit computed from ledgers reconciles to the P&L statement's net profit. */
export function checkProfitReconciliation(
  cube: HeadCube,
  statements: readonly { period: PeriodId; netProfitFytd: bigint }[],
  tolerancePaise: bigint,
): CheckResult {
  if (statements.length === 0)
    return notApplicable(
      "V6",
      "warning",
      "data_fault",
      "No profit and loss statement was loaded to compare with.",
    );
  const details: { label: string; amounts: Record<string, string> }[] = [];
  for (const st of statements) {
    const fy = financialYearOf(st.period, cube.fyStartMonth);
    let computed: bigint | null = 0n;
    for (const p of periodRange(fy.start, st.period)) {
      const m = cube.periods.includes(p) ? cube.get("PL", p)?.movement : null;
      if (m === null || m === undefined) {
        computed = null;
        break;
      }
      computed -= m;
    }
    if (computed === null) continue;
    if (abs(computed - st.netProfitFytd) > tolerancePaise)
      details.push({
        label: st.period,
        amounts: { statement_net_profit: s(st.netProfitFytd), mis_profit: s(computed) },
      });
  }
  return result(
    "V6",
    "warning",
    "data_fault",
    details.length > 0,
    {
      pass: "Profit from the ledgers reconciles to the profit and loss statement.",
      fail: "Profit from the ledgers differs from the profit and loss statement.",
      fix: "Make sure the trial balance and the profit and loss statement were exported for the same period and company.",
    },
    {},
    details,
  );
}

/**
 * V7 — continuity with the previous snapshot: a period already stored must not have changed
 * (backdated change), and the first new period's opening must equal the stored closing.
 */
export function checkContinuity(
  facts: readonly LedgerFact[],
  previous: {
    readonly period: PeriodId;
    readonly closings: ReadonlyMap<string, bigint>;
  } | null,
  input: { fyStartMonth: number; isPl: (fact: LedgerFact) => boolean },
): CheckResult {
  if (previous === null)
    return notApplicable(
      "V7",
      "warning",
      "data_fault",
      "There is no earlier snapshot to compare with.",
    );
  const details: { label: string; amounts: Record<string, string> }[] = [];
  let restatement = false;

  const same = facts.filter((f) => f.period === previous.period);
  if (same.length > 0) {
    const keys = new Set([...same.map((f) => f.ledgerKey), ...previous.closings.keys()]);
    const now = new Map(same.map((f) => [f.ledgerKey, f.closing]));
    for (const k of keys) {
      const before = previous.closings.get(k) ?? 0n;
      const after = now.get(k) ?? 0n;
      if (before !== after) {
        restatement = true;
        details.push({
          label: `${previous.period} ${k}`,
          amounts: { stored_closing: s(before), new_closing: s(after) },
        });
      }
    }
  }

  const next = addMonths(previous.period, 1);
  const fyStart = financialYearOf(next, input.fyStartMonth).start;
  for (const f of facts.filter((x) => x.period === next && x.opening !== null)) {
    if (input.isPl(f) && next === fyStart) continue;
    const before = previous.closings.get(f.ledgerKey) ?? 0n;
    if (f.opening !== before)
      details.push({
        label: `${next} ${f.ledgerKey}`,
        amounts: { previous_closing: s(before), opening: s(f.opening ?? 0n) },
      });
  }
  return {
    ...result(
      "V7",
      "warning",
      "data_fault",
      details.length > 0,
      {
        pass: "Balances continue from the last saved snapshot.",
        fail: "Some balances differ from the last saved snapshot, so earlier figures may have been changed in Tally.",
        fix: "If entries were posted to a closed period, this is expected; the MIS will note the restatement. Otherwise check the export period.",
      },
      {},
      details.slice(0, 200),
    ),
    restatement,
  };
}

/** V8 — expected months present and no period loaded twice. */
export function checkPeriods(
  files: readonly { period: PeriodId; fileId: string; role: string }[],
  expected: { from: PeriodId; to: PeriodId },
): CheckResult {
  const byPeriod = new Map<string, string[]>();
  for (const f of files)
    byPeriod.set(`${f.role}|${f.period}`, [
      ...(byPeriod.get(`${f.role}|${f.period}`) ?? []),
      f.fileId,
    ]);
  const roles = [...new Set(files.map((f) => f.role))];
  const details: { label: string; amounts: Record<string, string> }[] = [];
  for (const role of roles) {
    for (const p of periodRange(expected.from, expected.to)) {
      const n = byPeriod.get(`${role}|${p}`)?.length ?? 0;
      if (n === 0)
        details.push({ label: `${p} ${role} missing`, amounts: { files: "0" } });
      if (n > 1)
        details.push({
          label: `${p} ${role} loaded more than once`,
          amounts: { files: n.toString() },
        });
    }
  }
  return result(
    "V8",
    "blocking",
    "data_fault",
    details.length > 0,
    {
      pass: "Every expected month is present exactly once.",
      fail: "A month is missing, or the same month was loaded more than once.",
      fix: "Upload one export per month for the whole period, and remove duplicate files.",
    },
    {},
    details,
  );
}

/** V9 — the same transaction (date, voucher number, ledger, amount) in more than one file. */
export function checkDuplicateTransactions(txns: readonly TxnFact[]): CheckResult {
  if (txns.length === 0)
    return notApplicable(
      "V9",
      "warning",
      "data_fault",
      "No transaction registers were loaded.",
    );
  const seen = new Map<string, Set<string>>();
  for (const t of txns) {
    const key = `${t.date}|${t.voucherNo}|${t.ledger}|${t.amount.toString()}`;
    const files = seen.get(key) ?? new Set<string>();
    files.add(t.source.fileId);
    seen.set(key, files);
  }
  const dups = [...seen.entries()].filter(([, f]) => f.size > 1);
  return result(
    "V9",
    "warning",
    "data_fault",
    dups.length > 0,
    {
      pass: "No transaction appears in more than one file.",
      fail: "Some transactions appear in more than one file and may be counted twice.",
      fix: "Remove overlapping exports so each voucher is loaded once.",
    },
    { duplicate_transactions: dups.length.toString() },
    dups.slice(0, 50).map(([key, f]) => ({
      label: key.split("|").slice(0, 2).join(" "),
      amounts: { files: f.size.toString() },
    })),
  );
}

/** V10 — heads whose balance runs against their normal direction. */
export function checkSigns(cube: HeadCube, heads: readonly string[]): CheckResult {
  const details: { label: string; amounts: Record<string, string> }[] = [];
  for (const p of cube.periods) {
    for (const code of heads) {
      const def = headDef(code);
      const v = cube.get(code, p);
      if (v === null) continue;
      const isPl = ancestry(code)[0] === "PL";
      const amount = isPl ? v.movement : v.closing;
      if (amount === null || amount === 0n) continue;
      const normal = def.normalBalance === "debit" ? amount > 0n : amount < 0n;
      if (!normal)
        details.push({ label: `${p} ${def.name}`, amounts: { amount: s(amount) } });
    }
  }
  return result(
    "V10",
    "warning",
    "data_fault",
    details.length > 0,
    {
      pass: "Every checked head has its usual balance direction.",
      fail: "Some heads have an unusual balance direction (for example, negative revenue or a credit cash balance).",
      fix: "Check the ledgers under these heads for misposted entries or a wrong mapping.",
    },
    {},
    details,
  );
}

export const isBlocking = (r: CheckResult): boolean =>
  r.status === "fail" && r.severity === "blocking";

/** The failure class that decides billing: platform faults win over data faults. */
export function gateOutcome(
  results: readonly CheckResult[],
): { ok: true } | { ok: false; failureClass: FailureClass; checks: CheckId[] } {
  const blocking = results.filter(isBlocking);
  if (blocking.length === 0) return { ok: true };
  const platform = blocking.some((r) => r.failureClass === "platform_fault");
  return {
    ok: false,
    failureClass: platform ? "platform_fault" : "data_fault",
    checks: blocking.map((r) => r.id),
  };
}
