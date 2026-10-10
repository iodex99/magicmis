import "server-only";

import { priceFor, walletSummary } from "@magicmis/wallet";
import type { Pool } from "pg";

import { yearQuestionOf, type YearQuestion } from "@/lib/server/run-job";

/**
 * What the run screen needs to know before anything is pressed (ADR 0091): what each tier costs,
 * whether a run of this company's is already working or waiting on its owner, and whether the
 * company can take a file at all. Read on the server and handed to `JobRunner` as props, so the
 * browser never works out a price and a reload shows the run that is already there.
 */

export type RunTier = "efficient" | "professional" | "expert";
const TIERS: readonly RunTier[] = ["efficient", "professional", "expert"];

/** Credits per tier, as integer strings. */
export type TierPrices = Readonly<Record<RunTier, string>>;

export type RunAction =
  | "company_setup"
  | "reference_mis_recreate"
  | "monthly_refresh"
  | "refresh_with_restructure";

export interface RunPrices {
  /** Each action the button can start, at the price it holds: instant, the only delivery a run has (ADR 0050). */
  readonly run: Readonly<Partial<Record<RunAction, TierPrices>>>;
  /**
   * The dashboard the run brings up to date afterwards, its own priced action (ADR 0047), at the
   * delivery `bringDashboardUpToDate` books it on.
   */
  readonly dashboard: TierPrices;
  /** Whether that is the first dashboard (built) or an existing one (updated). */
  readonly firstDashboard: boolean;
}

const RUN_TYPES = [
  "company_setup",
  "reference_mis_recreate",
  "monthly_refresh",
  "refresh_with_restructure",
] as const;

async function tierPrices(
  pool: Pool,
  actionKey: RunAction | "dashboard_addon" | "dashboard_refresh",
  delivery: "instant" | "standard",
): Promise<TierPrices> {
  const at = async (tier: RunTier) =>
    (await priceFor(pool, { actionKey, tier, delivery })).credits.toString();
  const [efficient, professional, expert] = await Promise.all(TIERS.map(at));
  if (efficient === undefined || professional === undefined || expert === undefined)
    throw new Error(`no price for ${actionKey}`);
  return { efficient, professional, expert };
}

/**
 * The price book, read for this screen. Null when it cannot be read: a price is only ever said
 * when it is the one that will be held, so a missing row says nothing rather than fail the page.
 */
export async function runPrices(
  pool: Pool,
  input: { accountId: string; companyId: string; mode: "setup" | "refresh" },
): Promise<RunPrices | null> {
  try {
    // A completed dashboard_addon is the cheap sign that the company has a board: the board
    // itself is sealed in the blueprint, and opening it to answer a yes/no is not worth a key.
    const had = await pool.query<{ has: boolean }>(
      `select exists (select 1 from jobs where account_id = $1 and company_id = $2
                        and type = 'dashboard_addon' and state = 'completed') as has`,
      [input.accountId, input.companyId],
    );
    const firstDashboard = had.rows[0]?.has !== true;
    const [plain, other]: readonly [RunAction, RunAction] =
      input.mode === "setup"
        ? ["company_setup", "reference_mis_recreate"]
        : ["monthly_refresh", "refresh_with_restructure"];
    const [first, second, dashboard] = await Promise.all([
      tierPrices(pool, plain, "instant"),
      tierPrices(pool, other, "instant"),
      tierPrices(
        pool,
        firstDashboard ? "dashboard_addon" : "dashboard_refresh",
        "standard",
      ),
    ]);
    return { run: { [plain]: first, [other]: second }, dashboard, firstDashboard };
  } catch (error) {
    console.error("run_prices: the price book could not be read; no price is shown", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export interface PendingRun {
  /** A run working on the server right now, which the screen follows instead of a new upload. */
  readonly live: { readonly jobId: string; readonly state: string } | null;
  /** A run paused for a quote, still open (ADR 0049, ADR 0086). */
  readonly quote: {
    readonly jobId: string;
    readonly credits: string;
    readonly expiresAt: string | null;
    /** True for a run that paused part-way (locked decision 6), false for one quoted up front. */
    readonly resumed: boolean;
  } | null;
  /** A run waiting on the year question, its credits still held (ADR 0086). */
  readonly year: { readonly jobId: string; readonly question: YearQuestion } | null;
}

const NOTHING: PendingRun = { live: null, quote: null, year: null };

/**
 * The company's newest run that is not finished (ADR 0091), the one asked for by `?job=` first.
 *
 * Until now a waiting run was reachable only from its email, and a run in progress from nowhere:
 * a reload or a second visit showed an empty uploader, and the obvious next step — add the files
 * again and press the button — held and charged a second run beside the first. One job, one hold
 * and one charge (ADR 0086) depends on the screen finding the one that is already there.
 *
 * A run is live while its lease is (`claimRun`): that is what the run route itself checks, so the
 * screen and the server agree on what "already running" means. A stopped run is only offered while
 * it can still be answered — a quote still offered and unexpired, a year question whose hold is
 * still held.
 */
export async function pendingRun(
  pool: Pool,
  input: { accountId: string; companyId: string; asked: string | null },
): Promise<PendingRun> {
  const r = await pool.query<{
    id: string;
    state: string;
    stage_checkpoints: Record<string, unknown>;
    live: boolean;
    quote_credits: string | null;
    quote_expires_at: Date | null;
    quote_open: boolean;
    quote_reason: string | null;
    held: boolean;
  }>(
    `select j.id, j.state, j.stage_checkpoints,
            coalesce((j.stage_checkpoints->>'run_lease_until')::timestamptz, '-infinity') > now() as live,
            q.credits::text as quote_credits, q.expires_at as quote_expires_at, q.reason as quote_reason,
            (q.status = 'offered' and (q.expires_at is null or q.expires_at > now())) is true as quote_open,
            (r.status = 'held') is true as held
       from jobs j
       left join quotes q on q.id = j.quote_id
       left join reservations r on r.id = j.reservation_id
      where j.account_id = $1 and j.company_id = $2
        and j.type = any($3::text[])
        and j.state not in ('draft', 'estimated', 'completed', 'failed_data', 'failed_platform',
                            'cancelled', 'expired')
      order by (j.id = $4::uuid) is true desc, j.created_at desc
      limit 5`,
    [input.accountId, input.companyId, RUN_TYPES, input.asked],
  );
  for (const row of r.rows) {
    if (row.live) return { ...NOTHING, live: { jobId: row.id, state: row.state } };
    if (row.state === "needs_quote" && row.quote_open && row.quote_credits !== null)
      return {
        ...NOTHING,
        quote: {
          jobId: row.id,
          credits: row.quote_credits,
          expiresAt: row.quote_expires_at?.toISOString() ?? null,
          resumed: row.quote_reason === "runtime_cap",
        },
      };
    const question =
      row.state === "awaiting_review" && row.held
        ? yearQuestionOf(row.stage_checkpoints)
        : null;
    if (question !== null) return { ...NOTHING, year: { jobId: row.id, question } };
  }
  return NOTHING;
}

/**
 * Why a company cannot take a file, said before the drop zone rather than after the uploads
 * (ADR 0091). Grace and archive are the memory fee's states (SPEC §28): a paused company opens
 * again when its fee is taken, an archived one when it is restored.
 */
export type Closed =
  | {
      readonly kind: "paused";
      /** The fees owed, and what the wallet holds towards them. */
      readonly owed: string;
      readonly available: string;
    }
  | {
      readonly kind: "archived";
      /** The restore and this month's fee together, as `restoreCompany` charges them. */
      readonly restoreCredits: string | null;
      readonly available: string;
    }
  | { readonly kind: "other" };

export async function closedState(
  pool: Pool,
  input: { accountId: string; companyId: string; lifecycleState: string },
): Promise<Closed | null> {
  if (input.lifecycleState === "active") return null;
  try {
    if (input.lifecycleState === "grace") {
      const [fee, unpaid, wallet] = await Promise.all([
        priceFor(pool, {
          actionKey: "company_memory_monthly",
          tier: "professional",
          delivery: "standard",
        }),
        pool.query<{ unpaid_months: number }>(
          `select unpaid_months from companies where id = $1 and account_id = $2`,
          [input.companyId, input.accountId],
        ),
        walletSummary(pool, input.accountId),
      ]);
      const months = BigInt(Math.max(1, unpaid.rows[0]?.unpaid_months ?? 1));
      return {
        kind: "paused",
        owed: (fee.credits * months).toString(),
        available: wallet.available.toString(),
      };
    }
    if (input.lifecycleState === "archived") {
      const [restore, fee, wallet] = await Promise.all([
        priceFor(pool, {
          actionKey: "company_restore",
          tier: "professional",
          delivery: "standard",
        }),
        priceFor(pool, {
          actionKey: "company_memory_monthly",
          tier: "professional",
          delivery: "standard",
        }),
        walletSummary(pool, input.accountId),
      ]);
      return {
        kind: "archived",
        restoreCredits: (restore.credits + fee.credits).toString(),
        available: wallet.available.toString(),
      };
    }
  } catch (error) {
    console.error(
      "closed_state: a fee could not be priced; the state is said without it",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    if (input.lifecycleState === "archived")
      return { kind: "archived", restoreCredits: null, available: "0" };
  }
  return { kind: "other" };
}
