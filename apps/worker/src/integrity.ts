/**
 * Nightly integrity check (SPEC §30: "audit chain verified nightly, alert on mismatch"; SPEC §11: the
 * ledger replays to the wallet row). Walks the whole audit log and every account's credit ledger;
 * on any mismatch it emails every active admin once per IST day and records the failure in the audit
 * log. The email carries row ids and sequence numbers only — no amounts, no customer names.
 *
 * With the key wrapper it also anchors both chains (keyed digests, R-52) and verifies every anchor,
 * which catches whole-chain rewrites, trimmed tails and timestamp edits the row hashes cannot.
 * Response steps: docs/runbooks/breach-response.md.
 */

import { appendAudit, verifyAuditChain } from "@magicmis/db/audit";
import { withTransaction } from "@magicmis/db/tx";
import type { KeyWrapper } from "@magicmis/crypto";
import {
  createIntegrityAnchors,
  verifyIntegrityAnchors,
  type AnchorFailure,
} from "@magicmis/jobs";
import { readLedger, replayLedger } from "@magicmis/wallet";
import type { Pool } from "pg";

import type { MailSender } from "./mail";

export interface IntegrityResult {
  readonly auditRowsChecked: number;
  readonly auditFailures: number;
  readonly accountsChecked: number;
  readonly ledgerFailures: {
    accountId: string;
    brokenSeqs: string[];
    walletMismatch: boolean;
  }[];
  /** Null when no key wrapper is configured: anchors are neither written nor checked. */
  readonly anchorFailures: AnchorFailure[] | null;
  readonly alerted: number;
}

export async function verifyIntegrity(
  pool: Pool,
  mail: MailSender,
  adminUrl: string,
  now: Date,
  wrapper: KeyWrapper | null = null,
): Promise<IntegrityResult> {
  const audit = await verifyAuditChain(pool);
  // Anchor first (new settled history), then verify every anchor against the live tables.
  let anchorFailures: AnchorFailure[] | null = null;
  if (wrapper !== null) {
    await createIntegrityAnchors(pool, wrapper, now);
    anchorFailures = (await verifyIntegrityAnchors(pool, wrapper, now)).failures;
  }
  // Every account with a ledger or a wallet: a wallet row deleted to hide a ledger is itself a failure.
  const accounts = await pool.query<{
    account_id: string;
    balance: string | null;
    held: string | null;
  }>(
    `select k.account_id, w.balance_credits::text as balance, w.held_credits::text as held
     from (select account_id from public.credit_ledger union select account_id from public.wallets) k
     left join public.wallets w on w.account_id = k.account_id`,
  );
  const ledgerFailures: IntegrityResult["ledgerFailures"] = [];
  for (const w of accounts.rows) {
    const replay = replayLedger(w.account_id, await readLedger(pool, w.account_id));
    const walletMismatch =
      w.balance === null ||
      w.held === null ||
      replay.state.balance !== BigInt(w.balance) ||
      replay.state.held !== BigInt(w.held);
    const broken = [...replay.brokenChainSeqs, ...replay.inconsistentSeqs].map(String);
    if (walletMismatch || broken.length > 0)
      ledgerFailures.push({
        accountId: w.account_id,
        brokenSeqs: broken,
        walletMismatch,
      });
  }

  const result = {
    auditRowsChecked: audit.checked,
    auditFailures: audit.failures.length,
    accountsChecked: accounts.rows.length,
    ledgerFailures,
    anchorFailures,
    alerted: 0,
  };
  const anchorsFailing = anchorFailures?.length ?? 0;
  if (audit.failures.length === 0 && ledgerFailures.length === 0 && anchorsFailing === 0)
    return result;

  await withTransaction(pool, (tx) =>
    appendAudit(tx, {
      actorType: "system",
      actorId: null,
      action: "integrity.check_failed",
      targetType: "system",
      metadata: {
        audit_failures: audit.failures.length,
        ledger_accounts: ledgerFailures.length,
        anchor_failures: anchorsFailing,
      },
    }),
  );
  const day = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const lines = [
    "The nightly integrity check found a mismatch. Treat this as a possible security incident.",
    "",
    `Audit log rows checked: ${String(audit.checked)}; failures: ${String(audit.failures.length)}`,
    ...audit.failures.slice(0, 20).map((f) => `  audit row ${f.id}: ${f.reason}`),
    `Accounts checked: ${String(accounts.rows.length)}; ledgers failing: ${String(ledgerFailures.length)}`,
    ...ledgerFailures
      .slice(0, 20)
      .map(
        (f) =>
          `  account ${f.accountId}: seqs ${f.brokenSeqs.slice(0, 10).join(", ") || "none"}${f.walletMismatch ? "; wallet row differs from replay" : ""}`,
      ),
    `Integrity anchors failing: ${String(anchorsFailing)}`,
    ...(anchorFailures ?? [])
      .slice(0, 20)
      .map((f) => `  ${f.chain} anchor ${f.anchorId ?? "(none)"}: ${f.reason}`),
    "",
    "Follow docs/runbooks/breach-response.md.",
    `${adminUrl}/audit?verify=1`,
  ];
  const admins = await pool.query<{ id: string; email: string }>(
    `select id, email from public.admin_users where status = 'active' order by email`,
  );
  let alerted = 0;
  const failures: string[] = [];
  for (const a of admins.rows) {
    const r = await mail.send({
      to: a.email,
      subject: `[Integrity alert] Chain or ledger mismatch ${day}`,
      text: lines.join("\n"),
      html: `<pre style="font-family:monospace">${lines.join("\n").replace(/&/gu, "&amp;").replace(/</gu, "&lt;")}</pre>`,
      idempotencyKey: `integrity-alert:${a.id}:${day}`,
    });
    if (r.ok) alerted += 1;
    else failures.push(`${a.email}: ${r.error}`);
  }
  // An integrity alert says to treat the situation as a possible security incident, so a
  // dropped one must not be reported as a clean run (ADR 0053). Throwing puts it in front of
  // the worker's error reporting instead of leaving a zero in a log line.
  if (failures.length > 0)
    throw new Error(`integrity alert undelivered: ${failures.join("; ")}`);
  return { ...result, alerted };
}
