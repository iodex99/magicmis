/**
 * Scheduled maintenance (SPEC §11, §12, §29). Each task is idempotent: pg-boss may run a
 * scheduled job late or, after a crash, again, and the wallet functions tolerate both.
 * Cron expressions are evaluated in IST so "nightly" means an Indian night.
 */

import {
  expireLotsSweep,
  expireQuotes,
  queueLotExpiryNotices,
  sweepExpiredReservations,
} from "@magicmis/wallet";
import type { Pool } from "pg";

import { deliverNotifications } from "./deliver";
import type { MailSender } from "./mail";

export const SCHEDULE_TZ = "Asia/Kolkata";

export interface TaskDeps {
  readonly pool: Pool;
  readonly mail: MailSender;
  readonly appUrl: string;
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
    queue: "notifications-deliver",
    cron: "* * * * *",
    expireInSeconds: 55,
    run: ({ pool, mail, appUrl }, now) =>
      deliverNotifications(pool, mail, { appUrl }, now),
  },
];
