import "server-only";

import { priceFor } from "@magicmis/wallet";
import type { Pool } from "pg";

/**
 * The business, as the owner needs to read it (ADR 0055).
 *
 * The margin page answers "is each action profitable". This answers the other questions: how
 * many people signed up, how many are actually using it, what is coming in, what is recurring,
 * and what the AI costs against it.
 *
 * Two things about a prepaid product shape every figure here, and both are stated on the page
 * rather than buried:
 *
 * 1. **Cash collected is not revenue earned.** A customer pays for credits today and spends
 *    them over months. Cash is the purchase; revenue is the spend. Both are reported, because
 *    the first is what reaches the bank and the second is what an accountant recognises, and
 *    they are different numbers in every month that is not flat.
 * 2. **There is no subscription, so "MRR" needs care.** The only contractual recurring charge
 *    is the monthly company memory fee. Everything else is consumption: real, repeating, but
 *    nobody has promised it. The two are reported separately and never added into one figure
 *    that pretends to be contracted.
 *
 * Every amount is integer minor units. Credits are integers, and one credit is ₹1 ex-GST
 * (SPEC §2.4), which is what lets a credit count be shown as a rupee figure.
 */

export interface Point {
  readonly label: string;
  readonly value: number;
}

export interface BusinessReport {
  readonly growth: {
    readonly accounts: number;
    readonly accountsLast30: number;
    readonly accountsLast7: number;
    /** Accounts that added at least one company. */
    readonly withCompany: number;
    /** Accounts that got as far as a first completed setup. The real activation number. */
    readonly activated: number;
    /** Accounts that bought credits at least once. */
    readonly paying: number;
    readonly signupsByWeek: readonly Point[];
    /** Median days from signing up to a first completed setup, over accounts that got there. */
    /** Kept as the string Postgres rounded, so no float touches it on the way out. */
    readonly medianDaysToFirstSetup: string | null;
  };
  readonly companies: {
    readonly total: number;
    readonly byState: readonly Point[];
    readonly setUp: number;
    /** Companies with a completed run in the last 30 days. What "active" means commercially. */
    readonly runLast30: number;
    readonly createdByMonth: readonly Point[];
  };
  readonly cash: {
    /** Money actually collected, by currency, in minor units. Credited purchases only. */
    readonly collected: readonly { currency: string; exTax: string; total: string }[];
    readonly last30: readonly { currency: string; exTax: string }[];
    readonly purchases: number;
    readonly byMonth: readonly Point[];
  };
  readonly recognised: {
    /** Credits captured, which is revenue earned. One credit is ₹1 ex-GST. */
    readonly creditsAllTime: string;
    readonly creditsLast30: string;
    readonly byMonth: readonly Point[];
    /** Unspent credits: cash already taken for work not yet done. */
    readonly deferredCredits: string;
  };
  readonly recurring: {
    /** Active companies times the current memory fee. The only contracted recurring revenue. */
    readonly committedMonthlyCredits: string;
    /** Consumption over the last 30 days, excluding the memory fee. A run rate, not a contract. */
    readonly consumptionMonthlyCredits: string;
    readonly feePerCompanyCredits: string;
    readonly activeCompanies: number;
    /** Twelve times the two together. A run rate; nobody has committed to it. */
    readonly annualRunRateCredits: string;
  };
  readonly ai: {
    readonly costPaiseAllTime: string;
    readonly costPaiseLast30: string;
    readonly calls: number;
    readonly callsLast30: number;
    readonly inputTokens: string;
    readonly outputTokens: string;
    /** Cache reads over all input tokens read, as a percentage string. */
    readonly cacheHitPercent: string;
    readonly byStage: readonly { stage: string; calls: number; paise: string }[];
    readonly byModel: readonly { model: string; calls: number; paise: string }[];
    /** AI cost over recognised revenue, last 30 days, as a percentage string. */
    readonly shareOfRevenuePercent: string;
  };
  readonly perCompany: {
    /** Recognised credits in the last 30 days over companies that ran in them. */
    readonly revenueCredits: string;
    readonly aiCostPaise: string;
  };
}

const num = (v: string | null | undefined): number => Number.parseInt(v ?? "0", 10);

/** A percentage to one decimal, computed on integers so no float touches money. */
function percent(part: bigint, whole: bigint): string {
  if (whole === 0n) return "0.0";
  const tenths = (part * 1000n) / whole;
  return `${(tenths / 10n).toString()}.${(tenths % 10n).toString()}`;
}

export async function businessReport(
  pool: Pool,
  now = new Date(),
): Promise<BusinessReport> {
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const d7 = new Date(now.getTime() - 7 * 86_400_000);

  const [
    growth,
    weeks,
    companies,
    companyMonths,
    cash,
    cashMonths,
    recognised,
    recMonths,
    ai,
    stages,
    models,
    fee,
  ] = await Promise.all([
    pool.query<{
      accounts: string;
      last30: string;
      last7: string;
      with_company: string;
      activated: string;
      paying: string;
      median_days: string | null;
    }>(
      `select
           (select count(*) from public.accounts where deleted_at is null)::text as accounts,
           (select count(*) from public.accounts where deleted_at is null and created_at >= $1)::text as last30,
           (select count(*) from public.accounts where deleted_at is null and created_at >= $2)::text as last7,
           (select count(distinct account_id) from public.companies where deleted_at is null)::text as with_company,
           (select count(distinct account_id) from public.companies where first_setup_at is not null)::text as activated,
           (select count(distinct account_id) from public.purchases where status = 'credited')::text as paying,
           (select round(percentile_cont(0.5) within group (
              order by extract(epoch from (c.first_setup_at - a.created_at)) / 86400)::numeric, 1)
            from public.companies c join public.accounts a on a.id = c.account_id
            where c.first_setup_at is not null)::text as median_days`,
      [d30, d7],
    ),
    pool.query<{ label: string; value: string }>(
      `select to_char(date_trunc('week', created_at), 'DD Mon') as label, count(*)::text as value
           from public.accounts
          where deleted_at is null and created_at >= $1
          group by 1, date_trunc('week', created_at)
          order by date_trunc('week', created_at)`,
      [new Date(now.getTime() - 84 * 86_400_000)],
    ),
    pool.query<{
      total: string;
      set_up: string;
      run_last_30: string;
      state: string;
      n: string;
    }>(
      `select
           (select count(*) from public.companies where deleted_at is null)::text as total,
           (select count(*) from public.companies where deleted_at is null and first_setup_at is not null)::text as set_up,
           (select count(distinct company_id) from public.jobs
             where state = 'completed' and completed_at >= $1 and company_id is not null)::text as run_last_30,
           lifecycle_state as state, count(*)::text as n
         from public.companies where deleted_at is null
         group by lifecycle_state order by lifecycle_state`,
      [d30],
    ),
    pool.query<{ label: string; value: string }>(
      `select to_char(date_trunc('month', created_at), 'Mon YY') as label, count(*)::text as value
           from public.companies
          where deleted_at is null and created_at >= $1
          group by 1, date_trunc('month', created_at)
          order by date_trunc('month', created_at)`,
      [new Date(now.getTime() - 365 * 86_400_000)],
    ),
    pool.query<{
      currency: string;
      ex_tax: string;
      total: string;
      last30: string;
      n: string;
    }>(
      `select currency,
                coalesce(sum(amount_minor_ex_tax), 0)::text as ex_tax,
                coalesce(sum(total_minor), 0)::text as total,
                coalesce(sum(amount_minor_ex_tax) filter (where credited_at >= $1), 0)::text as last30,
                count(*)::text as n
           from public.purchases where status = 'credited'
          group by currency order by currency`,
      [d30],
    ),
    pool.query<{ label: string; value: string }>(
      `select to_char(date_trunc('month', credited_at), 'Mon YY') as label,
                coalesce(sum(amount_minor_ex_tax), 0)::text as value
           from public.purchases
          where status = 'credited' and credited_at >= $1 and currency = 'INR'
          group by 1, date_trunc('month', credited_at)
          order by date_trunc('month', credited_at)`,
      [new Date(now.getTime() - 365 * 86_400_000)],
    ),
    pool.query<{ all_time: string; last30: string; deferred: string }>(
      `select
           (select coalesce(sum(amount), 0) from public.credit_ledger where entry_type = 'capture')::text as all_time,
           (select coalesce(sum(amount), 0) from public.credit_ledger where entry_type = 'capture' and created_at >= $1)::text as last30,
           (select coalesce(sum(balance_credits), 0) from public.wallets)::text as deferred`,
      [d30],
    ),
    pool.query<{ label: string; value: string }>(
      `select to_char(date_trunc('month', created_at), 'Mon YY') as label,
                coalesce(sum(amount), 0)::text as value
           from public.credit_ledger
          where entry_type = 'capture' and created_at >= $1
          group by 1, date_trunc('month', created_at)
          order by date_trunc('month', created_at)`,
      [new Date(now.getTime() - 365 * 86_400_000)],
    ),
    pool.query<{
      paise: string;
      paise30: string;
      calls: string;
      calls30: string;
      input: string;
      output: string;
      cache_read: string;
    }>(
      `select coalesce(sum(inr_cost_paise), 0)::text as paise,
                coalesce(sum(inr_cost_paise) filter (where created_at >= $1), 0)::text as paise30,
                count(*)::text as calls,
                count(*) filter (where created_at >= $1)::text as calls30,
                coalesce(sum(input_tokens), 0)::text as input,
                coalesce(sum(output_tokens), 0)::text as output,
                coalesce(sum(cache_read_input_tokens), 0)::text as cache_read
           from public.ai_calls`,
      [d30],
    ),
    pool.query<{ stage: string; calls: string; paise: string }>(
      `select stage, count(*)::text as calls, coalesce(sum(inr_cost_paise), 0)::text as paise
           from public.ai_calls group by stage order by sum(inr_cost_paise) desc nulls last`,
    ),
    pool.query<{ model: string; calls: string; paise: string }>(
      `select model_used as model, count(*)::text as calls, coalesce(sum(inr_cost_paise), 0)::text as paise
           from public.ai_calls group by model_used order by sum(inr_cost_paise) desc nulls last`,
    ),
    priceFor(pool, {
      actionKey: "company_memory_monthly",
      tier: "professional",
      delivery: "instant",
      at: now,
    }).catch(() => ({ credits: 0n })),
  ]);

  const byState = companies.rows.map((r) => ({ label: r.state, value: num(r.n) }));
  const head = companies.rows[0];

  // Active means paying the memory fee: it is the population the committed figure applies to.
  const activeCompanies = byState.find((s) => s.label === "active")?.value ?? 0;
  const feeCredits = fee.credits;
  const committed = feeCredits * BigInt(activeCompanies);

  const capturedLast30 = BigInt(recognised.rows[0]?.last30 ?? "0");
  // Memory fees inside the window are already committed; counting them again would double them.
  const feesLast30 = await pool.query<{ credits: string }>(
    `select coalesce(sum(credits), 0)::text as credits from public.company_fee_charges
      where status = 'captured' and kind = 'memory_fee' and created_at >= $1`,
    [d30],
  );
  const consumption = capturedLast30 - BigInt(feesLast30.rows[0]?.credits ?? "0");

  const aiRow = ai.rows[0];
  const aiPaise30 = BigInt(aiRow?.paise30 ?? "0");
  const inputTokens = BigInt(aiRow?.input ?? "0");
  const cacheRead = BigInt(aiRow?.cache_read ?? "0");
  const ranLast30 = num(head?.run_last_30);

  return {
    growth: {
      accounts: num(growth.rows[0]?.accounts),
      accountsLast30: num(growth.rows[0]?.last30),
      accountsLast7: num(growth.rows[0]?.last7),
      withCompany: num(growth.rows[0]?.with_company),
      activated: num(growth.rows[0]?.activated),
      paying: num(growth.rows[0]?.paying),
      signupsByWeek: weeks.rows.map((r) => ({ label: r.label, value: num(r.value) })),
      medianDaysToFirstSetup: growth.rows[0]?.median_days ?? null,
    },
    companies: {
      total: num(head?.total),
      byState,
      setUp: num(head?.set_up),
      runLast30: ranLast30,
      createdByMonth: companyMonths.rows.map((r) => ({
        label: r.label,
        value: num(r.value),
      })),
    },
    cash: {
      collected: cash.rows.map((r) => ({
        currency: r.currency,
        exTax: r.ex_tax,
        total: r.total,
      })),
      last30: cash.rows.map((r) => ({ currency: r.currency, exTax: r.last30 })),
      purchases: cash.rows.reduce((s, r) => s + num(r.n), 0),
      byMonth: cashMonths.rows.map((r) => ({ label: r.label, value: num(r.value) })),
    },
    recognised: {
      creditsAllTime: recognised.rows[0]?.all_time ?? "0",
      creditsLast30: capturedLast30.toString(),
      byMonth: recMonths.rows.map((r) => ({ label: r.label, value: num(r.value) })),
      deferredCredits: recognised.rows[0]?.deferred ?? "0",
    },
    recurring: {
      committedMonthlyCredits: committed.toString(),
      consumptionMonthlyCredits: (consumption > 0n ? consumption : 0n).toString(),
      feePerCompanyCredits: feeCredits.toString(),
      activeCompanies,
      annualRunRateCredits: (
        (committed + (consumption > 0n ? consumption : 0n)) *
        12n
      ).toString(),
    },
    ai: {
      costPaiseAllTime: aiRow?.paise ?? "0",
      costPaiseLast30: aiPaise30.toString(),
      calls: num(aiRow?.calls),
      callsLast30: num(aiRow?.calls30),
      inputTokens: inputTokens.toString(),
      outputTokens: aiRow?.output ?? "0",
      cacheHitPercent: percent(cacheRead, inputTokens + cacheRead),
      byStage: stages.rows.map((r) => ({
        stage: r.stage,
        calls: num(r.calls),
        paise: r.paise,
      })),
      byModel: models.rows.map((r) => ({
        model: r.model,
        calls: num(r.calls),
        paise: r.paise,
      })),
      // Captured credits are ₹1 each, so their paise value is the credit count times 100.
      shareOfRevenuePercent: percent(aiPaise30, capturedLast30 * 100n),
    },
    perCompany: {
      revenueCredits:
        ranLast30 === 0 ? "0" : (capturedLast30 / BigInt(ranLast30)).toString(),
      aiCostPaise: ranLast30 === 0 ? "0" : (aiPaise30 / BigInt(ranLast30)).toString(),
    },
  };
}
