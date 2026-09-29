import "server-only";

import { createHmac } from "node:crypto";

import {
  decideWelcomeCredits,
  welcomeCreditsOffered,
  type ClaimResult,
  type MailboxFingerprint,
} from "@magicmis/accounts";
import { platformKey } from "@magicmis/jobs";
import { priceFor } from "@magicmis/wallet";
import type { Pool } from "pg";

import { keyWrapper } from "./runtime";

/**
 * The mailbox fingerprint, keyed (ADR 0072): an HMAC under the `welcome` platform key, which the
 * KMS wraps and the key re-wrap job rotates like every other. Without the key a fingerprint cannot
 * be matched to an address by hashing guesses.
 */
function keyedFingerprint(pool: Pool): MailboxFingerprint {
  return async (mailbox) => {
    const key = await platformKey(pool, keyWrapper(), "welcome");
    try {
      return createHmac("sha256", key).update(`welcome-mailbox:${mailbox}`).digest("hex");
    } finally {
      key.fill(0);
    }
  };
}

/**
 * Welcome credits at sign-in (ADR 0068). Called after every successful claim: the first one
 * decides, every later one is a single read. A failure is logged and never stops the sign-in;
 * nothing was decided, so the next sign-in decides again.
 */
export async function welcomeAfterClaim(
  pool: Pool,
  claim: ClaimResult,
  ip: string | null,
): Promise<void> {
  if (claim.status !== "claimed") return;
  try {
    await decideWelcomeCredits(pool, {
      accountId: claim.accountId,
      ip,
      fingerprint: keyedFingerprint(pool),
    });
  } catch (error) {
    // The account id only: the decision reads an email address, which does not belong in a log.
    console.error(
      "welcome_credits: the decision failed and will be retried at next sign-in",
      {
        accountId: claim.accountId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

export interface WelcomeOffer {
  /** Credits a new account starts with; zero when the offer is off. */
  readonly credits: bigint;
  /**
   * Whether that covers a first run — setting up a company and the dashboard it delivers — at
   * the Professional tier, read from the live price book. The public claim "enough to set up your
   * first company" is made only while this holds, so a price change can never leave it false.
   */
  readonly coversFirstCompany: boolean;
}

/**
 * What a first run costs at the Professional tier: setting up a company plus the dashboard it
 * delivers, each at its instant price, because instant is the only delivery a run has and the
 * price it holds (ADR 0050).
 */
export async function firstRunCredits(pool: Pool): Promise<bigint> {
  const at = (actionKey: "company_setup" | "dashboard_addon") =>
    priceFor(pool, { actionKey, tier: "professional", delivery: "instant" });
  const [setup, dashboard] = await Promise.all([
    at("company_setup"),
    at("dashboard_addon"),
  ]);
  return setup.credits + dashboard.credits;
}

const OFF: WelcomeOffer = { credits: 0n, coversFirstCompany: false };
/** How long a read of the offer is reused: the public pages read it on every view. */
const CACHE_MS = 60_000;
let cached: { at: number; offer: WelcomeOffer } | null = null;

/**
 * The offer as the public site states it. A config value the schema refuses, or a price row that
 * has gone, is logged and the offer is simply not stated: the pages that carry it must never fail
 * because of it, and saying nothing is always true where saying the wrong thing is not.
 */
export async function welcomeOffer(pool: Pool): Promise<WelcomeOffer> {
  const now = Date.now();
  if (cached !== null && now - cached.at < CACHE_MS) return cached.offer;
  let offer: WelcomeOffer;
  try {
    const [credits, firstRun] = await Promise.all([
      welcomeCreditsOffered(pool),
      firstRunCredits(pool),
    ]);
    offer = { credits, coversFirstCompany: credits > 0n && credits >= firstRun };
  } catch (error) {
    console.error("welcome_credits: the offer could not be read; it is not stated", {
      error: error instanceof Error ? error.message : String(error),
    });
    offer = OFF;
  }
  cached = { at: now, offer };
  return offer;
}

/**
 * What a new account is told when its welcome credits are not in its wallet (ADR 0072): an offer
 * a customer expected and does not see, with no word why, reads as a bait and switch. Withheld
 * says why; waiting says when. Nothing is said to an account the offer never applied to.
 */
export type WelcomeStatus =
  | { readonly kind: "none" }
  | { readonly kind: "waiting" }
  | {
      readonly kind: "withheld";
      readonly reason: "disposable_email" | "mailbox_already_granted";
    };

export async function welcomeStatus(
  pool: Pool,
  accountId: string,
): Promise<WelcomeStatus> {
  const row = await pool.query<{ outcome: string; reason: string | null }>(
    `select outcome, reason from public.welcome_credits where account_id = $1`,
    [accountId],
  );
  const decided = row.rows[0];
  if (decided === undefined) {
    // Signed in and still undecided: deferred for its network's pace or the day's cap, or a
    // failure the next sign-in retries. Either way it comes at a later sign-in, if the offer runs.
    const offer = await welcomeOffer(pool);
    return offer.credits > 0n ? { kind: "waiting" } : { kind: "none" };
  }
  if (
    decided.outcome === "withheld" &&
    (decided.reason === "disposable_email" ||
      decided.reason === "mailbox_already_granted")
  )
    return { kind: "withheld", reason: decided.reason };
  return { kind: "none" };
}
