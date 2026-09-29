/**
 * Welcome credits (ADR 0068): a one-time grant when a new account is first signed in to.
 *
 * The decision is made once per account and kept in `welcome_credits`, granted or withheld,
 * so no path can make it twice — the email link, a password sign-in, the password reset and the
 * Google or Apple finish step can each be an account's first sign-in. An attempt that fails
 * part-way leaves no decision behind and is simply made again at the next sign-in.
 *
 * Withheld for good, and recorded, when:
 *  - the offer is switched off (`wallet.welcome_credits` is 0);
 *  - the address is at a throwaway-mail service (`wallet.welcome_blocked_email_domains`);
 *  - the mailbox has had a grant already, on this account or one deleted before it: addresses are
 *    compared as the mailbox they reach, so `name+1@gmail.com` and `n.ame@gmail.com` are one.
 *
 * Deferred, and recorded nowhere, when the offer's pace is exceeded: a network that has had three
 * grants this month (`auth.throttle` scope `welcome`), or the whole platform past its daily cap
 * (scope `welcome_global`). A deferral is not a refusal. A legitimate customer who first signs in
 * behind a crowded office or mobile address is decided again at a later sign-in; someone farming
 * the offer from one network gets it no faster than the pace allows. None of these stops the
 * account working.
 *
 * The credits are an ordinary lot, spent oldest first like any other, so every action they pay
 * for is still held and captured at its price-book price. They carry no money, which is why the
 * margin report, the business page and the accounting exports leave them out of revenue.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { one, withTransaction, type Queryable } from "@magicmis/db/tx";
import { grantCreditsInTx } from "@magicmis/wallet";
import type { Pool, PoolClient } from "pg";

import { claimAttemptInTx, throttleLimitFor } from "./throttle";

export type WelcomeWithheldReason =
  "existing_account" | "offer_off" | "disposable_email" | "mailbox_already_granted";

export type WelcomeDeferredReason = "network_limit" | "daily_limit";

export type WelcomeDecision =
  | { readonly status: "granted"; readonly credits: bigint; readonly lotId: string }
  | { readonly status: "withheld"; readonly reason: WelcomeWithheldReason }
  | { readonly status: "deferred"; readonly reason: WelcomeDeferredReason }
  | { readonly status: "already_decided"; readonly outcome: "granted" | "withheld" };

export const welcomeCreditsSchema = z.number().int().nonnegative();
// Lenient on purpose: an empty entry typed into the admin console is ignored, never a reason for
// every first sign-in to fail.
const blockedDomainsSchema = z.array(z.string());

/** The welcome grant as configured now, in credits. Zero means the offer is off. */
export async function welcomeCreditsOffered(db: Queryable): Promise<bigint> {
  return BigInt(await readConfig(db, "wallet.welcome_credits", welcomeCreditsSchema));
}

/**
 * The network an address belongs to, as the throttle counts it: an IPv4 address as itself, an
 * IPv6 address by its /64, since one household or office is handed a whole /64 and can pick a
 * fresh address inside it at will. Null when the address is unknown.
 */
export function networkOf(ip: string | null): string | null {
  if (ip === null || ip.trim() === "") return null;
  const raw = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(raw);
  if (mapped?.[1] !== undefined) return mapped[1];
  if (!raw.includes(":")) return raw;

  const [head = "", tail, extra] = raw.split("::");
  if (extra !== undefined) return raw; // more than one "::" is not an address
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : missing < 1) return raw;
  const groups = [
    ...left,
    ...Array<string>(tail === undefined ? 0 : missing).fill("0"),
    ...right,
  ];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/u.test(g))) return raw;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/u, ""))
    .join(":")}::/64`;
}

/**
 * The throttle key for a network. Hashed, because the table is operator-readable and keeps the
 * row for as long as the window runs: an address does not need to sit there in the clear.
 */
export function welcomeNetworkKey(ip: string | null): string {
  const network = networkOf(ip) ?? "unknown";
  return `welcome:network:${createHash("sha256").update(network).digest("hex")}`;
}

const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/**
 * The mailbox an address delivers to, as far as it can be known from the address: lower case,
 * with any `+tag` dropped (every major provider delivers `name+anything` to `name`), and for Gmail
 * the dots ignored and googlemail.com folded into gmail.com, as Gmail itself does.
 */
export function mailboxOf(email: string): string {
  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at < 0) return clean;
  let local = clean.slice(0, at);
  let domain = clean.slice(at + 1).replace(/\.+$/u, "");
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL.has(domain)) {
    local = local.replaceAll(".", "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

/**
 * A fingerprint of the mailbox, kept with the decision so a grant is made once per mailbox even
 * after the account is deleted and its address overwritten. One-way, like the email keys the
 * sign-in throttle already keeps; the address itself is never stored here.
 */
export function mailboxDigest(email: string): string {
  return createHash("sha256")
    .update(`welcome-mailbox:v1:${mailboxOf(email)}`)
    .digest("hex");
}

/** Whether the address is at a blocked domain or at any subdomain of one. */
export function isBlockedEmail(email: string, blocked: readonly string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.+$/u, "");
  return blocked.some((b) => {
    const d = b.trim().toLowerCase();
    return d !== "" && (domain === d || domain.endsWith(`.${d}`));
  });
}

async function decided(
  db: Queryable,
  accountId: string,
): Promise<"granted" | "withheld" | null> {
  const row = await one<{ outcome: "granted" | "withheld" }>(
    db,
    `select outcome from public.welcome_credits where account_id = $1`,
    [accountId],
  );
  return row?.outcome ?? null;
}

async function withhold(
  tx: PoolClient,
  input: {
    accountId: string;
    reason: WelcomeWithheldReason;
    digest: string;
    ip: string | null;
    now: Date;
  },
): Promise<WelcomeDecision> {
  await tx.query(
    `insert into public.welcome_credits
       (account_id, outcome, reason, credits, mailbox_digest, decided_at)
     values ($1, 'withheld', $2, 0, $3, $4)`,
    [input.accountId, input.reason, input.digest, input.now],
  );
  await appendAudit(tx, {
    actorType: "system",
    action: "wallet.welcome_withheld",
    targetType: "account",
    targetId: input.accountId,
    metadata: { reason: input.reason },
    ip: input.ip,
  });
  return { status: "withheld", reason: input.reason };
}

/** Thrown inside the decision to roll back whatever the pace checks counted. */
class Deferral extends Error {
  constructor(readonly reason: WelcomeDeferredReason) {
    super(`welcome credits deferred: ${reason}`);
  }
}

/**
 * Decide an account's welcome credits, once. Safe to call on every sign-in: after the first
 * decision it only reads. Throws only on a database fault, leaving nothing decided and nothing
 * counted, so the next sign-in simply decides again.
 *
 * The whole decision is one transaction behind a lock on the account and a lock on the mailbox.
 * Two first sign-ins racing (a double-clicked link, a second tab, two aliases of one inbox)
 * therefore cannot both be granted or both count against the network: only the one that decides
 * is counted, and a grant that fails or is deferred takes its counts back with it.
 */
export async function decideWelcomeCredits(
  pool: Pool,
  input: { readonly accountId: string; readonly ip: string | null; readonly now?: Date },
): Promise<WelcomeDecision> {
  const { accountId, ip } = input;
  const now = input.now ?? new Date();

  // Nearly every sign-in lands here: decided long ago, one indexed read and nothing locked.
  const prior = await decided(pool, accountId);
  if (prior !== null) return { status: "already_decided", outcome: prior };

  const [credits, account, blocked, networkLimit, dailyLimit] = await Promise.all([
    welcomeCreditsOffered(pool),
    one<{ email: string }>(pool, `select email from public.accounts where id = $1`, [
      accountId,
    ]),
    readConfig(pool, "wallet.welcome_blocked_email_domains", blockedDomainsSchema),
    throttleLimitFor(pool, "welcome"),
    throttleLimitFor(pool, "welcome_global"),
  ]);
  if (account === null) throw new Error(`decideWelcomeCredits: no account ${accountId}`);
  const digest = mailboxDigest(account.email);

  try {
    return await withTransaction(pool, async (tx) => {
      // Lock order: this account, then the mailbox, then the throttle rows, then the wallet,
      // then the audit log.
      await tx.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `welcome:${accountId}`,
      ]);
      const raced = await decided(tx, accountId);
      if (raced !== null) return { status: "already_decided", outcome: raced } as const;
      const common = { accountId, digest, ip, now };

      if (credits === 0n) return withhold(tx, { ...common, reason: "offer_off" });
      if (isBlockedEmail(account.email, blocked)) {
        // A throwaway address is not counted against its network: nothing was granted.
        return withhold(tx, { ...common, reason: "disposable_email" });
      }

      await tx.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `welcome-mailbox:${digest}`,
      ]);
      const sameMailbox = await tx.query(
        `select 1 from public.welcome_credits
          where mailbox_digest = $1 and outcome = 'granted' limit 1`,
        [digest],
      );
      if ((sameMailbox.rowCount ?? 0) > 0)
        return withhold(tx, { ...common, reason: "mailbox_already_granted" });

      const network = await claimAttemptInTx(
        tx,
        [welcomeNetworkKey(ip)],
        networkLimit,
        now,
      );
      if (network.locked) throw new Deferral("network_limit");
      const daily = await claimAttemptInTx(tx, ["welcome:global"], dailyLimit, now);
      if (daily.locked) throw new Deferral("daily_limit");

      await tx.query(
        `insert into public.welcome_credits
           (account_id, outcome, credits, mailbox_digest, decided_at)
         values ($1, 'granted', $2, $3, $4)`,
        [accountId, credits.toString(), digest, now],
      );
      const grant = await grantCreditsInTx(tx, {
        accountId,
        credits,
        source: "welcome",
        idempotencyKey: `welcome:${accountId}`,
        now,
      });
      if (grant.status !== "granted") {
        // The ledger already holds this account's welcome grant with no decision beside it. That
        // cannot happen through this function, so it is refused rather than papered over.
        throw new Error(
          `decideWelcomeCredits: ${accountId} already holds a welcome grant`,
        );
      }
      await tx.query(
        `update public.welcome_credits set lot_id = $2 where account_id = $1`,
        [accountId, grant.lotId],
      );
      await appendAudit(tx, {
        actorType: "system",
        action: "wallet.welcome_granted",
        targetType: "account",
        targetId: accountId,
        metadata: { credits: credits.toString() },
        ip,
      });
      return { status: "granted", credits, lotId: grant.lotId } as const;
    });
  } catch (error) {
    if (error instanceof Deferral) return { status: "deferred", reason: error.reason };
    throw error;
  }
}
