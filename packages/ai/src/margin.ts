/**
 * Margin dashboard queries (SPEC §26), v1: AI cost ratio per action against captured credits,
 * flagged over the action's `max_ai_cost_ratio`; cache hit rate and fallback rate per stage;
 * estimation misses and absorbed cost. All sums are bigint paise / micro-USD, ratios exact to
 * four decimals (rounded up, so a flag is never hidden by rounding).
 */

import { divideRounded } from "@magicmis/core/money";
import type { Queryable } from "@magicmis/db/tx";
import { priceBookEntry, type ActionKey } from "@magicmis/wallet";

export interface ActionMargin {
  readonly actionKey: string;
  readonly jobs: number;
  readonly capturedCredits: bigint;
  readonly aiCostPaise: bigint;
  /** ai cost ÷ captured revenue, "0.0000" format; null when nothing was captured. */
  readonly ratio: string | null;
  readonly maxRatio: string | null;
  readonly overCap: boolean;
}

export interface StageHealth {
  readonly stage: string;
  readonly calls: number;
  readonly costMicroUsd: bigint;
  readonly cacheHitRate: string;
  readonly fallbackRate: string;
  readonly failureRate: string;
}

export interface MarginReport {
  readonly from: Date;
  readonly to: Date;
  readonly actions: readonly ActionMargin[];
  readonly stages: readonly StageHealth[];
  readonly estimationMisses: { readonly count: number; readonly costPaise: bigint };
  readonly absorbed: { readonly count: number; readonly costPaise: bigint };
}

export const ratio4 = (num: bigint, den: bigint): string => {
  if (den === 0n) return "0.0000";
  const s = divideRounded(num * 10_000n, den, "ceil")
    .toString()
    .padStart(5, "0");
  return `${s.slice(0, -4)}.${s.slice(-4)}`;
};

const toBp = (s: string): bigint => {
  const [w = "0", f = ""] = s.split(".");
  return BigInt(w) * 10_000n + BigInt((f + "0000").slice(0, 4));
};

export async function marginReport(
  db: Queryable,
  from: Date,
  to: Date,
): Promise<MarginReport> {
  const actions = await db.query<{
    action_key: string;
    jobs: number;
    captured: string;
    ai_paise: string;
  }>(
    `select j.type as action_key, count(*)::int as jobs,
            coalesce(sum(j.captured_credits), 0)::text as captured,
            coalesce(sum(j.actual_ai_cost_paise), 0)::text as ai_paise
     from public.jobs j
     where j.created_at >= $1 and j.created_at < $2
     group by j.type order by j.type`,
    [from, to],
  );

  const out: ActionMargin[] = [];
  for (const a of actions.rows) {
    const captured = BigInt(a.captured);
    const ai = BigInt(a.ai_paise);
    let maxRatio: string | null = null;
    try {
      maxRatio = (await priceBookEntry(db, a.action_key as ActionKey, to))
        .max_ai_cost_ratio;
    } catch {
      maxRatio = null;
    }
    const ratio = captured === 0n ? null : ratio4(ai, captured * 100n);
    out.push({
      actionKey: a.action_key,
      jobs: a.jobs,
      capturedCredits: captured,
      aiCostPaise: ai,
      ratio,
      maxRatio,
      // Cost with no captured revenue is always a flag.
      overCap:
        (captured === 0n && ai > 0n) ||
        (ratio !== null && maxRatio !== null && toBp(ratio) > toBp(maxRatio)),
    });
  }

  const stages = await db.query<{
    stage: string;
    calls: number;
    cost: string;
    input: string;
    cache_read: string;
    cache_write: string;
    fallbacks: number;
    failures: number;
  }>(
    `select stage, count(*)::int as calls, coalesce(sum(usd_cost_micro), 0)::text as cost,
            coalesce(sum(input_tokens), 0)::text as input,
            coalesce(sum(cache_read_input_tokens), 0)::text as cache_read,
            coalesce(sum(cache_creation_input_tokens), 0)::text as cache_write,
            count(*) filter (where fallback_from is not null)::int as fallbacks,
            count(*) filter (where status <> 'ok')::int as failures
     from public.ai_calls where created_at >= $1 and created_at < $2
     group by stage order by stage`,
    [from, to],
  );

  const events = await db.query<{ kind: string; n: number; paise: string }>(
    `select kind, count(*)::int as n, coalesce(sum(cost_paise), 0)::text as paise
     from public.margin_events where created_at >= $1 and created_at < $2 group by kind`,
    [from, to],
  );
  const ev = (kind: string) => {
    const row = events.rows.find((e) => e.kind === kind);
    return { count: row?.n ?? 0, costPaise: BigInt(row?.paise ?? "0") };
  };

  return {
    from,
    to,
    actions: out,
    stages: stages.rows.map((s) => {
      const cacheRead = BigInt(s.cache_read);
      const totalInput = BigInt(s.input) + cacheRead + BigInt(s.cache_write);
      return {
        stage: s.stage,
        calls: s.calls,
        costMicroUsd: BigInt(s.cost),
        cacheHitRate: ratio4(cacheRead, totalInput),
        fallbackRate: ratio4(BigInt(s.fallbacks), BigInt(s.calls)),
        failureRate: ratio4(BigInt(s.failures), BigInt(s.calls)),
      };
    }),
    estimationMisses: ev("estimation_miss"),
    absorbed: ev("platform_absorbed"),
  };
}

export interface RegistryEntry {
  readonly modelId: string;
  readonly inputPricePerMTokMicroUsd: bigint;
  readonly outputPricePerMTokMicroUsd: bigint;
  readonly available: boolean;
  readonly version: number;
  readonly sourceUrl: string;
  readonly verifiedAt: Date;
  readonly stale: boolean;
}

/** Model registry view; entries not re-verified within `staleDays` are flagged. */
export async function modelRegistryView(
  db: Queryable,
  staleDays: number,
  now: Date = new Date(),
): Promise<RegistryEntry[]> {
  const r = await db.query<{
    model_id: string;
    input: string;
    output: string;
    available: boolean;
    version: number;
    source_url: string;
    verified_at: Date;
  }>(
    `select distinct on (model_id) model_id, input_price_per_mtok_micro_usd::text as input,
            output_price_per_mtok_micro_usd::text as output, available, version, source_url, verified_at
     from public.model_registry order by model_id, version desc`,
  );
  return r.rows.map((m) => ({
    modelId: m.model_id,
    inputPricePerMTokMicroUsd: BigInt(m.input),
    outputPricePerMTokMicroUsd: BigInt(m.output),
    available: m.available,
    version: m.version,
    sourceUrl: m.source_url,
    verifiedAt: m.verified_at,
    stale: now.getTime() - m.verified_at.getTime() > staleDays * 86_400_000,
  }));
}
