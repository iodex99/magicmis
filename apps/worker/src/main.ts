import { anthropicTransport } from "@magicmis/ai";
import { LocalKeyWrapper, RotatingKeyWrapper, type KeyWrapper } from "@magicmis/crypto";
import { KmsKeyWrapper } from "@magicmis/crypto/kms";
import { SupabaseOutputStore } from "@magicmis/jobs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { pino } from "pino";

import { startBoss } from "./boss";
import { loadWorkerEnv } from "./env";
import { ResendMailSender } from "./mail";

const env = loadWorkerEnv();
const log = pino({ level: env.LOG_LEVEL, base: { service: "worker" } });

// Same connection shape as the web server (ADR 0003): service_role, never a customer role.
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  options: "-c role=service_role",
});
function keyWrapper(): KeyWrapper | null {
  if (env.KEY_WRAPPER === "local")
    return env.LOCAL_MASTER_KEY === undefined
      ? null
      : LocalKeyWrapper.fromBase64(env.LOCAL_MASTER_KEY);
  return env.KMS_MASTER_KEY_ID === undefined || env.AWS_REGION === undefined
    ? null
    : env.KMS_PREVIOUS_MASTER_KEY_ID === undefined
      ? new KmsKeyWrapper(env.KMS_MASTER_KEY_ID, { region: env.AWS_REGION })
      : new RotatingKeyWrapper(
          new KmsKeyWrapper(env.KMS_MASTER_KEY_ID, { region: env.AWS_REGION }),
          new KmsKeyWrapper(env.KMS_PREVIOUS_MASTER_KEY_ID, { region: env.AWS_REGION }),
        );
}
const wrapper = keyWrapper();

const boss = await startBoss(
  env.DATABASE_URL,
  {
    pool,
    mail: new ResendMailSender(env.RESEND_API_KEY, env.EMAIL_FROM),
    appUrl: env.APP_URL,
    adminUrl: env.ADMIN_URL ?? env.APP_URL,
    wrapper,
    outputs:
      env.NEXT_PUBLIC_SUPABASE_URL !== undefined && env.SUPABASE_SECRET_KEY !== undefined
        ? new SupabaseOutputStore(
            createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
              auth: { persistSession: false },
            }).storage.from("outputs"),
          )
        : null,
    ai:
      env.ANTHROPIC_API_KEY !== undefined && wrapper !== null
        ? { transport: anthropicTransport(env.ANTHROPIC_API_KEY), wrapper }
        : null,
  },
  log,
);
log.info({}, "worker started");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "worker stopping");
  await boss.stop({ graceful: true, timeout: 30_000 });
  await pool.end();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
