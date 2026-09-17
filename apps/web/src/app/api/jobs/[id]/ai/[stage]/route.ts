import {
  anthropicTransport,
  classifySheets,
  classifySheetsInput,
  jobAiContext,
  mapLedgers,
  runJobAiStage,
} from "@magicmis/ai";
import { loadStageOutput, saveStageOutput } from "@magicmis/jobs";
import { aiHeadList } from "@magicmis/semantic";
import { z } from "zod";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { apiError, ok, parseJson, withAccount } from "@/lib/http";
import { rateLimited } from "@/lib/server/ratelimit";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper } from "@/lib/server/runtime";

const ledgersSchema = z.object({
  ledgers: z
    .array(
      z.object({
        ref: z.string().regex(/^l\d{1,5}$/u),
        name: z.string().min(1).max(200),
        group_path: z.array(z.string().max(200)).max(12),
      }),
    )
    .min(1)
    .max(2000),
});

const LOWER: Record<string, string> = {
  expert: "professional",
  professional: "efficient",
};

/**
 * POST /api/jobs/:id/ai/{sheet_classification|ledger_mapping} — the only AI entry points for a
 * job (SPEC §7, §14). Inputs are redacted structures; the server picks the model, effort and
 * token limit from routing, applies the runtime cap, and checkpoints the output so a retry never
 * pays twice. There is no generic prompt field anywhere in these schemas.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; stage: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    // SPEC §30: before any work or hold, so a flood cannot run up AI calls.
    const limited = await rateLimited("ai_per_account", account.accountId);
    if (limited !== null) return limited;
    const { id, stage } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "job_not_found", "Job not found.");
    if (stage !== "sheet_classification" && stage !== "ledger_mapping")
      return apiError(404, "not_found", "Unknown analysis stage.");
    const pool = db();
    const job = await pool.query<{ company_id: string | null; state: string }>(
      `select company_id, state from jobs where id = $1 and account_id = $2`,
      [id, account.accountId],
    );
    const row = job.rows[0];
    if (row?.company_id === null || row === undefined)
      return apiError(404, "job_not_found", "Job not found.");
    const expectedState = stage === "sheet_classification" ? "classifying" : "mapping";
    if (row.state !== expectedState)
      return apiError(409, "invalid_transition", "This job is not at that stage.");
    const scope = {
      accountId: account.accountId,
      companyId: row.company_id,
      jobId: id,
      stage,
    };

    const cached = await loadStageOutput(pool, keyWrapper(), scope);
    if (cached !== null) return ok({ output: cached, reused: true });

    const input =
      stage === "sheet_classification"
        ? await parseJson(request, classifySheetsInput)
        : await parseJson(request, ledgersSchema);
    if (!input.ok) return input.response;

    try {
      const ctx = await jobAiContext(
        pool,
        anthropicTransport(serverEnv().ANTHROPIC_API_KEY),
        id,
      );
      const outcome = await runJobAiStage(ctx, async (c) =>
        stage === "sheet_classification"
          ? classifySheets(c, input.data as z.infer<typeof classifySheetsInput>)
          : mapLedgers(c, {
              heads: aiHeadList(),
              ledgers: (input.data as z.infer<typeof ledgersSchema>).ledgers,
            }),
      );
      if (outcome.status === "paused") {
        return apiError(
          402,
          "needs_quote",
          "This job needs more analysis than its price covers. Review the quote to continue.",
          {
            quoteCredits: outcome.quoteCredits.toString(),
          },
        );
      }
      await saveStageOutput(pool, keyWrapper(), {
        ...scope,
        output: outcome.value.output,
      });
      if (outcome.value.downgraded) {
        // SPEC §14: a lower tier's model delivered; completion captures that tier's price.
        const tier = await pool.query<{ tier: string }>(
          `select tier from jobs where id = $1`,
          [id],
        );
        const lower = LOWER[tier.rows[0]?.tier ?? ""];
        if (lower !== undefined) {
          await pool.query(
            `update jobs set stage_checkpoints = stage_checkpoints || jsonb_build_object('delivered_tier', $2::text) where id = $1`,
            [id, lower],
          );
        }
      }
      return ok({ output: outcome.value.output, reused: false });
    } catch (error) {
      // An analysis that cannot run no longer fails the job (ADR 0031). The browser carries on
      // without it — unrecognised sheets are set aside, unmatched ledgers go to review, a
      // reference layout falls back to the standard template — and the job settles as usual.
      return jobErrorResponse(error);
    }
  });
}
