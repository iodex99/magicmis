/**
 * Re-wrap every stored DEK from the previous KMS master key to the current one (ADR 0008).
 * Run from a trusted machine or a one-off worker task with the KMS role for both keys:
 *
 *   KMS_PREVIOUS_MASTER_KEY_ID=... KMS_MASTER_KEY_ID=... pnpm --filter @magicmis/worker rewrap-keys
 *
 * Resumable and safe to repeat. Steps and checks: docs/runbooks/key-rotation.md.
 */

import { KmsKeyWrapper } from "@magicmis/crypto/kms";
import { rewrapDataKeys } from "@magicmis/jobs";
import pg from "pg";

import { loadWorkerEnv } from "./env";

const env = loadWorkerEnv(process.env);
if (
  env.KMS_MASTER_KEY_ID === undefined ||
  env.KMS_PREVIOUS_MASTER_KEY_ID === undefined ||
  env.AWS_REGION === undefined
)
  throw new Error(
    "KMS_MASTER_KEY_ID, KMS_PREVIOUS_MASTER_KEY_ID and AWS_REGION are required",
  );

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  options: "-c role=service_role",
  max: 2,
});
const region = { region: env.AWS_REGION };
const current = new KmsKeyWrapper(env.KMS_MASTER_KEY_ID, region);
// The stored version is what Encrypt reports for the current key (its key ARN); probe it once.
const probe = await current.wrap(Buffer.alloc(32), { purpose: "rewrap_probe" });
try {
  const moved = await rewrapDataKeys(
    pool,
    new KmsKeyWrapper(env.KMS_PREVIOUS_MASTER_KEY_ID, region),
    current,
    probe.keyVersion,
  );
  process.stdout.write(`${JSON.stringify({ toVersion: probe.keyVersion, moved })}\n`);
} finally {
  await pool.end();
}
