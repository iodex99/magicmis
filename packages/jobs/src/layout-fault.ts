/**
 * Paid work that reads or writes a company's saved layout. If the layout stops it (unreadable,
 * missing, or still changing after every retry) nothing was delivered, so the job is failed as
 * ours and its hold released **now**, not when the reservation would have lapsed. The error is
 * rethrown for the caller to answer with.
 */

import type { Pool } from "pg";

import { DashboardError } from "./layout-error";
import { failJob } from "./settle";

export async function releasingOnLayoutFault<T>(
  pool: Pool,
  job: { accountId: string; jobId: string },
  ...rest:
    [work: () => Promise<T>] | [also: (error: unknown) => boolean, work: () => Promise<T>]
): Promise<T> {
  const work = rest.length === 1 ? rest[0] : rest[1];
  const also = rest.length === 1 ? () => false : rest[0];
  try {
    return await work();
  } catch (error) {
    if (error instanceof DashboardError || also(error))
      // Releasing the hold must not replace the error the caller has to answer with
      // (ADR 0053). A job that is already terminal makes `failJob` throw a state error,
      // which would surface instead of the layout fault that actually stopped the work.
      await failJob(pool, {
        accountId: job.accountId,
        jobId: job.jobId,
        failureClass: "platform_fault",
        code:
          error instanceof DashboardError ? `layout_${error.code}` : "input_unavailable",
        detail: error instanceof Error ? error.message : "The work could not start.",
        reportedBy: "server",
      }).catch(() => undefined);
    throw error;
  }
}
