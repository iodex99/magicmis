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
const boss = await startBoss(
  env.DATABASE_URL,
  {
    pool,
    mail: new ResendMailSender(env.RESEND_API_KEY, env.EMAIL_FROM),
    appUrl: env.APP_URL,
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
