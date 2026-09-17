/**
 * Mapping, compute, validation, rendering and the completion payloads (SPEC §18–§24), in the
 * browser. The server's part of a job (pricing, AI stages, settlement, storage) is reached through
 * the callbacks the caller wires to API endpoints; nothing here decides a price or a charge.
 */

import type { PeriodId } from "@magicmis/core/time";
import {
  ageing,
  buildStore,
  checkBalanceSheet,
  checkContinuity,
  checkCoverage,
  checkPeriods,
  checkProfitReconciliation,
  checkSigns,
  checkStatementTotals,
  checkSubtotals,
  checkTrialBalance,
  computeCube,
  computeMetricStore,
  ENGINE_VERSION,
  payroll,
  type AgeingBucket,
  type CheckResult,
  type HeadCube,
  type LedgerFact,
  type MetricValue,
  type SnapshotPayload,
  metricStoreSchema,
} from "@magicmis/engine";
import type { DuckConn } from "@magicmis/ingest/duckdb";
import {
  renderWorkbook,
  verifyWorkbook,
  type RenderedWorkbook,
} from "@magicmis/render-excel";
import {
  head,
  indexLibrary,
  isHeadCode,
  normaliseName,
  refreshRows,
  runCascade,
  writeBack,
  type AccountRule,
  type CompanyRule,
  type ConfirmedMapping,
  type LibraryEntry,
  type Mapping,
  type MappingRules,
  type ReviewRow,
} from "@magicmis/semantic";
import { primaryOf } from "@magicmis/tally";
import {
  MONTHLY_FINANCIAL_MIS,
  resolveSections,
  type TemplateSpec,
} from "@magicmis/templates";

import type { Prepared } from "./prepare";

export interface PriorBalance {
  readonly ledgerKey: string;
  readonly head: string;
  readonly period: string;
  readonly closing: string;
}

/** Earlier periods from stored snapshots, as facts, so comparatives and movement span months. */
export function priorFacts(
  prior: readonly PriorBalance[],
  loaded: ReadonlySet<string>,
): { facts: LedgerFact[]; mappings: Mapping[] } {
  const facts: LedgerFact[] = [];
  const heads = new Map<string, string>();
  for (const b of prior) {
    if (loaded.has(b.period)) continue;
    const parts = b.ledgerKey.split(" > ");
    facts.push({
      ledgerKey: b.ledgerKey,
      name: parts.at(-1) ?? b.ledgerKey,
      groupPath: parts.slice(0, -1),
      period: b.period as PeriodId,
      opening: null,
      debit: null,
      credit: null,
      closing: BigInt(b.closing),
      source: { fileId: "snapshot", sheet: b.period, sourceRow: 0 },
    });
    heads.set(b.ledgerKey, b.head);
  }
  const mappings: Mapping[] = [...heads.entries()].map(([ledgerKey, head]) => ({
    ledgerKey,
    head,
    source: "company_rule",
    confidence: "high",
    needsReview: false,
    reason: null,
  }));
  return { facts, mappings };
}

export interface MappingStep {
  readonly mappings: readonly Mapping[];
  /** Ledgers for the AI stage; empty means no AI call is needed. */
  readonly unmatched: readonly {
    ref: string;
    ledgerKey: string;
    name: string;
    groupPath: readonly string[];
  }[];
  /** Rows the user must see: all on setup, only new/changed/previously unmapped on refresh. */
  readonly reviewRows: readonly ReviewRow[];
}

export function mapStep(
  prepared: Prepared,
  input: {
    companyRules: readonly CompanyRule[];
    accountRules: readonly AccountRule[];
    library: readonly LibraryEntry[];
    fuzzyThreshold: string;
    /** Previous blueprint mappings (ledger key → head) on refresh; null on setup. */
    previous: ReadonlyMap<string, string> | null;
    displayName: (token: string) => string;
  },
): MappingStep {
  const latest = new Map<string, LedgerFact>();
  for (const f of prepared.facts) {
    const cur = latest.get(f.ledgerKey);
    if (cur === undefined || cur.period < f.period) latest.set(f.ledgerKey, f);
  }
  const out = runCascade(
    [...latest.values()].map((f) => ({ groupPath: f.groupPath, name: f.name })),
    {
      companyRules: input.companyRules,
      accountRules: input.accountRules,
      library: indexLibrary(input.library),
      fuzzyThreshold: input.fuzzyThreshold,
    },
  );
  const rows: ReviewRow[] = out.mappings.map((m) => {
    const f = latest.get(m.ledgerKey);
    return {
      ledgerKey: m.ledgerKey,
      displayName: input.displayName(f?.name ?? m.ledgerKey),
      parentGroup: f?.groupPath.at(-1) ?? "",
      sourceFile: f?.source.fileId ?? "",
      sourceSheet: f?.source.sheet ?? "",
      amountPaise: (f?.closing ?? 0n).toString(),
      proposed: m,
    };
  });
  return {
    mappings: out.mappings,
    unmatched: out.unmatched.map((u, i) => ({
      ref: `l${i.toString()}`,
      ledgerKey: u.ledgerKey,
      name: u.ledger.name,
      groupPath: u.ledger.groupPath,
    })),
    reviewRows: input.previous === null ? rows : refreshRows(rows, input.previous),
  };
}

export interface ValidationConfig {
  readonly tbTolerancePaise: bigint;
  readonly reconciliationTolerancePaise: bigint;
  readonly signSanityHeads: readonly string[];
  readonly ageingBuckets: readonly AgeingBucket[];
}

export function validate(
  cube: HeadCube,
  prepared: Prepared,
  input: {
    config: ValidationConfig;
    unmappedAccepted: boolean;
    expected: { from: PeriodId; to: PeriodId };
    previousSnapshot: { period: PeriodId; closings: ReadonlyMap<string, bigint> } | null;
    netProfitStatements: readonly { period: PeriodId; netProfitFytd: bigint }[];
  },
): CheckResult[] {
  const results: CheckResult[] = [
    ...checkCoverage(cube, { unmappedAccepted: input.unmappedAccepted }),
    checkStatementTotals(
      cube,
      prepared.facts,
      prepared.grandTotals
        .filter((g) => g.reported !== null)
        .map((g) => ({
          kind: "tb_grand_total" as const,
          period: g.period,
          reported: g.reported ?? {},
        })),
    ),
    checkTrialBalance(prepared.facts, input.config.tbTolerancePaise),
    checkSubtotals(prepared.subtotalChecks),
    checkBalanceSheet(cube, input.config.reconciliationTolerancePaise),
    checkProfitReconciliation(
      cube,
      input.netProfitStatements,
      input.config.reconciliationTolerancePaise,
    ),
    checkContinuity(prepared.facts, input.previousSnapshot, {
      fyStartMonth: cube.fyStartMonth,
      isPl: (f) => primaryOf(f.groupPath[0] ?? "")?.statement === "profit_and_loss",
    }),
    checkPeriods(
      prepared.reports
        .filter((r) => r.reportType === "trial_balance" && r.period !== null)
        .map((r) => ({
          period: r.period as PeriodId,
          fileId: r.fileId,
          role: "trial_balance",
        })),
      input.expected,
    ),
    checkSigns(cube, input.config.signSanityHeads),
  ];
  return deliverWithWarnings(results);
}

/**
 * A problem in the customer's data is reported, not a reason to withhold the report (ADR 0031).
 *
 * A trial balance out by a rounding difference, a month missing from a run, or a subtotal an
 * export got wrong used to stop the job and charge a diagnostic. The customer then had nothing
 * to work with. The checks still run and still say exactly what is wrong — in the workbook's
 * checks sheet, on the result screen and in the commentary — but the workbook is delivered.
 *
 * Only our own faults still block (a balance lost between source and report, a workbook whose
 * formulas do not reproduce the engine's figures): a report we know to be wrong is never sent.
 */
export function deliverWithWarnings(results: readonly CheckResult[]): CheckResult[] {
  return results.map((r) =>
    r.severity === "blocking" && r.failureClass === "data_fault"
      ? { ...r, severity: "warning" }
      : r,
  );
}

export interface OutputBundle {
  readonly rendered: RenderedWorkbook;
  readonly v11: CheckResult;
  readonly metrics: readonly MetricValue[];
  readonly snapshot: SnapshotPayload;
}

export async function computeAndRender(
  conn: DuckConn,
  prepared: Prepared,
  input: {
    mappings: readonly Mapping[];
    prior: readonly PriorBalance[];
    fyStartMonth: number;
    period: PeriodId;
    template: TemplateSpec;
    companyName: string;
    /** The company's reporting currency symbol (ADR 0030). Rupee if not stated. */
    currencySymbol?: string;
    tierLabel: string;
    snapshotVersion: number;
    generatedAt: Date;
    displayName: (ledgerKey: string) => string;
    /** Rehydrates redaction tokens in template labels (a recreated reference MIS keeps tokens). */
    labelText?: (label: string) => string;
    validation: (cube: HeadCube) => CheckResult[];
    ageingBuckets: readonly AgeingBucket[];
  },
): Promise<OutputBundle & { cube: HeadCube; checks: readonly CheckResult[] }> {
  const loaded = new Set<string>(prepared.periods);
  const earlier = priorFacts(input.prior, loaded);
  const cube = await computeCube(conn, {
    facts: [...earlier.facts, ...prepared.facts],
    mappings: [...earlier.mappings, ...input.mappings],
    fyStartMonth: input.fyStartMonth,
  });
  const checks = input.validation(cube);

  const extra: Record<string, MetricValue[]> = {};
  for (const b of prepared.bills) {
    const id = b.side === "receivable" ? "receivables_ageing" : "payables_ageing";
    extra[id] = [
      ...(extra[id] ?? []),
      ...ageing(b.lines, {
        asAt: b.asAt,
        period: b.period,
        buckets: input.ageingBuckets,
        side: b.side,
        fileId: b.fileId,
        sheet: b.sheet,
      }),
    ];
  }
  for (const p of prepared.pay)
    extra["payroll"] = [
      ...(extra["payroll"] ?? []),
      ...payroll(p.lines, { period: p.period, fileId: p.fileId, sheet: p.sheet }),
    ];

  const rendered = renderWorkbook({
    companyName: input.companyName,
    ...(input.currencySymbol === undefined
      ? {}
      : { currencySymbol: input.currencySymbol }),
    template: input.template,
    sections: resolveSections(input.template, prepared.available),
    period: input.period,
    tierLabel: input.tierLabel,
    generatedAt: input.generatedAt,
    snapshotVersion: input.snapshotVersion,
    cube,
    displayName: input.displayName,
    validation: checks,
    extraValues: extra,
    ...(input.labelText === undefined ? {} : { labelText: input.labelText }),
  });
  const v11 = verifyWorkbook(rendered.workbook, rendered.expectations);

  const metricIds = [
    ...new Set(
      // The built-in template's metrics too, so dashboards and commentary work on any template.
      [...input.template.sections, ...MONTHLY_FINANCIAL_MIS.sections].flatMap((s) =>
        s.rows.flatMap((r) => (r.kind === "metric" ? [r.metric] : [])),
      ),
    ),
  ];
  const metrics = [
    ...computeMetricStore(
      cube,
      metricIds.map((id) => ({ id, comparisons: ["mom", "yoy", "ytd"] as const })),
    ),
    ...Object.values(extra).flat(),
  ];
  const store = buildStore(dedupe(metrics), input.generatedAt);
  const snapshot: SnapshotPayload = {
    schemaVersion: 1,
    period: input.period,
    engineVersion: ENGINE_VERSION,
    sourceFingerprint:
      Object.values(prepared.fingerprints).sort().join(",").slice(0, 200) || "none",
    ledgerBalances: cube.ledgerRows
      .filter((r) => !r.implied)
      .map((r) => ({
        ledgerKey: r.ledgerKey,
        head: r.head,
        period: r.period,
        closing: r.closing.toString(),
        movement: r.movement === null ? null : r.movement.toString(),
      })),
    metricStore: metricStoreSchema.parse(JSON.parse(JSON.stringify(store))),
    validationResults: [...checks, v11].map((c) => ({
      id: c.id,
      status: c.status,
      severity: c.severity,
      failureClass: c.failureClass,
      amounts: { ...c.amounts },
    })),
  };
  return { rendered, v11, metrics, snapshot, cube, checks };
}

function dedupe(values: readonly MetricValue[]): MetricValue[] {
  const seen = new Map<string, MetricValue>();
  for (const v of values)
    seen.set(`${v.metricId}@${v.period}|${JSON.stringify(v.dims)}`, v);
  return [...seen.values()];
}

/**
 * Sides for balances that arrived without one (ADR 0031).
 *
 * A profit and loss or a one-column balance list gives every figure as a positive number.
 * Once each ledger is mapped, its head says which side it normally sits on — revenue and
 * liabilities credit, assets and expenses debit — and the balance takes that side. Only facts
 * listed as unsigned are touched; a balance whose side the export stated is never changed.
 */
export function applyNormalSides(
  facts: readonly LedgerFact[],
  mappings: readonly Mapping[],
  unsigned: ReadonlySet<string>,
): LedgerFact[] {
  if (unsigned.size === 0) return [...facts];
  const heads = new Map(mappings.map((m) => [m.ledgerKey, m.head]));
  return facts.map((f) => {
    if (!unsigned.has(`${f.ledgerKey}|${f.period}`)) return f;
    const code = heads.get(f.ledgerKey);
    if (code === undefined || !isHeadCode(code)) return f;
    const magnitude = f.closing < 0n ? -f.closing : f.closing;
    return {
      ...f,
      closing: head(code).normalBalance === "credit" ? -magnitude : magnitude,
    };
  });
}

/** Next blueprint rules from the confirmed review (SPEC §18 write-back). */
export function nextRules(
  previous: MappingRules | null,
  mappings: readonly Mapping[],
  confirmed: readonly { ledgerKey: string; head: string; applyToAllCompanies: boolean }[],
  names: ReadonlyMap<string, string>,
  headsVersion: number,
) {
  const byKey = new Map(confirmed.map((c) => [c.ledgerKey, c]));
  const all: ConfirmedMapping[] = mappings.map((m) => {
    const c = byKey.get(m.ledgerKey);
    return {
      ...m,
      head: c?.head ?? m.head,
      applyToAllCompanies: c?.applyToAllCompanies ?? false,
      normalisedName: normaliseName(names.get(m.ledgerKey) ?? m.ledgerKey),
    };
  });
  return writeBack(previous, all, headsVersion);
}
