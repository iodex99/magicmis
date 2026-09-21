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
import { one, withTransaction, type Queryable } from "@magicmis/db/tx";
import type { Pool } from "pg";
import { z } from "zod";

import { isCountryCode, normaliseCountry } from "@magicmis/core/identifiers";

import { invoiceableMessage, isInvoiceable } from "./invoiceable";
import { isGstStateCode } from "./state-codes";

/** Free text that is printed on a tax invoice, so it must be renderable (R-25). */
const printed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(isInvoiceable, {
      error: (issue) => invoiceableMessage(String(issue.input)),
    });

/**
 * Where the customer is invoiced (ADR 0030).
 *
 * The country decides both the billing currency and the tax treatment, so it is
 * required and validated. Everything conditional on it is checked afterwards: an
 * Indian address needs a GST state and a six-digit PIN code, and no other country has
 * either. A single postal-code rule would have to be either Indian and wrong abroad, or
 * permissive and useless at home.
 */
export const billingAddressSchema = z
  .object({
    line1: printed(200).min(1),
    line2: printed(200).optional(),
    city: printed(100).min(1),
    country: z
      .string()
      .transform(normaliseCountry)
      .refine(isCountryCode, "Choose a country"),
    postalCode: printed(20).min(1),
    /** India only: the GST state that decides place of supply. */
    stateCode: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.country !== "IN") return;
    if (!isGstStateCode(value.stateCode ?? "")) {
      ctx.addIssue({
        code: "custom",
        path: ["stateCode"],
        message: "Choose a state",
      });
    }
    // India Post PIN codes are six digits and never start with 0.
    if (!/^[1-9]\d{5}$/u.test(value.postalCode)) {
      ctx.addIssue({
        code: "custom",
        path: ["postalCode"],
        message: "Enter a 6-digit PIN code",
      });
    }
  });

/**
 * What sign-up asks for.
 *
 * The billing address is **optional here and collected at the first purchase** instead
 * (migration 0034). It exists to print a tax invoice; demanding a full postal address
 * before a new account has seen a single screen was nine of the eleven fields on the form.
 */
export const signupProfileSchema = z.object({
  // Printed on every tax invoice, where an unrenderable character would become "?" (R-25).
  businessName: printed(200).min(2),
  gstin: z
    .string()
    .transform(normaliseGstin)
    .refine(
      (v) => v === "" || (isValidGstin(v) && isGstStateCode(v.slice(0, 2))),
      "Enter a valid 15-character GSTIN",
    )
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
  // Only an Indian supply has a GST place of supply. A state code carried over from an
  // address that later became non-Indian would silently produce a domestic tax invoice
  // for an export, which the database also refuses (migration 0037).
  if (billingCountry(profile) !== "IN") return null;
  // Only a GSTIN naming an assigned state decides place of supply; anything else falls back to
  // the address, which `billingAddressSchema` already validates against the same list.
  const fromGstin = profile.gstin?.slice(0, 2);
  if (fromGstin !== undefined && isGstStateCode(fromGstin)) return fromGstin;
  return profile.billingAddress?.stateCode ?? null;
}

/** The ISO country the account is invoiced in, or null until an address is given. */
export function billingCountry(profile: SignupProfile): string | null {
  return profile.billingAddress?.country ?? null;
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
    /** False for an account created through Google or Apple (ADR 0043). */
    hasPassword?: boolean;
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
           (auth_user_id, email, business_name, gstin, billing_address, state_code,
            has_password)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          input.authUserId,
          input.email,
          input.profile.businessName,
          input.profile.gstin ?? null,
          JSON.stringify(input.profile.billingAddress ?? {}),
          placeOfSupplyState(input.profile),
          input.hasPassword ?? true,
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

/**
 * The account behind an auth user, if nobody has ever signed in to it (ADR 0043).
 *
 * The password form writes the account row when the form is submitted, before the address is
 * proven. Anyone can therefore leave a row behind for an address that is not theirs, with a
 * business name and a password of their choosing, and wait for its owner to arrive through
 * Google or Apple — the identity provider links the two by email. A row in this state belongs
 * to whoever first proves the address; if they prove it through a provider, they finish it
 * themselves (`refinishAccount`) and whatever password was set before is destroyed.
 */
export async function neverSignedInAccount(
  db: Queryable,
  authUserId: string,
): Promise<string | null> {
  const row = await one<{ id: string }>(
    db,
    `select a.id from public.accounts a
      where a.auth_user_id = $1 and a.deleted_at is null
        and not exists (select 1 from public.login_events e
                         where e.account_id = a.id and e.event_type = 'login')`,
    [authUserId],
  );
  return row?.id ?? null;
}

/**
 * Hand a never-signed-in account to the person who has just proved the address through an
 * identity provider: their business name, their consent recorded against their own request,
 * and no password. Refuses, changing nothing, once anyone has signed in to the account.
 */
export async function refinishAccount(
  pool: Pool,
  input: { accountId: string; businessName: string; ip: string | null },
): Promise<boolean> {
  return withTransaction(pool, async (tx) => {
    const locked = await tx.query<{ id: string }>(
      `select a.id from public.accounts a
        where a.id = $1 and a.deleted_at is null
          and not exists (select 1 from public.login_events e
                           where e.account_id = a.id and e.event_type = 'login')
        for update`,
      [input.accountId],
    );
    if (locked.rows[0] === undefined) return false;

    await tx.query(
      `update public.accounts set business_name = $2, has_password = false where id = $1`,
      [input.accountId, input.businessName],
    );
    const versions = await readConfig(
      tx,
      "legal.document_versions",
      documentVersionsSchema,
    );
    for (const document of ["terms", "privacy"] as const) {
      await tx.query(
        `insert into public.consents (account_id, document, version, ip) values ($1, $2, $3, $4)`,
        [input.accountId, document, versions[document], input.ip],
      );
      await appendAudit(tx, {
        actorType: "account",
        actorId: input.accountId,
        action: "consent.recorded",
        targetType: "consent",
        metadata: { document, version: versions[document] },
        ip: input.ip,
      });
    }
    await appendAudit(tx, {
      actorType: "account",
      actorId: input.accountId,
      action: "account.claimed_by_verified_identity",
      targetType: "account",
      targetId: input.accountId,
      metadata: {},
      ip: input.ip,
    });
    return true;
  });
}
