/**
 * Scheduled maintenance (SPEC §11, §12, §29). Each task is idempotent: pg-boss may run a
 * scheduled job late or, after a crash, again, and the wallet functions tolerate both.
 * Cron expressions are evaluated in IST so "nightly" means an Indian night.
 */

import { estimatorConfigSchema, recalibrateEstimator } from "@magicmis/ai/estimator";
import { readConfig } from "@magicmis/db/config";
import { pruneRateLimits } from "@magicmis/db/ratelimit";
import type { AiTransport } from "@magicmis/ai";
import { reconcileRazorpayPurchases, type PaymentGateway } from "@magicmis/billing";
import type { KeyWrapper } from "@magicmis/crypto";
import {
  commentaryBatchTick,
  debitMemoryFees,
  processAccountExports,
  purgeAccounts,
  purgeCompanies,
  purgeExpiredUploads,
  queueLifecycleNotices,
  queueRefreshReminders,
  refreshLibraryCandidates,
  sweepJobs,
  type OutputStore,
} from "@magicmis/jobs";
import { expireQuotes, sweepExpiredReservations } from "@magicmis/wallet";
import { sweepChatMessages } from "@magicmis/chat/server";
import type { Pool } from "pg";

import { sendAdminMarginDigest } from "./admin-digest";
import { deliverNotifications } from "./deliver";
import { verifyIntegrity } from "./integrity";
import type { MailSender } from "./mail";

export const SCHEDULE_TZ = "Asia/Kolkata";

export interface TaskDeps {
  readonly pool: Pool;
  readonly mail: MailSender;
  readonly appUrl: string;
  /** Admin console base URL for admin emails; defaults to the app URL. */
  readonly adminUrl?: string;
  /** Output storage for purges; absent when storage is not configured (sealed files stay unreadable). */
  readonly outputs?: OutputStore | null;
  /** Commentary batches; absent when the worker has no Anthropic key configured. */
  readonly ai?: { readonly transport: AiTransport; readonly wrapper: KeyWrapper } | null;
  /** Account and company key access for exports; absent when no master key is configured. */
  readonly wrapper?: KeyWrapper | null;
  /** Error reporting (Sentry, scrubbed); absent when SENTRY_DSN is not set. */
  readonly reportError?: ((error: unknown, queue: string) => void) | null;
  /** Razorpay lookups for payment reconciliation; absent when keys are not configured. */
  readonly gateway?: PaymentGateway | null;
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
    run: async ({ pool, outputs, wrapper }, now) => ({
      companies: await purgeCompanies(pool, outputs ?? null, now),
      // SPEC §10, §31: erased accounts past their delay; their companies purge with them.
      accounts:
        wrapper == null
          ? { skipped: "key wrapper not configured" }
          : await purgeAccounts(pool, outputs ?? null, now, wrapper),
    }),
  },
  {
    // ADR 0032: uploaded source files past their retention are removed from the store.
    queue: "sources-purge",
    cron: "20 * * * *",
    expireInSeconds: 1800,
    run: async ({ pool, outputs }, now) =>
      outputs == null
        ? { skipped: "output store not configured" }
        : { purged: await purgeExpiredUploads(pool, outputs, now) },
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
    // SPEC §10, §31: build requested data exports and expire stale download links.
    queue: "privacy-exports",
    cron: "*/2 * * * *",
    expireInSeconds: 110,
    run: async ({ pool, outputs, wrapper }, now) =>
      outputs == null || wrapper == null
        ? { skipped: "storage or key wrapper not configured" }
        : processAccountExports(pool, wrapper, outputs, now),
  },
  {
    // SPEC §18: names mapped to the same head in enough distinct accounts become admin candidates.
    queue: "library-candidates",
    cron: "0 3 * * *",
    expireInSeconds: 1800,
    run: async ({ pool, wrapper }) =>
      wrapper == null
        ? { skipped: "key wrapper not configured" }
        : refreshLibraryCandidates(pool, wrapper),
  },
  {
    // R-51: purchases paid on Razorpay whose webhook never arrived are credited from Razorpay's record.
    queue: "billing-reconcile",
    cron: "*/15 * * * *",
    expireInSeconds: 600,
    run: async ({ pool, gateway }, now) =>
      gateway == null
        ? { skipped: "Razorpay keys not configured" }
        : reconcileRazorpayPurchases(pool, gateway, now),
  },
  {
    // SPEC §30: rate-limit counters for finished windows, kept off the request path.
    queue: "ratelimit-prune",
    cron: "*/10 * * * *",
    expireInSeconds: 300,
    run: ({ pool }, now) => pruneRateLimits(pool, now),
  },
  {
    // SPEC §30: audit chain and every ledger verified nightly; admins alerted on any mismatch.
    queue: "integrity-verify",
    cron: "30 3 * * *",
    expireInSeconds: 3600,
    run: ({ pool, mail, appUrl, adminUrl, wrapper }, now) =>
      verifyIntegrity(pool, mail, adminUrl ?? appUrl, now, wrapper ?? null),
  },
  {
    // SPEC §26: daily margin summary to admins, 08:00 IST.
    queue: "admin-margin-digest",
    cron: "0 8 * * *",
    expireInSeconds: 600,
    run: ({ pool, mail, appUrl, adminUrl }, now) =>
      sendAdminMarginDigest(pool, mail, adminUrl ?? appUrl, now),
  },
  {
    queue: "notifications-deliver",
    cron: "* * * * *",
    expireInSeconds: 55,
    run: ({ pool, mail, appUrl }, now) =>
      deliverNotifications(pool, mail, { appUrl }, now),
  },
];
