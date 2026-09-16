import "server-only";

import { type AuthProvider } from "@magicmis/accounts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ephemeralSupabase } from "./supabase/server";

/**
 * Supabase implementation of the accounts package's AuthProvider.
 *
 * A password is the only customer factor (ADR 0028), so this is the whole surface: prove
 * the password, and end every other session.
 *
 * API shapes verified against
 * https://supabase.com/docs/reference/javascript/auth-signinwithpassword and
 * https://supabase.com/docs/reference/javascript/auth-signout.
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
}
