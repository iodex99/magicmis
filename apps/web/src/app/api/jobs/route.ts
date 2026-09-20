import { sizeDescriptorsSchema } from "@magicmis/ai/estimator";
import { createJob } from "@magicmis/jobs";
import { walletSummary } from "@magicmis/wallet";
import { z } from "zod";

import { db } from "@/lib/db";
import { idempotent, parseJson, withAccount } from "@/lib/http";
import { jobSession } from "@/lib/server/companies";
import { processingConsentRequired } from "@/lib/server/consent";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { pricingFromUploads } from "@/lib/server/run-job";

export const maxDuration = 120;

const bodySchema = z.object({
  companyId: z.uuid(),
  type: z.enum([
    "data_diagnostic",
    "company_setup",
    "reference_mis_recreate",
    "monthly_refresh",
    "dashboard_addon",
    "dashboard_refresh",
    "commentary",
  ]),
  tier: z.enum(["efficient", "professional", "expert"]),
  // Jobs without files (dashboard, commentary) are priced from counts the caller states.
  size: sizeDescriptorsSchema.optional(),
  fingerprints: z
    .record(z.string().max(60), z.string().regex(/^[0-9a-f]{64}$/u))
    .refine((r) => Object.keys(r).length <= 200)
    .optional(),
  // Setup and refresh are priced from the uploaded files themselves, read here (ADR 0032).
  uploadIds: z.array(z.uuid()).min(1).max(200).optional(),
  referenceUploadId: z.uuid().nullable().optional(),
});

/**
 * POST /api/jobs — estimate a job from size descriptors and return its exact price, or a quote
 * when the estimate exceeds the AI cost cap (SPEC §12). Nothing is held until confirmation.
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const consent = await processingConsentRequired(account.accountId);
    if (consent !== null) return consent;
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const key = request.headers.get("idempotency-key") ?? "";
    try {
      return await idempotent(
        request,
        `job:${account.accountId}`,
        parsed.raw,
        async () => {
          const pool = db();
          let size = parsed.data.size;
          let fingerprints = parsed.data.fingerprints;
          const uploadIds = parsed.data.uploadIds ?? [];
          const referenceId = parsed.data.referenceUploadId ?? null;
          if (uploadIds.length > 0) {
            const wanted = [...uploadIds, ...(referenceId === null ? [] : [referenceId])];
            const owned = await pool.query<{ n: number }>(
              `select count(*)::int as n from source_uploads
               where id = any($1::uuid[]) and account_id = $2 and company_id = $3
                 and status = 'ready' and deleted_at is null`,
              [wanted, account.accountId, parsed.data.companyId],
            );
            if ((owned.rows[0]?.n ?? 0) !== new Set(wanted).size)
              return {
                status: 409,
                body: {
                  error: "uploads_not_ready",
                  message:
                    "Some files have not finished uploading. Wait a moment and try again.",
                },
              };
            const session = await jobSession(
              pool,
              account.accountId,
              parsed.data.companyId,
            );
            if (session === null)
              return {
                status: 404,
                body: { error: "company_not_found", message: "Company not found." },
              };
            const priced = await pricingFromUploads(
              pool,
              account.accountId,
              session,
              uploadIds,
              referenceId,
            );
            size = priced.size;
            fingerprints = priced.fingerprints;
          }
          if (size === undefined)
            return {
              status: 422,
              body: {
                error: "validation_failed",
                message: "Add files to price this job.",
              },
            };
          const job = await createJob(pool, {
            accountId: account.accountId,
            companyId: parsed.data.companyId,
            type: parsed.data.type,
            tier: parsed.data.tier,
            // Not from the browser: delivery is a price input, so the server picks it.
            // Every run is instant since ADR 0050, and the price book still holds the
            // surcharge so an operator can price a queued mode again without a code change.
            delivery: "instant",
            idempotencyKey: key,
            size,
            ...(fingerprints === undefined ? {} : { sourceFingerprints: fingerprints }),
          });
          if (uploadIds.length > 0)
            await pool.query(
              `update jobs set stage_checkpoints = stage_checkpoints
                 || jsonb_build_object('source_uploads', $2::jsonb, 'reference_upload', $3::jsonb)
               where id = $1`,
              [job.jobId, JSON.stringify(uploadIds), JSON.stringify(referenceId)],
            );
          const wallet = await walletSummary(pool, account.accountId);
          return {
            status: 201,
            body: {
              jobId: job.jobId,
              state: job.state,
              type: job.type,
              priceCredits: job.priceCredits.toString(),
              quote:
                job.quote === null
                  ? null
                  : {
                      credits: job.quote.credits.toString(),
                      expiresAt: job.quote.expiresAt.toISOString(),
                    },
              restructure: job.drift?.beyondThreshold ?? false,
              available: wallet.available.toString(),
            },
          };
        },
      );
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
