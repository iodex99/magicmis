import {
  billingAddressSchema,
  placeOfSupplyState,
  signupProfileSchema,
} from "@magicmis/accounts";
import { appendAudit } from "@magicmis/db/audit";
import { withTransaction } from "@magicmis/db/tx";
import { z } from "zod";

import { db } from "@/lib/db";
import { idempotent, ok, parseJson, requestMeta, withAccount } from "@/lib/http";

interface ProfileRow {
  email: string;
  business_name: string;
  gstin: string | null;
  billing_address: unknown;
  state_code: string;
}

/** GET /api/account/profile */
export async function GET(): Promise<Response> {
  return withAccount(async (account) => {
    const result = await db().query<ProfileRow>(
      `select email, business_name, gstin, billing_address, state_code from public.accounts where id = $1`,
      [account.accountId],
    );
    const row = result.rows[0];
    return ok({
      email: row?.email,
      businessName: row?.business_name,
      gstin: row?.gstin,
      billingAddress: billingAddressSchema.safeParse(row?.billing_address).data ?? null,
      placeOfSupplyState: row?.state_code,
    });
  });
}

const patchSchema = z.object({
  businessName: signupProfileSchema.shape.businessName,
  gstin: z.string().max(20).optional(),
  billingAddress: billingAddressSchema,
});

/**
 * PATCH /api/account/profile — business name, GSTIN, billing address (SPEC §32 Account
 * settings). Not a re-auth action in SPEC §8. Audited, with field names only: SPEC §9
 * keeps audit metadata free of content that could be sensitive.
 */
export async function PATCH(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const parsed = await parseJson(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    // Re-use the signup rules for GSTIN normalisation and checksum.
    const profile = signupProfileSchema.safeParse({
      ...parsed.data,
      acceptTerms: true,
      acceptPrivacy: true,
    });
    if (!profile.success) {
      const fields: Record<string, string> = {};
      for (const issue of profile.error.issues)
        fields[issue.path.join(".")] ??= issue.message;
      return ok(
        {
          error: "validation_failed",
          message: "Check the highlighted fields and try again.",
          fields,
        },
        422,
      );
    }
    const { ip } = await requestMeta();

    return idempotent(request, `account:${account.accountId}`, parsed.raw, async () => {
      await withTransaction(db(), async (tx) => {
        await tx.query(
          `update public.accounts
           set business_name = $2, gstin = $3, billing_address = $4, state_code = $5
           where id = $1`,
          [
            account.accountId,
            profile.data.businessName,
            profile.data.gstin ?? null,
            JSON.stringify(profile.data.billingAddress),
            placeOfSupplyState(profile.data),
          ],
        );
        await appendAudit(tx, {
          actorType: "account",
          actorId: account.accountId,
          action: "account.profile_updated",
          targetType: "account",
          targetId: account.accountId,
          metadata: { fields: ["businessName", "gstin", "billingAddress"] },
          ip,
        });
      });
      return { status: 200, body: { status: "updated" } };
    });
  });
}
