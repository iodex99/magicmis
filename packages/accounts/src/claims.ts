/**
 * Verified session claims and the account gate every route passes through.
 *
 * Claims arrive from `supabase.auth.getClaims()`, which verifies the JWT signature
 * (https://supabase.com/docs/reference/javascript/auth-getclaims). They are still parsed
 * with Zod here: a verified token is trusted to be ours, not to have the shape we expect.
 */

import { z } from "zod";

import { one, type Queryable } from "@magicmis/db/tx";

/** The subset of Supabase JWT claims this product relies on (jwt-fields reference). */
export const sessionClaimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.uuid(),
  aal: z.enum(["aal1", "aal2"]),
  email: z.email().optional(),
  role: z.string().optional(),
  amr: z.array(z.object({ method: z.string(), timestamp: z.number() })).optional(),
});

export type SessionClaims = z.infer<typeof sessionClaimsSchema>;

export interface AccountContext {
  readonly accountId: string;
  readonly authUserId: string;
  readonly sessionId: string;
  readonly email: string;
  readonly businessName: string;
  readonly stateCode: string;
}

/**
 * Why a request was refused. Each maps to a distinct user-facing outcome: SPEC §8
 * requires the old tab to say "signed out because this account signed in elsewhere",
 * and SPEC §32 requires every error to say what to do next.
 */
export type AccountRefusal =
  | "invalid_claims"
  | "no_account"
  | "account_not_active"
  | "mfa_required"
  | "session_superseded"
  | "session_not_claimed";

export type AccountDecision =
  | { readonly ok: true; readonly account: AccountContext }
  | { readonly ok: false; readonly reason: AccountRefusal };

interface AccountRow {
  id: string;
  auth_user_id: string;
  email: string;
  business_name: string;
  state_code: string;
  status: string;
  active_session_id: string | null;
  deleted_at: Date | null;
}

/**
 * The gate for every authenticated route handler.
 *
 * Mirrors `app.current_account_id()` (migration 0012) in application code. The two are
 * deliberately redundant: route handlers use the service role, which bypasses RLS, so
 * this check is the only thing between a superseded session and the data on those paths.
 */
export async function requireAccount(
  db: Queryable,
  rawClaims: unknown,
): Promise<AccountDecision> {
  const parsed = sessionClaimsSchema.safeParse(rawClaims);
  if (!parsed.success) return { ok: false, reason: "invalid_claims" };
  const claims = parsed.data;

  const row = await one<AccountRow>(
    db,
    `select id, auth_user_id, email, business_name, state_code, status,
            active_session_id, deleted_at
     from public.accounts where auth_user_id = $1`,
    [claims.sub],
  );
  if (row === null || row.deleted_at !== null) return { ok: false, reason: "no_account" };
  if (row.status !== "active") return { ok: false, reason: "account_not_active" };

  // Order matters for the message shown: an aal1 token must be told to complete 2FA even
  // if its session has also not been claimed yet.
  if (claims.aal !== "aal2") return { ok: false, reason: "mfa_required" };
  if (row.active_session_id === null) return { ok: false, reason: "session_not_claimed" };
  if (row.active_session_id !== claims.session_id) {
    return { ok: false, reason: "session_superseded" };
  }

  return {
    ok: true,
    account: {
      accountId: row.id,
      authUserId: row.auth_user_id,
      sessionId: claims.session_id,
      email: row.email,
      businessName: row.business_name,
      stateCode: row.state_code,
    },
  };
}
