/**
 * After a run: put the new figures on the dashboard, in the same press of the button (ADR 0047).
 *
 * The owner's flow is "add a file, press one button, see it on the dashboard". Before this the
 * run delivered a workbook and the dashboard then offered a second paid button — Build, or
 * Refresh — to let the new figures in. That second press is what is removed; **the charge is
 * not**. The dashboard is still its own priced action in the price book (`dashboard_addon` the
 * first time, `dashboard_refresh` after), held and captured exactly as when the customer pressed
 * it themselves (locked decisions 3 and 5).
 *
 * **Every completed run refreshes the board, and is charged for it**, whether or not the latest
 * month moved. A back-dated file (March, added when the board is through May) puts new figures
 * on the board just as a new month does; treating "the latest month is unchanged" as "nothing to
 * do" would have delivered them uncharged.
 *
 * It never fails the run, and it never strands a hold: whatever stops it after the credits are
 * held fails the dashboard job as ours, which releases them at once.
 */

import type { KeyWrapper } from "@magicmis/crypto";
import type { Pool } from "pg";

import { companyDashboard, completeDashboardAddon } from "./dashboard";
import { confirmJob, createJob, JobError } from "./jobs";
import { cancelJob, failJob } from "./settle";

export type DashboardUpdate =
  | {
      readonly status: "updated";
      readonly capturedCredits: string;
      readonly first: boolean;
    }
  /** The wallet could not cover it. Nothing held, nothing charged; the board's own button remains. */
  | { readonly status: "short" }
  | { readonly status: "failed" };

const NO_SIZE = {
  files: 0,
  sheets: 0,
  columns: 0,
  rows: 0,
  distinctLedgerValues: 0,
  referenceMisSheets: 0,
};

export async function bringDashboardUpToDate(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; companyId: string; runJobId: string; now?: Date },
): Promise<DashboardUpdate> {
  const scope = { accountId: input.accountId, companyId: input.companyId };
  const idempotencyKey = `auto-dashboard:${input.runJobId}`;
  let jobId: string | null = null;
  try {
    // A retried run resumes the dashboard job it already has. Deciding afresh would see the
    // dashboard that job just built, ask for a refresh under the same key, and fail a job that
    // had in fact been delivered and charged.
    const earlier = await pool.query<{
      id: string;
      type: string;
      state: string;
      captured: string | null;
    }>(
      `select id, type, state, captured_credits::text as captured from public.jobs
        where account_id = $1 and idempotency_key = $2`,
      [input.accountId, idempotencyKey],
    );
    const had = earlier.rows[0];
    if (had?.state === "completed")
      return {
        status: "updated",
        capturedCredits: had.captured ?? "0",
        first: had.type === "dashboard_addon",
      };
    if (had !== undefined && had.state.startsWith("failed")) return { status: "failed" };

    // Read strictly (ADR 0045): an unreadable saved dashboard throws here, before any hold.
    const first =
      had === undefined
        ? (await companyDashboard(pool, wrapper, scope)) === null
        : had.type === "dashboard_addon";
    const job = await createJob(pool, {
      ...scope,
      type: first ? "dashboard_addon" : "dashboard_refresh",
      tier: "professional",
      delivery: "standard",
      // One dashboard update per run, however many times the run's request is retried.
      idempotencyKey,
      size: NO_SIZE,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    jobId = job.jobId;
    await confirmJob(pool, { accountId: input.accountId, jobId });
    const done = await completeDashboardAddon(pool, wrapper, {
      accountId: input.accountId,
      jobId,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    return { status: "updated", capturedCredits: done.captured.toString(), first };
  } catch (error) {
    if (error instanceof JobError && error.code === "insufficient_credits") {
      // Nothing is held, so no money is at risk — but the job row exists and would sit in
      // `estimated` for ever under the same idempotency key, which a retried run keeps
      // re-confirming (ADR 0053). Cancelling it leaves the key free for a real attempt once
      // the customer has topped up.
      if (jobId !== null)
        await cancelJob(pool, {
          accountId: input.accountId,
          jobId,
          ...(input.now === undefined ? {} : { now: input.now }),
        }).catch(() => undefined);
      return { status: "short" };
    }
    // Anything else after the job exists: fail it as ours, so a hold is never left waiting for
    // the reservation to lapse. A job with nothing held is unaffected by this.
    if (jobId !== null)
      await failJob(pool, {
        accountId: input.accountId,
        jobId,
        failureClass: "platform_fault",
        code: "auto_dashboard",
        detail: "The dashboard could not be updated after the run.",
        reportedBy: "server",
      }).catch(() => undefined);
    return { status: "failed" };
  }
}
