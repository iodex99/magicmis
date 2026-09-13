import { readConfig } from "@magicmis/db/config";
import { recipeSchema, snapshotPayloadSchema } from "@magicmis/engine";
import { saveAccountRules } from "@magicmis/engine/server";
import { completeJob, recordLibraryVotes } from "@magicmis/jobs";
import { accountRuleSchema, mappingRulesSchema } from "@magicmis/semantic";
import { templateSpecSchema } from "@magicmis/templates";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, readJsonBody, withAccount } from "@/lib/http";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper, outputStore } from "@/lib/server/runtime";

const bodySchema = z.object({
  snapshot: snapshotPayloadSchema,
  blueprint: z
    .object({
      templateSpec: templateSpecSchema,
      recipe: recipeSchema,
      mappingRules: mappingRulesSchema,
      sourceFingerprints: z.record(
        z.string().max(60),
        z.string().regex(/^[0-9a-f]{64}$/u),
      ),
    })
    .nullable(),
  accountRules: z.array(accountRuleSchema).max(5000),
  output: z.object({
    fileName: z.string().regex(/^[A-Za-z0-9_.-]{1,160}\.xlsx$/u),
    base64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/u),
  }),
});

/**
 * POST /api/jobs/:id/complete — the browser has computed, validated (V1–V11 passed) and rendered.
 * The server re-checks that no blocking check failed, stores the snapshot, blueprint and sealed
 * workbook, then captures the price of the tier delivered (SPEC §23). Payload caps from config.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "job_not_found", "Job not found.");
    const pool = db();
    const [caps, maxOutput] = await Promise.all([
      readConfig(
        pool,
        "ai.payload_caps",
        z.object({ snapshot_upload_bytes: z.number().int().positive() }).loose(),
      ),
      readConfig(pool, "outputs.max_upload_bytes", z.number().int().positive()),
    ]);
    // Ownership before reading a large body: another account's job id costs nothing to refuse.
    const owned = await pool.query(
      `select 1 from jobs where id = $1 and account_id = $2`,
      [id, account.accountId],
    );
    if (owned.rows.length === 0) return apiError(404, "job_not_found", "Job not found.");
    // Streamed and abandoned past the limit: snapshot cap + base64 workbook cap + envelope.
    const json = await readJsonBody(request, {
      maxBytes: caps.snapshot_upload_bytes + Math.ceil((maxOutput * 4) / 3) + 1_000_000,
      tooLargeMessage:
        "The completed job is too large to save. Reduce the number of periods and try again.",
    });
    if (!json.ok) return json.response;
    const parsed = bodySchema.safeParse(json.raw);
    if (!parsed.success)
      return apiError(
        422,
        "validation_failed",
        "The completed job could not be read. Reload the page and run it again.",
      );
    const body = parsed.data;
    if (
      new TextEncoder().encode(JSON.stringify(body.snapshot)).length >
      caps.snapshot_upload_bytes
    ) {
      return apiError(
        413,
        "snapshot_too_large",
        "The snapshot is larger than the allowed size.",
      );
    }
    const bytes = Buffer.from(body.output.base64, "base64");
    if (bytes.length > maxOutput)
      return apiError(
        413,
        "output_too_large",
        "The workbook is larger than the allowed size.",
      );
    const blocking = body.snapshot.validationResults.filter(
      (c) => c.status === "fail" && c.severity === "blocking",
    );
    if (blocking.length > 0) {
      return apiError(
        409,
        "validation_failed",
        "Blocking checks failed, so this job cannot complete. Report the failure instead.",
      );
    }

    try {
      return await idempotent(
        request,
        `job-complete:${account.accountId}:${id}`,
        { id },
        async () => {
          const job = await pool.query<{ company_id: string | null }>(
            `select company_id from jobs where id = $1 and account_id = $2`,
            [id, account.accountId],
          );
          const companyId = job.rows[0]?.company_id ?? null;
          const result = await completeJob(pool, keyWrapper(), {
            accountId: account.accountId,
            jobId: id,
            snapshot: body.snapshot,
            blueprint:
              body.blueprint === null
                ? null
                : {
                    templateSpec: body.blueprint.templateSpec,
                    recipe: body.blueprint.recipe,
                    mappingRules: body.blueprint.mappingRules,
                    dashboardSpec: null,
                    materiality: {
                      pct: body.blueprint.templateSpec.materiality.pct,
                      absPaise: body.blueprint.templateSpec.materiality.absPaise,
                    },
                    sourceFingerprints: body.blueprint.sourceFingerprints,
                  },
            output: { fileName: body.output.fileName, bytes },
            outputStore: await outputStore(),
          });
          await saveAccountRules(pool, keyWrapper(), {
            accountId: account.accountId,
            companyId,
            rules: body.accountRules,
          });
          // SPEC §18: eligible generic names count toward global library candidates (digests only).
          await recordLibraryVotes(pool, keyWrapper(), {
            accountId: account.accountId,
            rules: body.accountRules,
          });
          return {
            status: 200,
            body: {
              capturedCredits: result.captured.toString(),
              snapshotVersion: result.snapshotVersion,
              blueprintVersion: result.blueprintVersion,
              outputId: result.outputId,
            },
          };
        },
      );
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
