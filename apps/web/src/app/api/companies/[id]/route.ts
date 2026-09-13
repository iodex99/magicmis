import { deleteCompany } from "@magicmis/jobs";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, parseJson, withAccount } from "@/lib/http";

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

const deleteSchema = z.object({ confirmName: z.string() });

/** DELETE /api/companies/:id — stops fees now; data is crypto-shredded after the purge delay (SPEC §28). */
export async function DELETE(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    const parsed = await parseJson(request, deleteSchema);
    if (!parsed.ok) return parsed.response;
    const pool = db();
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
    await deleteCompany(pool, { accountId: account.accountId, companyId: id });
    return ok({ deleted: true });
  });
}
