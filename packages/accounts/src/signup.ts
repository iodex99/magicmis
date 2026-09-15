/**
 * Signup validation and account provisioning (SPEC §8).
 *
 * Supabase Auth creates the credential; this creates the product account behind it: the
 * `accounts` row, an empty wallet, and the consent records. It runs in one transaction,
 * keyed on the auth user id, so a retried request provisions exactly once.
 */

import { isValidGstin, normaliseGstin } from "@magicmis/core/identifiers";
import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import type { Pool } from "pg";
import { z } from "zod";

import { isGstStateCode } from "./state-codes";

export const billingAddressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  // India Post PIN codes are six digits and never start with 0.
  pincode: z.string().regex(/^[1-9]\d{5}$/u, "Enter a 6-digit PIN code"),
  stateCode: z.string().refine(isGstStateCode, "Choose a state"),
});

/**
 * What sign-up asks for.
 *
 * The billing address is **optional here and collected at the first purchase** instead
 * (migration 0034). It exists to print a tax invoice; demanding a full postal address
 * before a new account has seen a single screen was nine of the eleven fields on the form.
 */
export const signupProfileSchema = z.object({
  businessName: z.string().trim().min(2).max(200),
  gstin: z
    .string()
    .transform(normaliseGstin)
    .refine((v) => v === "" || isValidGstin(v), "Enter a valid 15-character GSTIN")
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  billingAddress: billingAddressSchema.optional(),
  acceptTerms: z.literal(true, "You must accept the Terms to create an account"),
  acceptPrivacy: z.literal(
    true,
    "You must accept the Privacy notice to create an account",
  ),
});

export const signupRequestSchema = signupProfileSchema.extend({
  email: z
    .email()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  // SPEC §8 does not fix a minimum; Supabase is configured to 12 with mixed case and
  // digits (supabase/config.toml). The server re-checks so the rule cannot be bypassed.
  password: z
    .string()
    .min(12, "Use at least 12 characters")
    .max(128)
    .regex(/[a-z]/u, "Include a lower-case letter")
    .regex(/[A-Z]/u, "Include an upper-case letter")
    .regex(/\d/u, "Include a digit"),
});

export type SignupProfile = z.infer<typeof signupProfileSchema>;
export type SignupRequest = z.infer<typeof signupRequestSchema>;

/**
 * The state that drives GST place of supply (SPEC §13): the GSTIN's state when a GSTIN is
 * given, otherwise the billing address state. Null until one of the two is known, which is
 * at the first purchase for an account that gave neither at sign-up.
 */
export function placeOfSupplyState(profile: SignupProfile): string | null {
  return profile.gstin?.slice(0, 2) ?? profile.billingAddress?.stateCode ?? null;
}

export const documentVersionsSchema = z.object({
  terms: z.string().min(1),
  privacy: z.string().min(1),
  processing: z.string().min(1),
});

export type ProvisionResult =
  | { readonly status: "created"; readonly accountId: string }
  | { readonly status: "already_provisioned"; readonly accountId: string }
  /** Another auth user already holds this email. Callers must not reveal this. */
  | { readonly status: "email_taken" };

export async function provisionAccount(
  pool: Pool,
  input: {
    authUserId: string;
    email: string;
    profile: SignupProfile;
    ip: string | null;
  },
): Promise<ProvisionResult> {
  return withTransaction(pool, async (tx) => {
    const existing = await tx.query<{ id: string }>(
      `select id from public.accounts where auth_user_id = $1`,
      [input.authUserId],
    );
    const existingId = existing.rows[0]?.id;
    if (existingId !== undefined) {
      return { status: "already_provisioned", accountId: existingId };
    }

    const versions = await readConfig(
      tx,
      "legal.document_versions",
      documentVersionsSchema,
    );

    let accountId: string;
    try {
      await tx.query("savepoint provision");
      const inserted = await tx.query<{ id: string }>(
        `insert into public.accounts
           (auth_user_id, email, business_name, gstin, billing_address, state_code)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          input.authUserId,
          input.email,
          input.profile.businessName,
          input.profile.gstin ?? null,
          JSON.stringify(input.profile.billingAddress ?? {}),
          placeOfSupplyState(input.profile),
        ],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error("provisionAccount: insert returned no id");
      accountId = id;
    } catch (error) {
      if (isUniqueViolation(error, "accounts_email_active_idx")) {
        await tx.query("rollback to savepoint provision");
        return { status: "email_taken" };
      }
      throw error;
    }

    await tx.query(
      `insert into public.wallets (account_id) values ($1) on conflict do nothing`,
      [accountId],
    );

    for (const document of ["terms", "privacy"] as const) {
      await tx.query(
        `insert into public.consents (account_id, document, version, ip) values ($1, $2, $3, $4)`,
        [accountId, document, versions[document], input.ip],
      );
      await appendAudit(tx, {
        actorType: "account",
        actorId: accountId,
        action: "consent.recorded",
        targetType: "consent",
        metadata: { document, version: versions[document] },
        ip: input.ip,
      });
    }

    await appendAudit(tx, {
      actorType: "account",
      actorId: accountId,
      action: "account.created",
      targetType: "account",
      targetId: accountId,
      metadata: { hasGstin: input.profile.gstin !== undefined },
      ip: input.ip,
    });

    return { status: "created", accountId };
  });
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; constraint?: unknown };
  return e.code === "23505" && e.constraint === constraint;
}
