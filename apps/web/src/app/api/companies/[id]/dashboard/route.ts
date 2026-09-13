import {
  applyDashboardPatch,
  previewDashboardPatch,
  undoDashboard,
} from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, ok, parseJson, withAccount } from "@/lib/http";
import { dashboardPayload } from "@/lib/server/insights";
import { jobErrorResponse } from "@/lib/server/job-errors";
import { keyWrapper } from "@/lib/server/runtime";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/companies/:id/dashboard — the dashboard spec, its version, and the company's metric values. */
export async function GET(_request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    try {
      const payload = await dashboardPayload(db(), account.accountId, id);
      return payload === null
        ? apiError(404, "company_not_found", "Company not found.")
        : ok(payload);
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}

// Operations are validated as RFC 6902 and against the spec schema on the server.
const operations = z.array(z.unknown()).max(100);
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("preview"),
    baseVersion: z.number().int().positive(),
    operations,
  }),
  z.object({
    action: z.literal("apply"),
    baseVersion: z.number().int().positive(),
    operations,
  }),
  z.object({ action: z.literal("undo"), baseVersion: z.number().int().positive() }),
]);

/**
 * POST /api/companies/:id/dashboard — preview or apply a JSON Patch, or undo (SPEC §24.2). Applying
 * and undoing each store a new blueprint version. Layout edits read no data and are not charged.
 */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const pool = db();
    const scope = { accountId: account.accountId, companyId: id };
    const body = parsed.data;
    try {
      if (body.action === "preview")
        return ok(await previewDashboardPatch(pool, keyWrapper(), { ...scope, ...body }));
      return await idempotent(
        request,
        `dashboard:${account.accountId}:${id}`,
        parsed.raw,
        async () => ({
          status: 200,
          body:
            body.action === "apply"
              ? await applyDashboardPatch(pool, keyWrapper(), { ...scope, ...body })
              : await undoDashboard(pool, keyWrapper(), {
                  ...scope,
                  baseVersion: body.baseVersion,
                }),
        }),
      );
    } catch (error) {
      return jobErrorResponse(error);
    }
  });
}
