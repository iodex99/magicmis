import { randomBytes, randomUUID } from "node:crypto";

import { LocalKeyWrapper } from "@magicmis/crypto";
import type { SnapshotPayload } from "@magicmis/engine";
import { grantCredits } from "@magicmis/wallet";
import type { Pool } from "pg";

import type { OutputStore } from "../src/settle";

export const wrapper = LocalKeyWrapper.fromBase64(randomBytes(32).toString("base64"));

export class MemoryOutputStore implements OutputStore {
  readonly files = new Map<string, Buffer>();
  put(path: string, bytes: Buffer): Promise<void> {
    this.files.set(path, bytes);
    return Promise.resolve();
  }
  get(path: string): Promise<Buffer> {
    const b = this.files.get(path);
    return b === undefined ? Promise.reject(new Error("missing")) : Promise.resolve(b);
  }
  remove(paths: readonly string[]): Promise<void> {
    for (const p of paths) this.files.delete(p);
    return Promise.resolve();
  }
}

export async function accountWithCompany(
  pool: Pool,
  credits: bigint,
): Promise<{ accountId: string; companyId: string }> {
  const a = await pool.query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code) values (gen_random_uuid(), $1, 'Jobs Co', '27') returning id`,
    [`${randomUUID()}@example.test`],
  );
  const accountId = a.rows[0]?.id ?? "";
  await pool.query(`insert into wallets (account_id) values ($1)`, [accountId]);
  if (credits > 0n)
    await grantCredits(pool, {
      accountId,
      credits,
      source: "admin_grant",
      idempotencyKey: randomUUID(),
    });
  const c = await pool.query<{ id: string }>(
    `insert into companies (account_id, name) values ($1, 'Synthetic Traders') returning id`,
    [accountId],
  );
  return { accountId, companyId: c.rows[0]?.id ?? "" };
}

export async function wallet(
  pool: Pool,
  accountId: string,
): Promise<{ balance: bigint; held: bigint }> {
  const r = await pool.query<{ balance_credits: string; held_credits: string }>(
    `select balance_credits, held_credits from wallets where account_id = $1`,
    [accountId],
  );
  return {
    balance: BigInt(r.rows[0]?.balance_credits ?? "-1"),
    held: BigInt(r.rows[0]?.held_credits ?? "-1"),
  };
}

export const SMALL = {
  files: 1,
  sheets: 1,
  columns: 6,
  rows: 80,
  distinctLedgerValues: 40,
  referenceMisSheets: 0,
};

export const emptySnapshot = (period: string): SnapshotPayload => ({
  schemaVersion: 1,
  period,
  engineVersion: "engine-1.0.0",
  sourceFingerprint: "fp",
  ledgerBalances: [],
  metricStore: {
    engineVersion: "engine-1.0.0",
    computedAt: new Date().toISOString(),
    values: [],
  },
  validationResults: [],
});

export async function addAiCall(
  pool: Pool,
  accountId: string,
  jobId: string,
): Promise<void> {
  await pool.query(
    `insert into ai_calls (job_id, account_id, stage, prompt_version, model_requested, model_used, max_tokens, usd_cost_micro, inr_cost_paise, fx_rate_used)
     values ($1, $2, 'sheet_classification', 'sheet_classification/v1', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5-20251001', 100, 20000, 196, 97.85)`,
    [jobId, accountId],
  );
}
