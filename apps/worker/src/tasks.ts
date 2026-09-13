/**
 * Scheduled maintenance (SPEC §11, §12, §29). Each task is idempotent: pg-boss may run a
 * scheduled job late or, after a crash, again, and the wallet functions tolerate both.
 * Cron expressions are evaluated in IST so "nightly" means an Indian night.
 */

import { estimatorConfigSchema, recalibrateEstimator } from "@magicmis/ai/estimator";
import { readConfig } from "@magicmis/db/config";
import type { AiTransport } from "@magicmis/ai";
import type { KeyWrapper } from "@magicmis/crypto";
import {
  commentaryBatchTick,
  debitMemoryFees,
  purgeCompanies,
  queueLifecycleNotices,
  queueRefreshReminders,
  sweepJobs,
  type OutputStore,
} from "@magicmis/jobs";
import {
  expireLotsSweep,
  expireQuotes,
  queueLotExpiryNotices,
  sweepExpiredReservations,
} from "@magicmis/wallet";
import { sweepChatMessages } from "@magicmis/chat/server";
import type { Pool } from "pg";

import { deliverNotifications } from "./deliver";
import type { MailSender } from "./mail";

export const SCHEDULE_TZ = "Asia/Kolkata";

export interface TaskDeps {
  readonly pool: Pool;
  readonly mail: MailSender;
  readonly appUrl: string;
  /** Output storage for purges; absent when storage is not configured (sealed files stay unreadable). */
  readonly outputs?: OutputStore | null;
  /** Commentary batches; absent when the worker has no Anthropic key configured. */
  readonly ai?: { readonly transport: AiTransport; readonly wrapper: KeyWrapper } | null;
}

export interface MaintenanceTask {
  readonly queue: string;
  readonly cron: string;
  /** Seconds a run may take before pg-boss considers it expired. */
  readonly expireInSeconds: number;
  run(deps: TaskDeps, now: Date): Promise<unknown>;
}

export const MAINTENANCE_TASKS: readonly MaintenanceTask[] = [
  {
    // SPEC §11.6: every 5 minutes.
    queue: "wallet-reservation-sweep",
    cron: "*/5 * * * *",
    expireInSeconds: 240,
    run: ({ pool }, now) => sweepExpiredReservations(pool, now),
  },
  {
    // SPEC §11.5: nightly. Wallet operations also expire due lots on touch.
    queue: "wallet-lot-expiry",
    cron: "10 0 * * *",
    expireInSeconds: 3600,
    run: ({ pool }, now) => expireLotsSweep(pool, now),
  },
  {
    // SPEC §11.5: notices 30 and 7 days before expiry (days from config), deduplicated.
    queue: "wallet-lot-expiry-notices",
    cron: "0 9 * * *",
    expireInSeconds: 1800,
    run: ({ pool }, now) => queueLotExpiryNotices(pool, now),
  },
  {
    // SPEC §12: quotes lapse after their validity window.
    queue: "pricing-quote-expiry",
    cron: "*/15 * * * *",
    expireInSeconds: 600,
    run: ({ pool }, now) => expireQuotes(pool, now),
  },
  {
    // SPEC §12: estimator p50/p90 per action, tier and size bucket from actual ai_calls.
    queue: "ai-estimator-calibration",
    cron: "30 2 * * *",
    expireInSeconds: 1800,
    run: async ({ pool }, now) => {
      const cfg = await readConfig(pool, "ai.estimator", estimatorConfigSchema);
      return recalibrateEstimator(
        pool,
        new Date(now.getTime() - cfg.calibration_window_days * 86_400_000),
      );
    },
  },
  {
    // SPEC §19, §23: expire review reservations (cancel-after-AI charge) and remind before expiry.
    queue: "jobs-sweep",
    cron: "*/5 * * * *",
    expireInSeconds: 240,
    run: ({ pool }, now) => sweepJobs(pool, now),
  },
  {
    // SPEC §28: memory fee on each anchor anniversary, grace and archive. Run early IST.
    queue: "lifecycle-memory-fee",
    cron: "15 1 * * *",
    expireInSeconds: 3600,
    run: ({ pool }, now) => debitMemoryFees(pool, now),
  },
  {
    queue: "lifecycle-notices",
    cron: "0 10 * * *",
    expireInSeconds: 1800,
    run: ({ pool }, now) => queueLifecycleNotices(pool, now),
  },
  {
    // SPEC §28: crypto-shred archived or deleted companies past their purge date.
    queue: "lifecycle-purge",
    cron: "45 2 * * *",
    expireInSeconds: 3600,
    run: ({ pool, outputs }, now) => purgeCompanies(pool, outputs ?? null, now),
  },
  {
    // SPEC §29: monthly refresh reminder on each company's reminder day.
    queue: "reminders-monthly-refresh",
    cron: "0 9 * * *",
    expireInSeconds: 1800,
    run: ({ pool }, now) => queueRefreshReminders(pool, now),
  },
  {
    // SPEC §14, §25: Standard-delivery commentary through Message Batches; polls every 2 minutes.
    queue: "commentary-batches",
    cron: "*/2 * * * *",
    expireInSeconds: 110,
    run: async ({ pool, ai }, now) =>
      ai == null
        ? { skipped: "no AI configured" }
        : commentaryBatchTick(pool, ai.wrapper, ai.transport, now),
  },
  {
    // SPEC §27: close chat messages left waiting past their hold, releasing the credits.
    queue: "chat-sweep",
    cron: "*/5 * * * *",
    expireInSeconds: 240,
    run: ({ pool }, now) => sweepChatMessages(pool, now),
  },
  {
    queue: "notifications-deliver",
    cron: "* * * * *",
    expireInSeconds: 55,
    run: ({ pool, mail, appUrl }, now) =>
      deliverNotifications(pool, mail, { appUrl }, now),
  },
];
