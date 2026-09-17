/**
 * Deterministic retriever for Quick chat (SPEC §27): picks metric facts from the company's stored
 * metric store by metric vocabulary and period words in the question. No AI, no embeddings; the
 * same question over the same store always yields the same facts, with placeholder IDs identical
 * to the commentary facts pack.
 */

import { addMonths, periodParts, type PeriodId } from "@magicmis/core/time";
import {
  formatFactText,
  type ReportingContext,
  METRIC_LABELS,
  type Fact,
  type MetricValue,
} from "@magicmis/engine";
import { METRIC_CATALOG, normaliseLabel } from "@magicmis/templates";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Metrics shown when the question names none. */
const HEADLINE = ["revenue", "gross_profit", "ebitda", "pat", "cash_and_bank"];

export interface Retrieved {
  readonly periods: readonly PeriodId[];
  readonly metrics: readonly string[];
  readonly facts: readonly Fact[];
}

const words = (text: string): string => ` ${normaliseLabel(text)} `;

/** Periods named in the question, relative to the latest stored month. */
export function periodsIn(
  question: string,
  latest: PeriodId,
  available: ReadonlySet<string>,
): PeriodId[] {
  const q = words(question);
  const out: PeriodId[] = [];
  const add = (p: PeriodId) => {
    if (available.has(p) && !out.includes(p)) out.push(p);
  };
  const { year: latestYear } = periodParts(latest);
  MONTHS.forEach((name, i) => {
    for (const form of [name, name.slice(0, 3)]) {
      const m = new RegExp(` ${form}(?: (\\d{4}|\\d{2}))? `, "u").exec(q);
      if (m === null) continue;
      const y =
        m[1] === undefined
          ? null
          : Number.parseInt(m[1].length === 2 ? `20${m[1]}` : m[1], 10);
      if (y !== null)
        add(`${y.toString()}-${String(i + 1).padStart(2, "0")}` as PeriodId);
      else {
        // A bare month means its latest occurrence on or before the latest stored month.
        const sameYear =
          `${latestYear.toString()}-${String(i + 1).padStart(2, "0")}` as PeriodId;
        add(sameYear <= latest ? sameYear : addMonths(sameYear, -12));
      }
      break;
    }
  });
  if (/ (last|previous|prior) month /u.test(q)) add(addMonths(latest, -1));
  if (/ (same month last year|last year) /u.test(q)) add(addMonths(latest, -12));
  if (out.length === 0 || / (this|current|latest) month /u.test(q)) add(latest);
  return out;
}

export function metricsIn(question: string): string[] {
  const q = words(question);
  const found: string[] = [];
  // Longest synonyms first, so "gross margin %" wins over "gross margin".
  const synonyms = METRIC_CATALOG.flatMap((m) =>
    m.synonyms.map((s) => ({ id: m.id, s: normaliseLabel(s) })),
  ).sort((a, b) => b.s.length - a.s.length);
  let rest = q;
  for (const { id, s } of synonyms) {
    if (s === "" || !rest.includes(` ${s} `)) continue;
    if (!found.includes(id)) found.push(id);
    rest = rest.split(` ${s} `).join("   ");
  }
  return found;
}

export function retrieveFacts(
  question: string,
  store: readonly MetricValue[],
  /**
   * `conventions` is the company's own currency and grouping (ADR 0034): the facts handed
   * to the model read in the same units as the dashboard and the workbook.
   */
  options: { maxFacts: number; conventions: ReportingContext },
): Retrieved {
  const available = new Set(store.map((v) => v.period));
  const latest = [...available].sort().at(-1);
  if (latest === undefined) return { periods: [], metrics: [], facts: [] };
  const periods = periodsIn(question, latest, available);
  const named = metricsIn(question);
  const metrics = named.length > 0 ? named : HEADLINE;
  const q = words(question);
  const wantsYtd = / (ytd|year to date|so far this year) /u.test(q);

  const byKey = new Map(
    store
      .filter((v) => Object.keys(v.dims).length === 0)
      .map((v) => [`${v.metricId}@${v.period}`, v]),
  );
  const facts: Fact[] = [];
  for (const metric of metrics) {
    const label = METRIC_LABELS[metric] ?? metric.replace(/_/gu, " ");
    for (const period of periods) {
      const at = (id: string) => byKey.get(`${id}@${period}`);
      const current = at(metric);
      if (current === undefined) continue;
      facts.push({
        id: `m:${metric}@${period}`,
        label: `${label}, ${period}`,
        text: formatFactText(current, options.conventions),
      });
      for (const kind of ["mom", "yoy"] as const) {
        for (const form of ["abs", "pct"] as const) {
          const v = at(`${metric}.${kind}_${form}`);
          if (v?.value == null) continue;
          facts.push({
            id: `mv:${metric}.${kind}@${period}:${form}`,
            label: `${label}, ${form === "pct" ? "% " : ""}change ${kind === "mom" ? "on the previous month" : "on the same month last year"}, ${period}`,
            text: formatFactText(v, options.conventions),
          });
        }
      }
      const ytd = at(`${metric}.ytd`);
      if (wantsYtd && ytd !== undefined)
        facts.push({
          id: `m:${metric}.ytd@${period}`,
          label: `${label}, year to date, ${period}`,
          text: formatFactText(ytd, options.conventions),
        });
      if (facts.length >= options.maxFacts) break;
    }
  }
  return { periods, metrics, facts: facts.slice(0, options.maxFacts) };
}
