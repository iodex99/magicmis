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
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DashboardError)
      await failJob(pool, {
        accountId: job.accountId,
        jobId: job.jobId,
        failureClass: "platform_fault",
        code: `layout_${error.code}`,
        detail: error.message,
        reportedBy: "server",
      });
    throw error;
  }
}
