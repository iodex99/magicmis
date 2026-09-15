/**
 * The operations this package needs from the identity provider (Supabase Auth).
 *
 * An interface rather than a direct SDK dependency, for two reasons: the security logic
 * around these calls -- throttling, grants, audit, single-use codes -- is tested against
 * real Postgres without a live Auth server; and the Supabase-specific adapter lives in
 * apps/web next to the cookie handling it needs.
 */

export interface AuthProvider {
  /**
   * Check a password without affecting the caller's session. The Supabase adapter signs
   * in on a throwaway, non-persisted client and revokes that session immediately.
   */
  verifyPassword(email: string, password: string): Promise<boolean>;

  /** Revoke every session for the user except the calling one. */
  signOutOtherSessions(): Promise<void>;

  /** Remove all TOTP factors for a user, so they must re-enrol (backup-code recovery). */
  deleteTotpFactors(authUserId: string): Promise<void>;
}
