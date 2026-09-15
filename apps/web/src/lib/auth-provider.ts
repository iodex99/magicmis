import "server-only";

import { type AuthProvider } from "@magicmis/accounts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ephemeralSupabase, supabaseAdmin } from "./supabase/server";

/**
 * Supabase implementation of the accounts package's AuthProvider.
 *
 * API shapes verified against https://supabase.com/docs/guides/auth/auth-mfa/totp,
 * https://supabase.com/docs/reference/javascript/auth-signout, and -- for the admin MFA
 * API, whose reference page returned 404 -- the installed @supabase/auth-js 2.116.0 type
 * definitions (`GoTrueAdminMFAApi.listFactors/deleteFactor`).
 */
export class SupabaseAuthProvider implements AuthProvider {
  constructor(private readonly session: SupabaseClient) {}

  async verifyPassword(email: string, password: string): Promise<boolean> {
    const probe = ephemeralSupabase();
    const { error } = await probe.auth.signInWithPassword({ email, password });
    if (error !== null) return false;
    // Revoke the probe session at once. `local` scope: only this throwaway session, never
    // the user's real one.
    await probe.auth.signOut({ scope: "local" });
    return true;
  }

  async signOutOtherSessions(): Promise<void> {
    const { error } = await this.session.auth.signOut({ scope: "others" });
    if (error !== null) throw new Error(`signOut(others) failed: ${error.message}`);
  }

  async deleteTotpFactors(authUserId: string): Promise<void> {
    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.mfa.listFactors({
      userId: authUserId,
    });
    if (error !== null) throw new Error(`admin listFactors failed: ${error.message}`);
    for (const factor of data.factors) {
      if (factor.factor_type !== "totp") continue;
      const removed = await admin.auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: authUserId,
      });
      if (removed.error !== null)
        throw new Error(`admin deleteFactor failed: ${removed.error.message}`);
    }
  }
}
