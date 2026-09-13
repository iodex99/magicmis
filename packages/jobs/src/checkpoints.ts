/**
 * Stage checkpoints (SPEC §23): server-side AI outputs are persisted, encrypted under the company
 * data key, so a retry resumes from the last completed stage and never pays for the same AI stage
 * twice.
 */

import type { KeyWrapper } from "@magicmis/crypto";
import { openForCompany, sealForCompany } from "@magicmis/engine/server";
import type { Pool } from "pg";

const PURPOSE = "job_stage_output";

export async function saveStageOutput(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    jobId: string;
    stage: string;
    output: unknown;
  },
): Promise<boolean> {
  const sealed = await sealForCompany(pool, wrapper, {
    accountId: input.accountId,
    companyId: input.companyId,
    purpose: PURPOSE,
    id: `${input.jobId}:${input.stage}`,
    plaintext: Buffer.from(JSON.stringify(input.output)),
  });
  const r = await pool.query(
    `insert into public.job_stage_outputs (job_id, account_id, stage, output)
     select $1, $2, $3, $4 where exists (select 1 from public.jobs where id = $1 and account_id = $2)
     on conflict (job_id, stage) do nothing`,
    [input.jobId, input.accountId, input.stage, sealed],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function loadStageOutput(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; companyId: string; jobId: string; stage: string },
): Promise<unknown> {
  const r = await pool.query<{ output: Buffer }>(
    `select output from public.job_stage_outputs where job_id = $1 and account_id = $2 and stage = $3`,
    [input.jobId, input.accountId, input.stage],
  );
  const row = r.rows[0];
  if (row === undefined) return null;
  const plain = await openForCompany(pool, wrapper, {
    accountId: input.accountId,
    companyId: input.companyId,
    purpose: PURPOSE,
    id: `${input.jobId}:${input.stage}`,
    sealed: row.output,
  });
  return JSON.parse(plain.toString("utf8")) as unknown;
}
