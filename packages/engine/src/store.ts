/**
 * Metric store and lineage (SPEC §20). Every number in every output links to a metric ID; the
 * lineage panel walks source → calculation → result from this store.
 */

import type { PeriodId } from "@magicmis/core/time";
import type { Mapping } from "@magicmis/semantic";
import { isDescendantOrSelf } from "@magicmis/semantic";

import { ENGINE_VERSION } from "./compute";
import type { LedgerFact, SourceRef } from "./facts";
import type { MetricInput, MetricValue } from "./values";

export interface MetricStore {
  readonly engineVersion: string;
  readonly computedAt: string;
  readonly values: readonly MetricValue[];
}

export const metricKey = (
  metricId: string,
  period: string,
  dims: Readonly<Record<string, string>> = {},
): string =>
  `${metricId}@${period}${Object.keys(dims)
    .sort()
    .map((k) => `|${k}=${dims[k] ?? ""}`)
    .join("")}`;

/**
 * Several stored metric stores as one board, **newest run first** (ADR 0091).
 *
 * Every run recomputes every month it holds balances for, so the store of the run made last is
 * the best word on each figure it carries — including a month earlier than its own, when the run
 * brought a corrected or back-dated file. Ranking stores by the month they were stored under let
 * May's stale March beat the corrected March for good.
 *
 * A store owns a figure **for a whole month**, every split of it: a corrected debtors file that
 * no longer lists a party must not have that party filled back in from the store it replaced.
 */
export function mergeNewestFirst<V extends { metricId: string; period: string }>(
  stores: readonly (readonly V[])[],
): V[] {
  const owned = new Set<string>();
  const out: V[] = [];
  for (const values of stores) {
    const here = new Set<string>();
    for (const v of values) {
      const group = `${v.metricId}@${v.period}`;
      if (owned.has(group)) continue;
      here.add(group);
      out.push(v);
    }
    for (const g of here) owned.add(g);
  }
  return out;
}

export function buildStore(
  values: readonly MetricValue[],
  computedAt: Date,
): MetricStore {
  const seen = new Set<string>();
  for (const v of values) {
    const k = metricKey(v.metricId, v.period, v.dims);
    if (seen.has(k)) throw new Error(`duplicate metric value ${k}`);
    seen.add(k);
  }
  return { engineVersion: ENGINE_VERSION, computedAt: computedAt.toISOString(), values };
}

export type LineageNode =
  | {
      readonly kind: "metric";
      readonly metricId: string;
      readonly period: string;
      readonly value: string | null;
      readonly unit: string;
      readonly formula: string;
      readonly children: readonly LineageNode[];
    }
  | {
      readonly kind: "head";
      readonly head: string;
      readonly period: string;
      readonly field: "movement" | "closing";
      readonly ledgers: number;
      /** Source rows of the ledgers under the head (tokenised keys only). */
      readonly sources: readonly (SourceRef & { ledgerKey: string })[];
    }
  | { readonly kind: "source"; readonly input: Extract<MetricInput, { kind: "source" }> };

export function lineage(
  store: MetricStore,
  metricId: string,
  period: PeriodId,
  context: { facts: readonly LedgerFact[]; mappings: readonly Mapping[] },
  dims: Readonly<Record<string, string>> = {},
  depth = 0,
): LineageNode | null {
  const byKey = new Map(
    store.values.map((v) => [metricKey(v.metricId, v.period, v.dims), v]),
  );
  const v = byKey.get(metricKey(metricId, period, dims));
  if (v === undefined || depth > 20) return null;
  const headOf = new Map(context.mappings.map((m) => [m.ledgerKey, m.head]));
  const children: LineageNode[] = [];
  for (const input of v.inputs) {
    if (input.kind === "metric") {
      const child = lineage(store, input.metricId, input.period, context, {}, depth + 1);
      if (child !== null) children.push(child);
    } else if (input.kind === "head") {
      children.push({
        kind: "head",
        head: input.head,
        period: input.period,
        field: input.field,
        ledgers: input.ledgers,
        sources: context.facts
          .filter(
            (f) =>
              f.period === input.period &&
              isDescendantOrSelf(headOf.get(f.ledgerKey) ?? "UNMAPPED", input.head),
          )
          .map((f) => ({ ...f.source, ledgerKey: f.ledgerKey })),
      });
    } else {
      children.push({ kind: "source", input });
    }
  }
  return {
    kind: "metric",
    metricId,
    period,
    value: v.value,
    unit: v.unit,
    formula: v.formula,
    children,
  };
}

export { metricStoreSchema, metricValueSchema } from "./value-schema";
