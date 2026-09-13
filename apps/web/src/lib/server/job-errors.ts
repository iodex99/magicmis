import "server-only";

import { RoutingError, RuntimeCapExceeded, AiStageError } from "@magicmis/ai";
import { CompanyKeyDestroyed } from "@magicmis/engine/server";
import { JobError, JobStateError } from "@magicmis/jobs";
import { PricingError } from "@magicmis/wallet";

import { apiError } from "../http";

/** Known job-flow failures as plain responses that say what to do next (SPEC §32). */
export function jobErrorResponse(error: unknown): Response {
  if (error instanceof JobError) {
    const status =
      error.code === "insufficient_credits"
        ? 402
        : error.code === "company_not_found" || error.code === "not_found"
          ? 404
          : 409;
    return apiError(status, error.code, error.message, error.detail);
  }
  if (error instanceof JobStateError) {
    return error.code === "not_found"
      ? apiError(404, "job_not_found", "Job not found.")
      : apiError(
          409,
          error.code,
          "This job cannot do that now. Reload the page to see its current state.",
        );
  }
  if (error instanceof PricingError) {
    return apiError(
      409,
      error.code,
      "This action is not available for the selected tier.",
    );
  }
  if (error instanceof CompanyKeyDestroyed) {
    return apiError(
      410,
      "company_purged",
      "This company's data has been permanently deleted.",
    );
  }
  if (error instanceof RuntimeCapExceeded) {
    return apiError(
      402,
      "needs_quote",
      "This job needs more analysis than its price covers. Review the quote to continue.",
    );
  }
  if (error instanceof RoutingError || error instanceof AiStageError) {
    return apiError(
      503,
      "analysis_unavailable",
      "Analysis is not available right now. No credits were charged for it.",
    );
  }
  throw error;
}
