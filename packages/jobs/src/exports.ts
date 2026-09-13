/**
 * DPDP-aligned data export (SPEC §10, §31). The account holder asks; the worker builds one JSON
 * document with the profile, companies, blueprints and snapshots (decrypted — they are the owner's),
 * jobs, wallet, invoices and consents; seals it under the account data key; stores it privately; and
 * emails a link that works only while signed in and only until `privacy.export_link_hours` elapses.
 *
 * Raw uploaded files were never on the server (SPEC §2.8), so they cannot be in an export. Hashes,
 * wrapped keys, session ids and device fingerprints are internal and left out.
 */

import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import { appendAudit } from "@magicmis/db/audit";
import type { KeyWrapper } from "@magicmis/crypto";
import {
  latestBlueprint,
  latestSnapshot,
  openForAccount,
  sealForAccount,
} from "@magicmis/engine/server";
import type { Pool } from "pg";
import { z } from "zod";

import { queueNotification } from "./notify";
import type { OutputStore } from "./settle";

const HOUR = 3_600_000;
export const EXPORT_PURPOSE = "account_export";

export type ExportStatus = "queued" | "ready" | "failed" | "expired";

export interface DataExportRow {
  readonly id: string;
  readonly status: ExportStatus;
  readonly requestedAt: Date;
  readonly readyAt: Date | null;
  readonly expiresAt: Date | null;
  readonly byteSize: string | null;
}

/** Queues an export, or returns the one already queued so repeated clicks do not pile up work. */
export async function requestAccountExport(
  pool: Pool,
  input: { accountId: string; ip?: string | null; now?: Date },
): Promise<{ id: string; created: boolean }> {
  return withTransaction(pool, async (tx) => {
    await tx.query(
      `select 1 from public.accounts where id = $1 and status <> 'deleted' for update`,
      [input.accountId],
    );
    const open = await tx.query<{ id: string }>(
      `select id from public.data_exports where account_id = $1 and status = 'queued' limit 1`,
      [input.accountId],
    );
    const existing = open.rows[0];
    if (existing !== undefined) return { id: existing.id, created: false };
    const r = await tx.query<{ id: string }>(
      `insert into public.data_exports (account_id, requested_at) values ($1, $2) returning id`,
      [input.accountId, input.now ?? new Date()],
    );
    const id = r.rows[0]?.id;
    if (id === undefined) throw new Error("requestAccountExport: insert returned no id");
    await appendAudit(tx, {
      actorType: "account",
      actorId: input.accountId,
      action: "privacy.export_requested",
      targetType: "data_export",
      targetId: id,
      metadata: {},
      ip: input.ip ?? null,
    });
    return { id, created: true };
  });
}

export async function listAccountExports(
  pool: Pool,
  accountId: string,
): Promise<DataExportRow[]> {
  const r = await pool.query<{
    id: string;
    status: ExportStatus;
    requested_at: Date;
    ready_at: Date | null;
    expires_at: Date | null;
    byte_size: string | null;
  }>(
    `select id, status, requested_at, ready_at, expires_at, byte_size::text as byte_size
     from public.data_exports where account_id = $1 order by requested_at desc limit 10`,
    [accountId],
  );
  return r.rows.map((e) => ({
    id: e.id,
    status: e.status,
    requestedAt: e.requested_at,
    readyAt: e.ready_at,
    expiresAt: e.expires_at,
    byteSize: e.byte_size,
  }));
}

export class ExportUnavailable extends Error {
  constructor(readonly reason: "not_found" | "not_ready" | "expired") {
    super(`export ${reason}`);
    this.name = "ExportUnavailable";
  }
}

/** The decrypted export for its owner, while the link is live. */
export async function openAccountExport(
  pool: Pool,
  wrapper: KeyWrapper,
  store: OutputStore,
  input: { accountId: string; exportId: string; now?: Date },
): Promise<Buffer> {
  const r = await pool.query<{
    status: ExportStatus;
    storage_path: string | null;
    expires_at: Date | null;
  }>(
    `select status, storage_path, expires_at from public.data_exports where id = $1 and account_id = $2`,
    [input.exportId, input.accountId],
  );
  const row = r.rows[0];
  if (row === undefined) throw new ExportUnavailable("not_found");
  const now = input.now ?? new Date();
  if (row.status === "expired" || (row.expires_at !== null && row.expires_at <= now))
    throw new ExportUnavailable("expired");
  if (row.status !== "ready" || row.storage_path === null)
    throw new ExportUnavailable("not_ready");
  const sealed = await store.get(row.storage_path);
  return openForAccount(pool, wrapper, {
    accountId: input.accountId,
    purpose: EXPORT_PURPOSE,
    id: input.exportId,
    sealed,
  });
}

/** JSON-safe: bigint money values become decimal strings. */
function toJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export async function buildAccountExport(
  pool: Pool,
  wrapper: KeyWrapper,
  accountId: string,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const q = <T extends object>(sql: string) =>
    pool.query<T>(sql, [accountId]).then((r) => r.rows);
  const [profiles, companies, jobs, ledger, lots, invoices, consents, logins] =
    await Promise.all([
      q<{
        email: string;
        business_name: string;
        gstin: string | null;
        billing_address: unknown;
        state_code: string;
        created_at: Date;
      }>(
        `select email, business_name, gstin, billing_address, state_code, created_at
         from public.accounts where id = $1`,
      ),
      q<{
        id: string;
        name: string;
        fy_start_month: number;
        number_format: string;
        decimals: number;
        lifecycle_state: string;
        created_at: Date;
      }>(
        `select id, name, fy_start_month, number_format, decimals, lifecycle_state, created_at
         from public.companies where account_id = $1 and purged_at is null order by created_at`,
      ),
      q<{
        id: string;
        company_id: string | null;
        type: string;
        tier: string;
        state: string;
        price_credits: string | null;
        captured_credits: string | null;
        created_at: Date;
      }>(
        `select id, company_id, type, tier, state, price_credits::text as price_credits,
           captured_credits::text as captured_credits, created_at
         from public.jobs where account_id = $1 order by created_at`,
      ),
      q<{
        entry_type: string;
        amount: string;
        balance_after: string;
        job_id: string | null;
        created_at: Date;
      }>(
        `select entry_type, amount::text as amount, balance_after::text as balance_after, job_id, created_at
         from public.credit_ledger where account_id = $1 order by created_at`,
      ),
      q<{
        source: string;
        credits_granted: string;
        credits_remaining: string;
        expires_at: Date | null;
        created_at: Date;
      }>(
        `select source, credits_granted::text as credits_granted, credits_remaining::text as credits_remaining,
           expires_at, created_at from public.credit_lots where account_id = $1 order by created_at`,
      ),
      q<{
        number: string;
        type: string;
        financial_year: string;
        sac_code: string;
        line_items: unknown;
        totals: unknown;
        issued_at: Date;
      }>(
        `select number, type, financial_year, sac_code, line_items, totals, issued_at
         from public.invoices where account_id = $1 order by issued_at`,
      ),
      q<{ document: string; version: string; accepted_at: Date }>(
        `select document, version, accepted_at from public.consents where account_id = $1 order by accepted_at`,
      ),
      q<{ event_type: string; ip: string | null; created_at: Date }>(
        `select event_type, host(ip) as ip, created_at from public.login_events
         where account_id = $1 order by created_at desc limit 500`,
      ),
    ]);
  const profile = profiles[0];
  if (profile === undefined) throw new Error("buildAccountExport: account not found");

  const companyData = [];
  for (const c of companies) {
    const blueprint = await latestBlueprint(pool, wrapper, {
      accountId,
      companyId: c.id,
    });
    const periods = await pool.query<{ period: string }>(
      `select distinct period from public.snapshots where company_id = $1 and account_id = $2 order by period`,
      [c.id, accountId],
    );
    const snapshots = [];
    for (const { period } of periods.rows) {
      const s = await latestSnapshot(pool, wrapper, {
        accountId,
        companyId: c.id,
        period,
      });
      if (s !== null)
        snapshots.push({
          period,
          version: s.version,
          ledgerBalances: s.ledgerBalances,
          metricStore: s.metricStore,
        });
    }
    companyData.push({
      id: c.id,
      name: c.name,
      fyStartMonth: c.fy_start_month,
      numberFormat: c.number_format,
      decimals: c.decimals,
      lifecycleState: c.lifecycle_state,
      createdAt: c.created_at.toISOString(),
      blueprint:
        blueprint === null ? null : { version: blueprint.version, ...blueprint.parts },
      snapshots,
    });
  }

  return {
    format: "account-export",
    formatVersion: 1,
    exportedAt: now.toISOString(),
    profile: {
      email: profile.email,
      businessName: profile.business_name,
      gstin: profile.gstin,
      billingAddress: profile.billing_address,
      stateCode: profile.state_code,
      createdAt: profile.created_at.toISOString(),
    },
    companies: companyData,
    jobs: jobs.map((j) => ({
      id: j.id,
      companyId: j.company_id,
      type: j.type,
      tier: j.tier,
      state: j.state,
      priceCredits: j.price_credits,
      capturedCredits: j.captured_credits,
      createdAt: j.created_at.toISOString(),
    })),
    wallet: {
      ledger: ledger.map((l) => ({
        entryType: l.entry_type,
        amount: l.amount,
        balanceAfter: l.balance_after,
        jobId: l.job_id,
        at: l.created_at.toISOString(),
      })),
      lots: lots.map((l) => ({
        source: l.source,
        creditsGranted: l.credits_granted,
        creditsRemaining: l.credits_remaining,
        expiresAt: iso(l.expires_at),
        createdAt: l.created_at.toISOString(),
      })),
    },
    invoices: invoices.map((i) => ({
      number: i.number,
      type: i.type,
      financialYear: i.financial_year,
      sacCode: i.sac_code,
      lineItems: i.line_items,
      totals: i.totals,
      issuedAt: i.issued_at.toISOString(),
    })),
    consents: consents.map((c) => ({
      document: c.document,
      version: c.version,
      acceptedAt: c.accepted_at.toISOString(),
    })),
    signInHistory: logins.map((l) => ({
      event: l.event_type,
      ip: l.ip,
      at: l.created_at.toISOString(),
    })),
  };
}

export const exportPath = (accountId: string, exportId: string) =>
  `exports/${accountId}/${exportId}.json.sealed`;

/**
 * Worker tick: builds queued exports and expires stale links (removing their files). A failure marks
 * that export failed and moves on; the account can ask again.
 */
export async function processAccountExports(
  pool: Pool,
  wrapper: KeyWrapper,
  store: OutputStore,
  now: Date = new Date(),
): Promise<{ built: number; failed: number; expired: number }> {
  const hours = await readConfig(
    pool,
    "privacy.export_link_hours",
    z.number().int().positive(),
    now,
  );
  const queued = await pool.query<{ id: string; account_id: string }>(
    `select e.id, e.account_id from public.data_exports e join public.accounts a on a.id = e.account_id
     where e.status = 'queued' and a.status <> 'deleted' order by e.requested_at limit 10`,
  );
  let built = 0;
  let failed = 0;
  for (const e of queued.rows) {
    try {
      const document = await buildAccountExport(pool, wrapper, e.account_id, now);
      const sealed = await sealForAccount(pool, wrapper, {
        accountId: e.account_id,
        purpose: EXPORT_PURPOSE,
        id: e.id,
        plaintext: Buffer.from(toJson(document), "utf8"),
      });
      const path = exportPath(e.account_id, e.id);
      await store.put(path, sealed, "application/octet-stream");
      const expiresAt = new Date(now.getTime() + hours * HOUR);
      await withTransaction(pool, async (tx) => {
        const u = await tx.query(
          `update public.data_exports set status = 'ready', storage_path = $2, byte_size = $3,
             ready_at = $4, expires_at = $5 where id = $1 and status = 'queued'`,
          [e.id, path, sealed.length, now, expiresAt],
        );
        if (u.rowCount !== 1) return;
        await queueNotification(tx, {
          accountId: e.account_id,
          type: "account.export_ready",
          payload: { export_id: e.id, expires_at: expiresAt.toISOString() },
          dedupeKey: `export_ready:${e.id}`,
        });
      });
      built++;
    } catch (error) {
      failed++;
      await pool.query(
        `update public.data_exports set status = 'failed', failure = $2 where id = $1 and status = 'queued'`,
        [e.id, error instanceof Error ? error.name : "error"],
      );
    }
  }

  const stale = await pool.query<{ id: string; storage_path: string | null }>(
    `select id, storage_path from public.data_exports
     where status = 'ready' and expires_at <= $1 limit 100`,
    [now],
  );
  const paths = stale.rows.flatMap((s) =>
    s.storage_path === null ? [] : [s.storage_path],
  );
  await store.remove(paths);
  if (stale.rows.length > 0)
    await pool.query(
      `update public.data_exports set status = 'expired' where id = any($1::uuid[])`,
      [stale.rows.map((s) => s.id)],
    );
  return { built, failed, expired: stale.rows.length };
}

/** On account purge: every stored export file goes, whatever its state. */
export async function removeAccountExports(
  pool: Pool,
  store: OutputStore | null,
  accountId: string,
): Promise<void> {
  const r = await pool.query<{ id: string; storage_path: string | null }>(
    `select id, storage_path from public.data_exports where account_id = $1 and storage_path is not null`,
    [accountId],
  );
  if (store !== null)
    await store.remove(
      r.rows.flatMap((e) => (e.storage_path === null ? [] : [e.storage_path])),
    );
  await pool.query(
    `update public.data_exports set status = 'expired', storage_path = null where account_id = $1 and status <> 'expired'`,
    [accountId],
  );
}
