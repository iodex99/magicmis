import { isReportingCurrency } from "@magicmis/core/reporting-conventions";
import { z } from "zod";

import { db } from "@/lib/db";
import { idempotent, ok, parseJson, withAccount } from "@/lib/http";
import { createCompany, listCompanies } from "@/lib/server/companies";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  fyStartMonth: z.number().int().min(1).max(12).default(4),
  /**
   * The company's own reporting conventions (ADR 0030). Defaulted to the Indian set
   * so an existing caller keeps working; the form sends all three, pre-filled from
   * the account's billing country.
   */
  currency: z
    .string()
    .refine(isReportingCurrency, "Unsupported reporting currency")
    .default("INR"),
  numberFormat: z.enum(["lakhs_crores", "absolute", "millions"]).default("lakhs_crores"),
  dateOrder: z.enum(["day_first", "month_first"]).default("day_first"),
});

/** GET /api/companies — the account's companies. */
export async function GET(): Promise<Response> {
  return withAccount(async (account) =>
    ok({ companies: await listCompanies(db(), account.accountId) }),
  );
}

/** POST /api/companies — create a company. Captures nothing (SPEC §23). */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    return idempotent(request, `company:${account.accountId}`, parsed.raw, async () => ({
      status: 201,
      body: {
        companyId: await createCompany(db(), {
          accountId: account.accountId,
          ...parsed.data,
        }),
      },
    }));
  });
}
