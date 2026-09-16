/**
 * Commentary facts pack and the placeholder rule (SPEC §25, §2.7, V12).
 *
 * The facts pack is built deterministically from the stored metric store. Every value has an ID;
 * the model sees values only as formatted text for context and must refer to them through
 * placeholders:
 *
 *   {{m:<metric>@<period>}}               a metric value
 *   {{mv:<metric>.<mom|yoy>@<period>:abs|pct}}  a variance form
 *   {{d:<token>}}                          a dimension value (party/employee token, rehydrated in the browser)
 *   {{p:<YYYY-MM>}}                        a period label
 *
 * The post-check parses placeholders (every ID must exist in the pack), strips them, removes the
 * configured allowlist phrases, and rejects any remaining digit. It runs on the server as the AI
 * stage's check (one repair, then platform fault) and again in the browser before rendering.
 */

import type { PeriodId } from "@magicmis/core/time";

import type { MetricValue } from "./values";

export interface Fact {
  /** Placeholder body, e.g. `m:revenue@2026-05` or `mv:revenue.mom@2026-05:pct`. */
  readonly id: string;
  readonly label: string;
  /** Formatted for the prompt only; never copied into output. */
  readonly text: string;
}

export interface FactsPack {
  readonly period: PeriodId;
  readonly facts: readonly Fact[];
  readonly dimensions: readonly { readonly id: string; readonly label: string }[];
  readonly periods: readonly string[];
  readonly warnings: readonly string[];
}

export const METRIC_LABELS: Readonly<Record<string, string>> = {
  revenue: "Revenue from operations",
  direct_costs: "Direct costs",
  gross_profit: "Gross profit",
  gross_margin_pct: "Gross margin %",
  employee_cost: "Employee cost",
  other_opex: "Other operating expenses",
  ebitda: "EBITDA",
  ebitda_pct: "EBITDA %",
  other_income: "Other income",
  depreciation: "Depreciation",
  finance_cost: "Finance costs",
  pbt: "Profit before tax",
  tax: "Tax",
  pat: "Profit after tax",
  pat_pct: "PAT %",
  receivables: "Trade receivables",
  payables: "Trade payables",
  inventory: "Inventories",
  cash_and_bank: "Cash and bank",
  working_capital: "Working capital",
  current_ratio: "Current ratio",
  dso: "Debtor days",
  dpo: "Creditor days",
};

/** Headline metrics are always in the pack; the rest only when a variance is material. */
const HEADLINE = new Set(["revenue", "gross_profit", "ebitda", "pat"]);

const abs = (x: bigint) => (x < 0n ? -x : x);

function formatRupees(paise: string): string {
  const v = BigInt(paise);
  const rupees = abs(v) / 100n;
  const digits = rupees.toString();
  const grouped =
    digits.length <= 3
      ? digits
      : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/gu, ",")},${digits.slice(-3)}`;
  return `${v < 0n ? "-" : ""}₹${grouped}`;
}

const formatValue = (v: MetricValue): string =>
  v.value === null
    ? "not available"
    : v.unit === "paise"
      ? formatRupees(v.value)
      : v.unit === "percent"
        ? `${v.value}%`
        : v.value;

/** A metric value as prompt text (rupees with Indian grouping, percent, decimals). */
export const formatFactText = formatValue;

function isMaterial(
  change: MetricValue | undefined,
  pct: MetricValue | undefined,
  materiality: { pct: string; absMinor: string },
): boolean {
  if (change?.value == null) return false;
  if (
    abs(BigInt(change.value)) >= BigInt(materiality.absMinor) &&
    BigInt(materiality.absMinor) > 0n
  )
    return true;
  if (pct?.value == null) return false;
  // pct values are 6-dp strings in percent; materiality.pct is a fraction ("0.05" = 5%).
  const [w = "0", f = ""] = pct.value.replace("-", "").split(".");
  const pctScaled = BigInt(`${w}${f.padEnd(6, "0").slice(0, 6)}`);
  const [mw = "0", mf = ""] = materiality.pct.split(".");
  const thresholdScaled = BigInt(`${mw}${mf.padEnd(6, "0").slice(0, 6)}`) * 100n;
  return pctScaled >= thresholdScaled;
}

export function buildFactsPack(input: {
  period: PeriodId;
  store: readonly MetricValue[];
  materiality: { pct: string; absMinor: string };
  warnings: readonly string[];
  contributors?: readonly { token: string; label: string }[];
}): FactsPack {
  const at = (id: string) =>
    input.store.find(
      (v) =>
        v.metricId === id &&
        v.period === input.period &&
        Object.keys(v.dims).length === 0,
    );
  const facts: Fact[] = [];
  const periods = new Set<string>([input.period]);
  for (const [metric, label] of Object.entries(METRIC_LABELS)) {
    const current = at(metric);
    if (current === undefined || current.value === null) continue;
    const mom = at(`${metric}.mom_abs`);
    const momPct = at(`${metric}.mom_pct`);
    const yoy = at(`${metric}.yoy_abs`);
    const yoyPct = at(`${metric}.yoy_pct`);
    const material =
      isMaterial(mom, momPct, input.materiality) ||
      isMaterial(yoy, yoyPct, input.materiality);
    if (!HEADLINE.has(metric) && !material) continue;
    facts.push({
      id: `m:${metric}@${input.period}`,
      label: `${label}, this month`,
      text: formatValue(current),
    });
    for (const [kind, change, pct] of [
      ["mom", mom, momPct],
      ["yoy", yoy, yoyPct],
    ] as const) {
      if (change?.value == null) continue;
      facts.push({
        id: `mv:${metric}.${kind}@${input.period}:abs`,
        label: `${label}, change ${kind === "mom" ? "on last month" : "on the same month last year"}`,
        text: formatValue(change),
      });
      if (pct?.value != null)
        facts.push({
          id: `mv:${metric}.${kind}@${input.period}:pct`,
          label: `${label}, % change ${kind === "mom" ? "on last month" : "on last year"}`,
          text: formatValue(pct),
        });
    }
  }
  return {
    period: input.period,
    facts,
    dimensions: (input.contributors ?? []).map((c) => ({
      id: `d:${c.token}`,
      label: c.label,
    })),
    periods: [...periods].map((p) => `p:${p}`),
    warnings: input.warnings,
  };
}

export const PLACEHOLDER = /\{\{\s*(m|mv|d|p):([^{}\s]+)\s*\}\}/gu;

export interface CommentaryOutput {
  readonly sections: readonly {
    readonly heading: string;
    readonly paragraphs: readonly { readonly text: string }[];
  }[];
}

/**
 * V12 post-check. Returns the problems; empty means the commentary may be rendered. `allowlist`
 * holds exact phrases (e.g. "Schedule III", "Ind AS 115") whose digits are permitted.
 */
export function checkCommentary(
  output: CommentaryOutput,
  pack: Pick<FactsPack, "facts" | "dimensions" | "periods">,
  allowlist: readonly string[],
): string[] {
  const known = new Set<string>([
    ...pack.facts.map((f) => f.id),
    ...pack.dimensions.map((d) => d.id),
    ...pack.periods,
  ]);
  const texts = output.sections.flatMap((s, si) => [
    { where: `section ${(si + 1).toString()} heading`, text: s.heading },
    ...s.paragraphs.map((p, pi) => ({
      where: `section ${(si + 1).toString()} paragraph ${(pi + 1).toString()}`,
      text: p.text,
    })),
  ]);
  return checkPlaceholderTexts(texts, known, allowlist, []);
}

/** Placeholders in chat answers: the commentary forms plus a query result cell (SPEC §27). */
export const ANSWER_PLACEHOLDER = /\{\{\s*(m|mv|d|p|q):([^{}\s]+)\s*\}\}/gu;

/** The shape of a query result a `{{q:<step>:<row>:<column>}}` placeholder may point into. */
export interface QueryResultShape {
  readonly stepId: string;
  readonly rowCount: number;
  readonly columns: readonly string[];
}

/**
 * V12 for any placeholder text: every placeholder resolves (facts by ID, query cells by step, row
 * and column), no digit or currency sign remains outside placeholders and allowlisted phrases.
 */
export function checkPlaceholderTexts(
  texts: readonly { readonly where: string; readonly text: string }[],
  known: ReadonlySet<string>,
  allowlist: readonly string[],
  queries: readonly QueryResultShape[],
): string[] {
  const problems: string[] = [];
  const steps = new Map(queries.map((q) => [q.stepId, q]));
  for (const { where, text } of texts) {
    for (const m of text.matchAll(ANSWER_PLACEHOLDER)) {
      const kind = m[1] ?? "";
      const body = m[2] ?? "";
      if (kind === "q") {
        const [stepId = "", row = "", column = ""] = body.split(":");
        const step = steps.get(stepId);
        const r = /^\d{1,3}$/u.test(row) ? Number.parseInt(row, 10) : -1;
        if (
          step === undefined ||
          r < 0 ||
          r >= step.rowCount ||
          !step.columns.includes(column)
        )
          problems.push(`${where}: unknown query cell {{q:${body}}}`);
      } else if (!known.has(`${kind}:${body}`)) {
        problems.push(`${where}: unknown placeholder {{${kind}:${body}}}`);
      }
    }
    let stripped = text.replace(ANSWER_PLACEHOLDER, " ");
    if (/\{\{|\}\}/u.test(stripped)) problems.push(`${where}: malformed placeholder`);
    for (const phrase of [...allowlist].sort((a, b) => b.length - a.length)) {
      stripped = stripped.split(phrase).join(" ");
    }
    // Any digit in any script (Devanagari and other numerals included) is a figure.
    if (/\p{Nd}/u.test(stripped))
      problems.push(`${where}: contains a number outside a placeholder`);
    if (/[₹$€£¥]/u.test(stripped))
      problems.push(`${where}: contains a currency sign outside a placeholder`);
  }
  return problems;
}
