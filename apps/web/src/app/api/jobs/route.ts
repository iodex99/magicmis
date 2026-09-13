import { sizeDescriptorsSchema } from "@magicmis/ai/estimator";
import { createJob } from "@magicmis/jobs";
import { walletSummary } from "@magicmis/wallet";
import { z } from "zod";

import { db } from "@/lib/db";
import { idempotent, parseJson, withAccount } from "@/lib/http";
import { jobErrorResponse } from "@/lib/server/job-errors";

const bodySchema = z.object({
  companyId: z.uuid(),
  type: z.enum([
    "data_diagnostic",
    "company_setup",
    "reference_mis_recreate",
    "monthly_refresh",
    "dashboard_addon",
    "commentary",
  ]),
  tier: z.enum(["efficient", "professional", "expert"]),
  delivery: z.enum(["standard", "instant"]),
  // Counts only (SPEC §12): the browser never sends content to be priced.
  size: sizeDescriptorsSchema,
  fingerprints: z
    .record(z.string().max(60), z.string().regex(/^[0-9a-f]{64}$/u))
    .refine((r) => Object.keys(r).length <= 200),
});

/**
 * POST /api/jobs — estimate a job from size descriptors and return its exact price, or a quote
 * when the estimate exceeds the AI cost cap (SPEC §12). Nothing is held until confirmation.
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
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
          const job = await createJob(pool, {
            accountId: account.accountId,
            companyId: parsed.data.companyId,
            type: parsed.data.type,
            tier: parsed.data.tier,
            delivery: parsed.data.delivery,
            idempotencyKey: key,
            size: parsed.data.size,
            sourceFingerprints: parsed.data.fingerprints,
          });
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
