import {
  anthropicTransport,
  extractReferenceLayout,
  jobAiContext,
  RoutingError,
  runJobAiStage,
} from "@magicmis/ai";
import { failJob, loadStageOutput, saveStageOutput } from "@magicmis/jobs";
import {
  applyAiBindings,
  bindReferenceLayout,
  referenceLayoutAiInput,
  referenceLayoutSchema,
  unboundRefs,
  type RowBinding,
} from "@magicmis/templates";
import { z } from "zod";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { apiError, ok, parseJson, withAccount } from "@/lib/http";
import { rateLimited } from "@/lib/server/ratelimit";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper } from "@/lib/server/runtime";

const STAGE = "reference_layout";

/**
 * POST /api/jobs/:id/ai/reference_layout {layout} — binds a redacted reference MIS layout (SPEC
 * §22). The server binds by rules itself (it does not take the browser's word for them); only rows
 * the rules leave unbound go to `extractReferenceLayout`, with the model chosen by tier routing.
 * The bindings are checkpointed, so a retry never pays twice. No values are accepted.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    // SPEC §30: before any work or hold, so a flood cannot run up AI calls.
    const limited = await rateLimited("ai_per_account", account.accountId);
    if (limited !== null) return limited;
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "job_not_found", "Job not found.");
    const pool = db();
    const job = await pool.query<{
      company_id: string | null;
      state: string;
      type: string;
    }>(`select company_id, state, type from jobs where id = $1 and account_id = $2`, [
      id,
      account.accountId,
    ]);
    const row = job.rows[0];
    if (row === undefined || row.company_id === null)
      return apiError(404, "job_not_found", "Job not found.");
    if (row.type !== "reference_mis_recreate")
      return apiError(409, "wrong_job", "This job does not include a reference MIS.");
    if (row.state !== "mapping")
      return apiError(409, "invalid_transition", "This job is not at that stage.");
    const scope = {
      accountId: account.accountId,
      companyId: row.company_id,
      jobId: id,
      stage: STAGE,
    };

    const cached = (await loadStageOutput(pool, keyWrapper(), scope)) as {
      bindings: RowBinding[];
    } | null;
    if (cached !== null)
      return ok({ bindings: cached.bindings, reused: true, aiRows: 0 });

    const parsed = await parseJson(request, z.object({ layout: referenceLayoutSchema }));
    if (!parsed.ok) return parsed.response;
    const layout = parsed.data.layout;
    const rules = bindReferenceLayout(layout);
    const unbound = unboundRefs(rules);

    try {
      let bindings = rules;
      if (unbound.length > 0) {
        const ctx = await jobAiContext(
          pool,
          anthropicTransport(serverEnv().ANTHROPIC_API_KEY),
          id,
        );
        const outcome = await runJobAiStage(ctx, (c) =>
          extractReferenceLayout(c, referenceLayoutAiInput(layout, rules)),
        );
        if (outcome.status === "paused") {
          return apiError(
            402,
            "needs_quote",
            "This job needs more analysis than its price covers. Review the quote to continue.",
            { quoteCredits: outcome.quoteCredits.toString() },
          );
        }
        bindings = applyAiBindings(layout, rules, outcome.value.output.rows);
      }
      await saveStageOutput(pool, keyWrapper(), { ...scope, output: { bindings } });
      return ok({ bindings, reused: false, aiRows: unbound.length });
    } catch (error) {
      if (
        error instanceof RoutingError ||
        (error instanceof Error && error.name === "AiStageError")
      ) {
        await failJob(pool, {
          accountId: account.accountId,
          jobId: id,
          failureClass: "platform_fault",
          code:
            error instanceof RoutingError ? "analysis_unavailable" : "analysis_failed",
          detail: "Analysis could not run. No credits were charged.",
          reportedBy: "server",
        });
      }
      return jobErrorResponse(error);
    }
  });
}
