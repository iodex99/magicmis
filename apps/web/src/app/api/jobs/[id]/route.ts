import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, withAccount } from "@/lib/http";

/** GET /api/jobs/:id — state, price and outcome. Failure details are plain text, never figures. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "job_not_found", "Job not found.");
    const r = await db().query<{
      id: string;
      company_id: string | null;
      type: string;
      tier: string;
      delivery_mode: string;
      state: string;
      price_credits: string | null;
      captured_credits: string | null;
      failure_class: string | null;
      failure_code: string | null;
      failure_detail: string | null;
      quote_credits: string | null;
      quote_expires_at: Date | null;
      output_id: string | null;
    }>(
      `select j.id, j.company_id, j.type, j.tier, j.delivery_mode, j.state, j.price_credits::text as price_credits,
              j.captured_credits::text as captured_credits, j.failure_class, j.failure_code, j.failure_detail,
              q.credits::text as quote_credits, q.expires_at as quote_expires_at,
              (select o.id from outputs o where o.job_id = j.id order by o.created_at desc limit 1) as output_id
       from jobs j left join quotes q on q.id = j.quote_id
       where j.id = $1 and j.account_id = $2`,
      [id, account.accountId],
    );
    const j = r.rows[0];
    if (j === undefined) return apiError(404, "job_not_found", "Job not found.");
    return ok({
      id: j.id,
      companyId: j.company_id,
      type: j.type,
      tier: j.tier,
      delivery: j.delivery_mode,
      state: j.state,
      priceCredits: j.price_credits,
      capturedCredits: j.captured_credits,
      failure:
        j.failure_class === null
          ? null
          : { class: j.failure_class, code: j.failure_code, detail: j.failure_detail },
      quote:
        j.quote_credits === null
          ? null
          : {
              credits: j.quote_credits,
              expiresAt: j.quote_expires_at?.toISOString() ?? null,
            },
      outputId: j.output_id,
    });
  });
}
