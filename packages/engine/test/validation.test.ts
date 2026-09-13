/**
 * SPEC §34 Phase 5 acceptance: each validation check proven with failing fixtures, and unmapped
 * balances never dropped.
 *
 * Deliberately broken generator variants fail V3 (unbalanced TB), V4 (subtotal mismatch), V8
 * (duplicate period, missing month) and V7 (backdated change). V1, V2, V5, V6, V9 and V10 use
 * fixtures mutated in the ways those checks exist to catch. Every check also passes on clean data.
 */

import type { PeriodId } from "@magicmis/core/time";
import { buildFixtureSet } from "@magicmis/fixtures";
import { detectHeader } from "@magicmis/ingest";
import { primaryOf, parseVoucherReport } from "@magicmis/tally";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTestDuck } from "../../ingest/test/duck";
import type { TxnFact } from "../src/facts";
import {
  checkBalanceSheet,
  checkContinuity,
  checkCoverage,
  checkDuplicateTransactions,
  checkPeriods,
  checkProfitReconciliation,
  checkSigns,
  checkStatementTotals,
  checkSubtotals,
  checkTrialBalance,
  gateOutcome,
} from "../src/validation";
import { at, cubeFor, gridOf, mapFacts, parseTb } from "./pipeline";

let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
beforeAll(async () => {
  duck = await openTestDuck();
});
afterAll(() => {
  duck?.close();
});
const conn = () => {
  if (duck === undefined) throw new Error("duck not open");
  return duck;
};

const set = buildFixtureSet({ companies: ["trading"] });
const trading = set.truths[0];
const clean = set.files
  .filter((f) => f.report === "trial_balance" && f.variant === "clean")
  .sort((a, b) => a.period.to.localeCompare(b.period.to));
const broken = (kind: string) => {
  const f = set.files.find((x) => x.broken === kind);
  if (f === undefined) throw new Error(`no ${kind} fixture`);
  return f;
};
const month = (f: { period: { to: string } }) => f.period.to.slice(0, 7) as PeriodId;

describe("V1 coverage and unmapped", () => {
  it("passes on clean data; unmapped balances block unless accepted; lost rows are a platform fault", async () => {
    const { facts } = parseTb(at(clean, 0));
    const { mappings } = mapFacts(facts);
    const ok = await cubeFor(conn(), facts, mappings);
    expect(checkCoverage(ok, { unmappedAccepted: false })[0]).toMatchObject({
      status: "pass",
    });

    const rent = mappings.find((m) => m.ledgerKey.endsWith("warehouse rent"));
    expect(rent).toBeDefined();
    const unmapped = await cubeFor(
      conn(),
      facts,
      mappings.filter((m) => m !== rent),
    );
    expect(checkCoverage(unmapped, { unmappedAccepted: false })[0]).toMatchObject({
      status: "fail",
      failureClass: "data_fault",
      severity: "blocking",
    });
    expect(checkCoverage(unmapped, { unmappedAccepted: true })[0]?.status).toBe("pass");
    // Unmapped is a visible head carrying the balance, not a hole.
    expect(unmapped.get("UNMAPPED", month(at(clean, 0)))?.ledgers).toBe(1);

    const lost = await cubeFor(
      conn(),
      facts,
      mappings.map((m) => (m === rent ? { ...m, head: "NOT_A_HEAD" } : m)),
    );
    const v1 = checkCoverage(lost, { unmappedAccepted: true })[0];
    expect(v1).toMatchObject({ status: "fail", failureClass: "platform_fault" });
    expect(gateOutcome(v1 === undefined ? [] : [v1])).toEqual({
      ok: false,
      failureClass: "platform_fault",
      checks: ["V1"],
    });
  });

  it("property: every source balance lands in exactly one head or Unmapped", async () => {
    const { facts } = parseTb(at(clean, 2));
    const { mappings } = mapFacts(facts);
    const total = facts.reduce((s, f) => s + f.closing, 0n);
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), {
          minLength: mappings.length,
          maxLength: mappings.length,
        }),
        async (keep) => {
          const cube = await cubeFor(
            conn(),
            facts,
            mappings.filter((_, i) => keep[i]),
          );
          const p = month(at(clean, 2));
          const top = ["BS", "PL", "UNMAPPED"].reduce(
            (s, h) => s + (cube.get(h, p)?.closing ?? 0n),
            0n,
          );
          const ledgers = ["BS", "PL", "UNMAPPED"].reduce(
            (s, h) => s + (cube.get(h, p)?.ledgers ?? 0),
            0,
          );
          expect(top).toBe(total);
          expect(ledgers).toBe(facts.length);
          expect(checkCoverage(cube, { unmappedAccepted: true })[0]?.status).toBe("pass");
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe("V2 statement totals", () => {
  it("equals the grand total row on clean data, and fails when a ledger never reaches a head", async () => {
    const f = at(clean, 0);
    const { report, facts } = parseTb(f);
    expect(report.grandTotal).not.toBeNull();
    const totals = [
      {
        kind: "tb_grand_total" as const,
        period: month(f),
        reported: report.grandTotal ?? {},
      },
    ];
    const { mappings } = mapFacts(facts);
    expect(
      checkStatementTotals(await cubeFor(conn(), facts, mappings), facts, totals),
    ).toMatchObject({ status: "pass" });
    const withBalance = facts.find((x) => x.closing !== 0n);
    const bad = await cubeFor(
      conn(),
      facts,
      mappings.map((m) =>
        m.ledgerKey === withBalance?.ledgerKey ? { ...m, head: "NOT_A_HEAD" } : m,
      ),
    );
    expect(checkStatementTotals(bad, facts, totals)).toMatchObject({
      status: "fail",
      failureClass: "platform_fault",
    });
  });
});

describe("V3 trial balance", () => {
  it("fails on the unbalanced fixture only", () => {
    expect(checkTrialBalance(parseTb(at(clean, 0)).facts, 0n).status).toBe("pass");
    expect(checkTrialBalance(parseTb(broken("unbalanced_tb")).facts, 0n)).toMatchObject({
      status: "fail",
      failureClass: "data_fault",
    });
    expect(
      checkTrialBalance(parseTb(broken("unbalanced_tb")).facts, 1_000_000n).status,
    ).toBe("pass");
  });
});

describe("V4 subtotals", () => {
  it("fails on the subtotal-mismatch fixture only", () => {
    const ok = parseTb(at(clean, 0));
    expect(
      checkSubtotals([{ period: month(at(clean, 0)), checks: ok.report.checks }]).status,
    ).toBe("pass");
    const bad = parseTb(broken("subtotal_mismatch"));
    expect(
      checkSubtotals([{ period: "2025-04" as PeriodId, checks: bad.report.checks }]),
    ).toMatchObject({ status: "fail", severity: "blocking" });
  });
});

describe("V5 balance sheet", () => {
  it("balances on clean data and fails on the unbalanced fixture", async () => {
    const facts = parseTb(at(clean, 3)).facts;
    expect(checkBalanceSheet(await cubeFor(conn(), facts), 0n).status).toBe("pass");
    const bad = parseTb(broken("unbalanced_tb")).facts;
    expect(checkBalanceSheet(await cubeFor(conn(), bad), 0n)).toMatchObject({
      status: "fail",
      failureClass: "data_fault",
    });
  });
});

describe("V6 profit reconciliation", () => {
  it("reconciles to the P&L statement's net profit, and warns when it does not", async () => {
    const files = clean.slice(0, 3);
    const cube = await cubeFor(
      conn(),
      files.flatMap((f) => parseTb(f).facts),
    );
    const statements = files.map((f) => ({
      period: month(f),
      netProfitFytd: BigInt(trading?.statements[month(f)]?.netProfitFytd ?? "0"),
    }));
    expect(checkProfitReconciliation(cube, statements, 0n).status).toBe("pass");
    const off = statements.map((s, i) =>
      i === 2 ? { ...s, netProfitFytd: s.netProfitFytd + 100n } : s,
    );
    expect(checkProfitReconciliation(cube, off, 0n)).toMatchObject({
      status: "fail",
      severity: "warning",
    });
  });
});

describe("V7 continuity", () => {
  it("flags the backdated-change fixture against the stored snapshot as a restatement", async () => {
    const may = at(clean, 1);
    const snapshotCube = await cubeFor(conn(), parseTb(may).facts);
    const closings = new Map(
      snapshotCube.ledgerRows.map((r) => [r.ledgerKey, r.closing]),
    );
    const isPl = (f: { groupPath: readonly string[] }) =>
      primaryOf(f.groupPath[0] ?? "")?.statement === "profit_and_loss";
    const previous = { period: month(may), closings };

    const june = parseTb(at(clean, 2)).facts;
    expect(checkContinuity(june, previous, { fyStartMonth: 4, isPl }).status).toBe(
      "pass",
    );
    const revised = parseTb(broken("backdated_change")).facts;
    expect(month(broken("backdated_change"))).toBe(month(may));
    const v7 = checkContinuity(revised, previous, { fyStartMonth: 4, isPl });
    expect(v7).toMatchObject({ status: "fail", severity: "warning", restatement: true });
    expect(v7.details).toHaveLength(1);
  });
});

describe("V8 periods", () => {
  it("fails when a month is loaded twice or is missing", () => {
    const all = clean.map((f) => ({
      period: month(f),
      fileId: f.name,
      role: "trial_balance",
    }));
    const range = { from: "2025-04" as PeriodId, to: "2026-05" as PeriodId };
    expect(checkPeriods(all, range).status).toBe("pass");
    const dup = broken("duplicate_period");
    expect(
      checkPeriods(
        [...all, { period: month(dup), fileId: dup.name, role: "trial_balance" }],
        range,
      ),
    ).toMatchObject({ status: "fail", severity: "blocking" });
    const missing = set.truths[0]?.brokenSet.missingMonth;
    expect(
      checkPeriods(
        all.filter((f) => f.period !== missing),
        range,
      ),
    ).toMatchObject({ status: "fail" });
  });
});

describe("V9 duplicate transactions", () => {
  it("warns when the same vouchers arrive in two files", () => {
    const register = set.files.find(
      (f) => f.report === "sales_register" && f.variant === "clean",
    );
    if (register === undefined) throw new Error("no sales register fixture");
    const grid = gridOf(register);
    const header = detectHeader(grid);
    if (header === null) throw new Error("no header");
    const report = parseVoucherReport(grid, header);
    const txns = (fileId: string): TxnFact[] =>
      report.lines
        .filter((l) => (l.amount ?? l.taxable) !== null && l.date !== null)
        .map((l) => ({
          date: l.date ?? "",
          period: (l.date ?? "").slice(0, 7) as PeriodId,
          voucherType: l.vchType,
          voucherNo: l.vchNo,
          ledger: l.particulars,
          party: null,
          amount: l.amount ?? l.taxable ?? 0n,
          source: { fileId, sheet: grid.name, sourceRow: l.sourceRow },
        }));
    expect(txns("a").length).toBeGreaterThan(0);
    expect(checkDuplicateTransactions(txns("a")).status).toBe("pass");
    expect(checkDuplicateTransactions([...txns("a"), ...txns("b")])).toMatchObject({
      status: "fail",
      severity: "warning",
    });
  });
});

describe("V10 sign sanity", () => {
  it("warns when a head runs against its normal balance", async () => {
    const facts = parseTb(at(clean, 0)).facts;
    const { mappings } = mapFacts(facts);
    const heads = ["REV", "EMP", "OPEX"];
    expect(checkSigns(await cubeFor(conn(), facts, mappings), heads).status).toBe("pass");
    // Revenue booked into an expense head makes other expenses negative.
    const swapped = mappings.map((m) =>
      m.head === "REV_PRODUCTS" ? { ...m, head: "OPEX_OTHER" } : m,
    );
    expect(checkSigns(await cubeFor(conn(), facts, swapped), heads)).toMatchObject({
      status: "fail",
      severity: "warning",
    });
    // A genuine case in the synthetic books: a large closing-stock increase makes April direct costs negative.
    expect(
      checkSigns(await cubeFor(conn(), facts, mappings), ["COGS"]).details[0]?.label,
    ).toBe("2025-04 Direct costs");
  });
});
