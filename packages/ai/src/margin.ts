/**
 * Margin dashboard (SPEC §26), filterable by date, action, tier and account:
 *
 * - per action (jobs, chat messages, memory fees): credits captured and their INR value, AI cost,
 *   AI cost ratio overall and at p50/p90, flagged over the action's `max_ai_cost_ratio`;
 * - estimator drift (actual vs estimated AI cost), quote rate and acceptance rate;
 * - per stage: cache hit rate, fallback rate, failure rate; batch share of commentary;
 * - failure rates by class, absorbed platform-failure cost, `estimation_miss` cost;
 * - expired credits (breakage), memory fee revenue;
 * - daily gross margin estimate: captured value − AI cost − payment fee % − infra cost per day.
 *
 * Sums are bigint paise / micro-USD; ratios are exact to four decimals and rounded up, so a flag is
 * never hidden by rounding. 1 credit = ₹1 = 100 paise (SPEC §2.4).
 */

import {
  divideRounded,
  fxRate,
  microUsd,
  microUsdToPaise,
  percentOf,
} from "@magicmis/core/money";
import { readConfig } from "@magicmis/db/config";
import type { Queryable } from "@magicmis/db/tx";
import {
  computePrice,
  priceBookEntry,
  type ActionKey,
  type DeliveryMode,
  type PriceBookRow,
  type Tier,
} from "@magicmis/wallet";
import { z } from "zod";

export interface ActionMargin {
  readonly actionKey: string;
  /** Jobs or chat messages. */
  readonly jobs: number;
  readonly capturedCredits: bigint;
  readonly aiCostPaise: bigint;
  /** ai cost ÷ captured revenue, "0.0000" format; null when nothing was captured. */
  readonly ratio: string | null;
  /** Per-item ratios over items with a capture; null when there are none. */
  readonly p50: string | null;
  readonly p90: string | null;
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

export interface MarginFilters {
  readonly actionKey?: string;
  readonly tier?: string;
  readonly accountId?: string;
}

export interface MarginReport {
  readonly from: Date;
  readonly to: Date;
  readonly actions: readonly ActionMargin[];
  readonly stages: readonly StageHealth[];
  readonly estimationMisses: {
    readonly count: number;
    readonly costPaise: bigint;
  };
  readonly absorbed: { readonly count: number; readonly costPaise: bigint };
  readonly estimator: {
    readonly jobs: number;
    /** Σ actual ÷ Σ estimated AI cost. */
    readonly actualToEstimate: string;
    readonly underestimated: number;
  };
  readonly quotes: {
    readonly rate: string;
    readonly acceptance: string;
    readonly offered: number;
  };
  readonly commentaryBatchShare: string;
  readonly failures: readonly {
    readonly failureClass: string;
    readonly jobs: number;
    readonly rate: string;
  }[];
  readonly breakageCredits: bigint;
  readonly memoryFeeCredits: bigint;
  readonly grossMargin: {
    readonly capturedValuePaise: bigint;
    readonly aiCostPaise: bigint;
    readonly paymentFeesPaise: bigint;
    readonly infraCostPaise: bigint;
    readonly marginPaise: bigint;
    readonly days: number;
    readonly perDayPaise: bigint;
  };
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

const fromBp = (bp: bigint): string => {
  const s = bp.toString().padStart(5, "0");
  return `${s.slice(0, -4)}.${s.slice(-4)}`;
};

/** Nearest-rank percentile of basis-point ratios. */
function percentile(sorted: readonly bigint[], p: number): string | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return fromBp(sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0n);
}

const CHAT_ACTION: Record<string, string> = {
  quick: "chat_quick",
  deep: "chat_deep",
  investigate: "chat_deep",
  edit: "chat_edit",
};

export async function marginReport(
  db: Queryable,
  from: Date,
  to: Date,
  filters: MarginFilters = {},
): Promise<MarginReport> {
  const account = filters.accountId ?? null;
  const tier = filters.tier ?? null;

  // Items: jobs and priced chat messages, each with its captured credits and AI cost.
  const items = await db.query<{
    action_key: string;
    captured: string;
    ai_paise: string;
  }>(
    `select j.type as action_key, coalesce(j.captured_credits, 0)::text as captured, j.actual_ai_cost_paise::text as ai_paise
     from public.jobs j
     where j.created_at >= $1 and j.created_at < $2 and ($3::uuid is null or j.account_id = $3) and ($4::text is null or j.tier = $4)
     union all
     select m.message_type as action_key, m.credits_charged::text as captured,
            (select coalesce(sum(c.inr_cost_paise), 0) from public.ai_calls c where c.chat_message_id = m.id)::text as ai_paise
     from public.chat_messages m
     where m.role = 'user' and m.created_at >= $1 and m.created_at < $2
       and ($3::uuid is null or m.account_id = $3) and ($4::text is null or m.tier = $4)`,
    [from, to, account, tier],
  );
  const grouped = new Map<
    string,
    { n: number; captured: bigint; ai: bigint; ratios: bigint[] }
  >();
  for (const row of items.rows) {
    const key = CHAT_ACTION[row.action_key] ?? row.action_key;
    if (filters.actionKey !== undefined && filters.actionKey !== key) continue;
    const g = grouped.get(key) ?? { n: 0, captured: 0n, ai: 0n, ratios: [] };
    const captured = BigInt(row.captured);
    const ai = BigInt(row.ai_paise);
    g.n += 1;
    g.captured += captured;
    g.ai += ai;
    if (captured > 0n)
      g.ratios.push(divideRounded(ai * 10_000n, captured * 100n, "ceil"));
    grouped.set(key, g);
  }

  const actions: ActionMargin[] = [];
  for (const [actionKey, g] of [...grouped.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    let maxRatio: string | null = null;
    try {
      maxRatio = (await priceBookEntry(db, actionKey as ActionKey, to)).max_ai_cost_ratio;
    } catch {
      maxRatio = null;
    }
    const ratio = g.captured === 0n ? null : ratio4(g.ai, g.captured * 100n);
    const sorted = [...g.ratios].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    actions.push({
      actionKey,
      jobs: g.n,
      capturedCredits: g.captured,
      aiCostPaise: g.ai,
      ratio,
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      maxRatio,
      // Cost with no captured revenue is always a flag.
      overCap:
        (g.captured === 0n && g.ai > 0n) ||
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
    batch: number;
  }>(
    `select stage, count(*)::int as calls, coalesce(sum(usd_cost_micro), 0)::text as cost,
            coalesce(sum(input_tokens), 0)::text as input,
            coalesce(sum(cache_read_input_tokens), 0)::text as cache_read,
            coalesce(sum(cache_creation_input_tokens), 0)::text as cache_write,
            count(*) filter (where fallback_from is not null)::int as fallbacks,
            count(*) filter (where status <> 'ok')::int as failures,
            count(*) filter (where is_batch)::int as batch
     from public.ai_calls where created_at >= $1 and created_at < $2 and ($3::uuid is null or account_id = $3)
     group by stage order by stage`,
    [from, to, account],
  );

  const events = await db.query<{ kind: string; n: number; paise: string }>(
    `select kind, count(*)::int as n, coalesce(sum(cost_paise), 0)::text as paise
     from public.margin_events where created_at >= $1 and created_at < $2 and ($3::uuid is null or account_id = $3) group by kind`,
    [from, to, account],
  );
  const ev = (kind: string) => {
    const row = events.rows.find((e) => e.kind === kind);
    return { count: row?.n ?? 0, costPaise: BigInt(row?.paise ?? "0") };
  };

  const jobFacts = await db.query<{
    total: number;
    quoted: number;
    estimated: string;
    actual: string;
    estimated_jobs: number;
    under: number;
  }>(
    `select count(*)::int as total,
            count(*) filter (where quote_id is not null)::int as quoted,
            coalesce(sum(estimated_ai_cost_micro_usd) filter (where state = 'completed' and estimated_ai_cost_micro_usd > 0), 0)::text as estimated,
            coalesce(sum(actual_ai_cost_micro_usd) filter (where state = 'completed' and estimated_ai_cost_micro_usd > 0), 0)::text as actual,
            count(*) filter (where state = 'completed' and estimated_ai_cost_micro_usd > 0)::int as estimated_jobs,
            count(*) filter (where state = 'completed' and actual_ai_cost_micro_usd > estimated_ai_cost_micro_usd)::int as under
     from public.jobs where created_at >= $1 and created_at < $2 and ($3::uuid is null or account_id = $3) and ($4::text is null or tier = $4)
       and ($5::text is null or type = $5)`,
    [from, to, account, tier, filters.actionKey ?? null],
  );
  const jf = jobFacts.rows[0];
  const quotes = await db.query<{ offered: number; accepted: number }>(
    `select count(*)::int as offered, count(*) filter (where status = 'accepted')::int as accepted
     from public.quotes where created_at >= $1 and created_at < $2 and ($3::uuid is null or account_id = $3)`,
    [from, to, account],
  );
  const failures = await db.query<{ failure_class: string; n: number }>(
    `select failure_class, count(*)::int as n from public.jobs
     where failure_class is not null and created_at >= $1 and created_at < $2 and ($3::uuid is null or account_id = $3)
     group by failure_class order by failure_class`,
    [from, to, account],
  );
  const money = await db.query<{ breakage: string; fees: string }>(
    `select (select coalesce(sum(abs(amount)), 0) from public.credit_ledger
              where entry_type = 'expire' and created_at >= $1 and created_at < $2 and ($3::uuid is null or account_id = $3))::text as breakage,
            (select coalesce(sum(credits), 0) from public.company_fee_charges
              where status = 'captured' and created_at >= $1 and created_at < $2 and ($3::uuid is null or account_id = $3))::text as fees`,
    [from, to, account],
  );
  const memoryFeeCredits = BigInt(money.rows[0]?.fees ?? "0");

  /*
   * The gateway takes its cut once, when money arrives, on the amount the customer paid —
   * not on credits as they are spent (ADR 0052). Charging it against captured credits was
   * wrong three ways: bonus credits carry no money, a pack bought in one month and spent
   * over the next six put the whole fee in the wrong month, and a bank transfer pays no
   * gateway fee at all. So the fee is computed from the purchases that settled inside the
   * window, by the method that actually charges one, at the rate for their own currency.
   */
  const [feeByCurrency, infraPerDay, fx] = await Promise.all([
    readConfig(
      db,
      "admin.payment_fee_percent_by_currency",
      z.record(z.string(), z.string().regex(/^\d+(\.\d+)?$/u)),
    ),
    readConfig(db, "admin.infra_cost_paise_per_day", z.number().int().nonnegative()),
    readConfig(
      db,
      "ai.fx",
      z.object({ inr_per_usd: z.string(), buffer_percent: z.string() }),
    ),
  ]);
  const settled = await db.query<{ currency: string; total: string }>(
    `select currency, coalesce(sum(total_minor), 0)::text as total
       from public.purchases
      where method = 'razorpay'
        and status in ('paid', 'credited')
        and credited_at >= $1 and credited_at < $2
        and ($3::uuid is null or account_id = $3)
      group by currency`,
    [from, to, account],
  );
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
  const capturedValuePaise =
    (actions.reduce((s, a) => s + a.capturedCredits, 0n) + memoryFeeCredits) * 100n;
  const aiCostPaise = actions.reduce((s, a) => s + a.aiCostPaise, 0n);
  // A dollar purchase is in cents; the margin report is in paise throughout, so it is
  // converted at the same buffered rate that values vendor cost. Reporting only: no
  // customer-facing amount is ever converted (SPEC §2.14).
  const rate = fxRate(fx.inr_per_usd, fx.buffer_percent);
  const paymentFeesPaise = settled.rows.reduce((sum, row) => {
    const minor = BigInt(row.total);
    const paise =
      row.currency === "USD" ? microUsdToPaise(microUsd(minor * 10_000n), rate) : minor;
    return sum + percentOf(paise, feeByCurrency[row.currency] ?? "0", "ceil");
  }, 0n);
  const infraCostPaise = BigInt(infraPerDay) * BigInt(days);
  const marginPaise =
    capturedValuePaise - aiCostPaise - paymentFeesPaise - infraCostPaise;
  const commentary = stages.rows.find((s) => s.stage === "commentary");
  const total = BigInt(jf?.total ?? 0);

  return {
    from,
    to,
    actions,
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
    estimator: {
      jobs: jf?.estimated_jobs ?? 0,
      actualToEstimate: ratio4(BigInt(jf?.actual ?? "0"), BigInt(jf?.estimated ?? "0")),
      underestimated: jf?.under ?? 0,
    },
    quotes: {
      rate: ratio4(BigInt(jf?.quoted ?? 0), total),
      acceptance: ratio4(
        BigInt(quotes.rows[0]?.accepted ?? 0),
        BigInt(quotes.rows[0]?.offered ?? 0),
      ),
      offered: quotes.rows[0]?.offered ?? 0,
    },
    commentaryBatchShare: ratio4(
      BigInt(commentary?.batch ?? 0),
      BigInt(commentary?.calls ?? 0),
    ),
    failures: failures.rows.map((f) => ({
      failureClass: f.failure_class,
      jobs: f.n,
      rate: ratio4(BigInt(f.n), total),
    })),
    breakageCredits: BigInt(money.rows[0]?.breakage ?? "0"),
    memoryFeeCredits,
    grossMargin: {
      capturedValuePaise,
      aiCostPaise,
      paymentFeesPaise,
      infraCostPaise,
      marginPaise,
      days,
      perDayPaise: marginPaise / BigInt(days),
    },
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

export interface PriceProposal {
  readonly actionKey: ActionKey;
  readonly baseCredits: bigint;
  readonly multipliers: Readonly<Record<Tier, string>>;
  readonly instantSurchargeCredits: bigint;
  readonly maxAiCostRatio: string;
  readonly priceFromActionKey: ActionKey | null;
}

export interface PriceImpact {
  readonly actionKey: string;
  readonly days: number;
  /** Captured items priced from the book (quoted jobs keep their quote and are counted separately). */
  readonly items: number;
  readonly quotedItems: number;
  readonly aiCostPaise: bigint;
  readonly currentCredits: bigint;
  readonly proposedCredits: bigint;
  readonly currentRatio: string | null;
  readonly proposedRatio: string | null;
  readonly proposedMaxRatio: string;
  /** Items whose own AI cost would exceed the proposed price × proposed ratio. */
  readonly itemsOverProposedCap: number;
  readonly flagged: boolean;
}

/**
 * SPEC §26 price book editor: what the last `days` of captured usage would have earned under a
 * proposed version. Each item keeps its tier and delivery and its captured credits change by exactly
 * (proposed − current) book price, so setup add-ons priced elsewhere carry over unchanged. AI cost is
 * what was actually spent.
 */
export async function priceImpactPreview(
  db: Queryable,
  proposal: PriceProposal,
  now: Date = new Date(),
  days = 30,
): Promise<PriceImpact> {
  const from = new Date(now.getTime() - days * 86_400_000);
  const chatTypes = Object.entries(CHAT_ACTION)
    .filter(([, action]) => action === proposal.actionKey)
    .map(([type]) => type);
  const items = await db.query<{
    tier: Tier;
    delivery: DeliveryMode;
    captured: string;
    ai_paise: string;
    quoted: boolean;
  }>(
    `select j.tier, j.delivery_mode as delivery, j.captured_credits::text as captured,
            j.actual_ai_cost_paise::text as ai_paise, j.quote_id is not null as quoted
     from public.jobs j
     where j.type = $1 and j.created_at >= $2 and j.created_at < $3
       and j.captured_credits is not null and j.captured_credits > 0 and j.tier <> 'expert_plus'
     union all
     select m.tier, 'standard', m.credits_charged::text,
            (select coalesce(sum(c.inr_cost_paise), 0) from public.ai_calls c where c.chat_message_id = m.id)::text,
            false
     from public.chat_messages m
     where m.role = 'user' and m.message_type = any($4::text[]) and m.created_at >= $2 and m.created_at < $3
       and m.credits_charged > 0`,
    [proposal.actionKey, from, now, chatTypes],
  );
  const rounding = await readConfig(
    db,
    "pricing.rounding_mode",
    z.enum(["half_up", "half_even", "ceil", "floor", "trunc", "expand"]),
    now,
  );
  const resolve = async (row: PriceBookRow): Promise<PriceBookRow> =>
    row.price_from_action_key === null
      ? row
      : priceBookEntry(db, row.price_from_action_key, now);
  let current: PriceBookRow | null = null;
  try {
    current = await resolve(await priceBookEntry(db, proposal.actionKey, now));
  } catch {
    current = null;
  }
  const proposedRow = await resolve({
    action_key: proposal.actionKey,
    base_credits: proposal.baseCredits,
    tier_multipliers: proposal.multipliers,
    instant_surcharge_credits: proposal.instantSurchargeCredits,
    max_ai_cost_ratio: proposal.maxAiCostRatio,
    reservation_mode: "fixed",
    price_from_action_key: proposal.priceFromActionKey,
    enabled: true,
    version: 0,
  });

  let n = 0;
  let quoted = 0;
  let ai = 0n;
  let currentCredits = 0n;
  let proposedCredits = 0n;
  let over = 0;
  const capBp = toBp(proposal.maxAiCostRatio);
  for (const item of items.rows) {
    const captured = BigInt(item.captured);
    const itemAi = BigInt(item.ai_paise);
    ai += itemAi;
    currentCredits += captured;
    if (item.quoted || current === null) {
      quoted += item.quoted ? 1 : 0;
      proposedCredits += captured;
      continue;
    }
    n += 1;
    const delta =
      computePrice(proposedRow, item.tier, item.delivery, rounding) -
      computePrice(current, item.tier, item.delivery, rounding);
    const proposed = captured + delta > 0n ? captured + delta : 0n;
    proposedCredits += proposed;
    if (proposed === 0n ? itemAi > 0n : itemAi * 10_000n > proposed * 100n * capBp)
      over += 1;
  }
  const currentRatio = currentCredits === 0n ? null : ratio4(ai, currentCredits * 100n);
  const proposedRatio =
    proposedCredits === 0n ? null : ratio4(ai, proposedCredits * 100n);
  return {
    actionKey: proposal.actionKey,
    days,
    items: n,
    quotedItems: quoted,
    aiCostPaise: ai,
    currentCredits,
    proposedCredits,
    currentRatio,
    proposedRatio,
    proposedMaxRatio: proposal.maxAiCostRatio,
    itemsOverProposedCap: over,
    flagged:
      (proposedCredits === 0n && ai > 0n) ||
      (proposedRatio !== null && toBp(proposedRatio) > capBp),
  };
}
