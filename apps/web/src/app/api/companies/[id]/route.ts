import { hasFreshReauth } from "@magicmis/accounts";
import { isReportingCurrency } from "@magicmis/core/reporting-conventions";
import { CompanyBusy, deleteCompany } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, idempotent, ok, parseJson, withAccount } from "@/lib/http";
import { updateCompanyConventions } from "@/lib/server/companies";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/companies/:id — history: jobs, snapshot periods and downloadable outputs. */
export async function GET(_request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    const pool = db();
    const company = await pool.query<{
      id: string;
      name: string;
      lifecycle_state: string;
      fy_start_month: number;
      first_setup_at: Date | null;
    }>(
      `select id, name, lifecycle_state, fy_start_month, first_setup_at from companies where id = $1 and account_id = $2 and deleted_at is null`,
      [id, account.accountId],
    );
    const c = company.rows[0];
    if (c === undefined) return apiError(404, "company_not_found", "Company not found.");
    const [jobs, snapshots, outputs] = await Promise.all([
      pool.query<{
        id: string;
        type: string;
        state: string;
        tier: string;
        captured_credits: string | null;
        created_at: Date;
      }>(
        `select id, type, state, tier, captured_credits::text as captured_credits, created_at from jobs where company_id = $1 order by created_at desc limit 50`,
        [id],
      ),
      pool.query<{ period: string; version: number; created_at: Date }>(
        `select period, version, created_at from snapshots where company_id = $1 order by period desc, version desc limit 50`,
        [id],
      ),
      pool.query<{
        id: string;
        file_name: string | null;
        byte_size: string;
        created_at: Date;
        expires_at: Date | null;
      }>(
        `select id, file_name, byte_size::text as byte_size, created_at, expires_at from outputs where company_id = $1 order by created_at desc limit 50`,
        [id],
      ),
    ]);
    return ok({
      company: {
        id: c.id,
        name: c.name,
        lifecycleState: c.lifecycle_state,
        fyStartMonth: c.fy_start_month,
        setUp: c.first_setup_at !== null,
      },
      jobs: jobs.rows.map((j) => ({
        id: j.id,
        type: j.type,
        state: j.state,
        tier: j.tier,
        capturedCredits: j.captured_credits,
        createdAt: j.created_at.toISOString(),
      })),
      snapshots: snapshots.rows.map((s) => ({
        period: s.period,
        version: s.version,
        createdAt: s.created_at.toISOString(),
      })),
      outputs: outputs.rows.map((o) => ({
        id: o.id,
        fileName: o.file_name,
        bytes: o.byte_size,
        createdAt: o.created_at.toISOString(),
        expiresAt: o.expires_at?.toISOString() ?? null,
      })),
    });
  });
}

const deleteSchema = z.object({ confirmName: z.string().max(200) });

/**
 * DELETE /api/companies/:id — stops fees now; data is crypto-shredded after the purge delay (SPEC §28).
 * Requires re-authentication (SPEC §8) and the company name typed out; audit-logged.
 */
export async function DELETE(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    const pool = db();
    if (!(await hasFreshReauth(pool, account)))
      return apiError(
        403,
        "reauth_required",
        "Confirm your password to delete this company.",
      );
    const parsed = await parseJson(request, deleteSchema);
    if (!parsed.ok) return parsed.response;
    const c = await pool.query<{ name: string }>(
      `select name from companies where id = $1 and account_id = $2 and deleted_at is null`,
      [id, account.accountId],
    );
    const name = c.rows[0]?.name;
    if (name === undefined)
      return apiError(404, "company_not_found", "Company not found.");
    if (parsed.data.confirmName.trim() !== name) {
      return apiError(
        422,
        "confirmation_mismatch",
        "Type the company name exactly to confirm deletion.",
        { confirmName: "Does not match" },
      );
    }
    try {
      return await idempotent(
        request,
        `company-delete:${account.accountId}:${id}`,
        { id },
        async () => {
          await deleteCompany(pool, { accountId: account.accountId, companyId: id });
          return { status: 200, body: { deleted: true } };
        },
      );
    } catch (error) {
      if (!(error instanceof CompanyBusy)) throw error;
      return apiError(
        409,
        "jobs_in_progress",
        "A job or chat message for this company is still in progress. Wait for it to finish or cancel it, then try again.",
      );
    }
  });
}

const conventionsSchema = z.object({
  fyStartMonth: z.number().int().min(1).max(12),
  currency: z.string().refine(isReportingCurrency, "Unsupported reporting currency"),
  numberFormat: z.enum(["lakhs_crores", "absolute", "millions"]),
  dateOrder: z.enum(["day_first", "month_first"]),
});

/**
 * PATCH /api/companies/:id — the company's own reporting conventions (ADR 0030, ADR 0035).
 *
 * A company set to the wrong financial year reads every year's first month as a whole year, and
 * until now there was no way to correct it. Changing this reads no data and charges nothing; it
 * takes effect on the next run.
 */
export async function PATCH(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "company_not_found", "Company not found.");
    const parsed = await parseJson(request, conventionsSchema);
    if (!parsed.ok) return parsed.response;
    return idempotent(
      request,
      `company-conventions:${account.accountId}:${id}`,
      parsed.raw,
      async () => {
        const updated = await updateCompanyConventions(db(), {
          accountId: account.accountId,
          companyId: id,
          ...parsed.data,
        });
        return updated
          ? { status: 200, body: { updated: true } }
          : {
              status: 404,
              body: { error: "company_not_found", message: "Company not found." },
            };
      },
    );
  });
}
