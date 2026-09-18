/**
 * Claiming the single active session (SPEC §8).
 *
 * Called once per login, as soon as the password is accepted. It makes this session the
 * account's only valid one, records the login, raises a new-device alert, and asks the
 * identity provider to revoke every other session.
 *
 * The order is deliberate. The database write comes first and is what actually cuts off
 * the previous session: `app.current_account_id()` and `requireAccount()` both compare
 * against `active_session_id`, so the old tab is refused on its very next request even
 * if the provider-side revocation is slow or fails. Revocation then removes the old
 * refresh token so the old tab cannot quietly mint new access tokens either.
 */

import { appendAudit } from "@magicmis/db/audit";
import { withTransaction } from "@magicmis/db/tx";
import type { Pool } from "pg";

import { sessionClaimsSchema } from "./claims";
import { deviceFingerprintHash, describeUserAgent } from "./device";
import { enqueueNotification } from "./notifications";
import { type AuthProvider } from "./provider";

export interface RequestContext {
  readonly ip: string | null;
  readonly userAgent: string;
  /** Approximate location from IP, if a lookup is available. Never precise. */
  readonly geo?: { country?: string; region?: string; city?: string } | null;
}

export type ClaimResult =
  | {
      readonly status: "claimed";
      readonly accountId: string;
      readonly newDevice: boolean;
      /** False if the provider revocation failed; the DB cut-off still holds. */
      readonly otherSessionsRevoked: boolean;
    }
  | { readonly status: "already_active"; readonly accountId: string }
  | {
      readonly status: "refused";
      readonly reason: "invalid_claims" | "no_account" | "account_not_active";
    };

export async function claimSession(
  pool: Pool,
  provider: AuthProvider,
  rawClaims: unknown,
  context: RequestContext,
): Promise<ClaimResult> {
  const parsed = sessionClaimsSchema.safeParse(rawClaims);
  if (!parsed.success) return { status: "refused", reason: "invalid_claims" };
  const claims = parsed.data;
  const outcome = await withTransaction(pool, async (tx) => {
    const account = await tx.query<{
      id: string;
      status: string;
      active_session_id: string | null;
      deleted_at: Date | null;
    }>(
      `select id, status, active_session_id, deleted_at
       from public.accounts where auth_user_id = $1 for update`,
      [claims.sub],
    );
    const row = account.rows[0];
    if (row === undefined) {
      return { status: "refused", reason: "no_account" } as const;
    }
    if (row.deleted_at !== null) {
      return { status: "refused", reason: "account_not_active" } as const;
    }
    if (row.status !== "active") {
      return { status: "refused", reason: "account_not_active" } as const;
    }
    if (row.active_session_id === claims.session_id) {
      return { status: "already_active", accountId: row.id } as const;
    }

    const fingerprint = deviceFingerprintHash(row.id, context.userAgent);
    const priorLogins = await tx.query<{ seen: boolean; any_login: boolean }>(
      `select
         exists (select 1 from public.login_events
                 where account_id = $1 and event_type = 'login'
                   and device_fingerprint_hash = $2) as seen,
         exists (select 1 from public.login_events
                 where account_id = $1 and event_type = 'login') as any_login`,
      [row.id, fingerprint],
    );
    const prior = priorLogins.rows[0];
    // The very first login is not a "new device" -- there is nothing to compare against,
    // and alerting on signup teaches users to ignore the alert.
    const newDevice = prior !== undefined && prior.any_login && !prior.seen;

    const previousSession = row.active_session_id;
    await tx.query(`update public.accounts set active_session_id = $2 where id = $1`, [
      row.id,
      claims.session_id,
    ]);

    const loginEvent = await tx.query<{ id: string }>(
      `insert into public.login_events
         (account_id, event_type, ip, geo, user_agent, device_fingerprint_hash, new_device)
       values ($1, 'login', $2, $3, $4, $5, $6)
       returning id`,
      [
        row.id,
        context.ip,
        context.geo ? JSON.stringify(context.geo) : null,
        context.userAgent,
        fingerprint,
        newDevice,
      ],
    );
    const loginEventId = loginEvent.rows[0]?.id ?? "";

    if (previousSession !== null) {
      await tx.query(
        `insert into public.login_events (account_id, event_type, ip, user_agent)
         values ($1, 'session_revoked', $2, $3)`,
        [row.id, context.ip, context.userAgent],
      );
    }

    await appendAudit(tx, {
      actorType: "account",
      actorId: row.id,
      action: "auth.session_claimed",
      targetType: "account",
      targetId: row.id,
      metadata: { newDevice, supersededPrevious: previousSession !== null },
      ip: context.ip,
    });

    if (newDevice) {
      await enqueueNotification(tx, {
        accountId: row.id,
        type: "security.new_device_login",
        payload: {
          device: describeUserAgent(context.userAgent),
          country: context.geo?.country ?? null,
          city: context.geo?.city ?? null,
        },
        dedupeKey: `login:${loginEventId}`,
      });
    }

    return { status: "claimed", accountId: row.id, newDevice } as const;
  });

  if (outcome.status !== "claimed") return outcome;

  let otherSessionsRevoked = true;
  try {
    await provider.signOutOtherSessions();
  } catch {
    // Not fatal: active_session_id already refuses the old session everywhere. Reported
    // so the caller can log it and the old refresh token can be swept later.
    otherSessionsRevoked = false;
  }
  return { ...outcome, otherSessionsRevoked };
}
