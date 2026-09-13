import "server-only";

import { LocalKeyWrapper, RotatingKeyWrapper, type KeyWrapper } from "@magicmis/crypto";
import { clientIp } from "@magicmis/core/security-headers";
import { KmsKeyWrapper } from "@magicmis/crypto/kms";
import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import pg from "pg";

import { loadAdminEnv, type AdminEnv } from "./env";
import type { AuthFactorAdmin } from "./recovery";
import { parseAllowlist } from "./identity";

let env: AdminEnv | undefined;
let pool: pg.Pool | undefined;
let wrapper: KeyWrapper | undefined;

export function adminEnv(): AdminEnv {
  env ??= loadAdminEnv(process.env);
  return env;
}

/** Same connection shape as the customer app (ADR 0003): service_role from the first byte. */
export function db(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: adminEnv().DATABASE_URL,
    options: "-c role=service_role",
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

export function keyWrapper(): KeyWrapper {
  if (wrapper) return wrapper;
  const e = adminEnv();
  wrapper =
    e.KEY_WRAPPER === "local"
      ? LocalKeyWrapper.fromBase64(e.LOCAL_MASTER_KEY ?? "")
      : kmsWrapper(e.KMS_MASTER_KEY_ID ?? "", e.KMS_PREVIOUS_MASTER_KEY_ID, e.AWS_REGION);
  return wrapper;
}

function kmsWrapper(
  keyId: string,
  previousKeyId: string | undefined,
  region: string | undefined,
): KeyWrapper {
  const config = region === undefined ? {} : { region };
  const current = new KmsKeyWrapper(keyId, config);
  return previousKeyId === undefined
    ? current
    : new RotatingKeyWrapper(current, new KmsKeyWrapper(previousKeyId, config));
}

export const allowlist = (): ReadonlySet<string> =>
  parseAllowlist(adminEnv().ADMIN_ALLOWED_EMAILS);

export function ipAllowlist(): ReadonlySet<string> | null {
  const raw = adminEnv().ADMIN_IP_ALLOWLIST;
  if (raw === undefined || raw.trim() === "") return null;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string }> {
  const h = await headers();
  // Only proxy-added values; an unknown IP fails the allowlist closed (SPEC §30).
  return { ip: clientIp((name) => h.get(name)), userAgent: h.get("user-agent") ?? "" };
}

/**
 * Supabase Auth admin MFA calls for account recovery (R-21), or null when the console has no
 * Supabase admin access configured. `auth.admin.mfa.listFactors({ userId })` and
 * `deleteFactor({ id, userId })` per @supabase/auth-js 2.116.0 `GoTrueAdminMFAApi` typings.
 */
export function authFactorAdmin(): AuthFactorAdmin | null {
  const e = adminEnv();
  if (e.NEXT_PUBLIC_SUPABASE_URL === undefined || e.SUPABASE_SECRET_KEY === undefined)
    return null;
  const client = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async removeTotpFactors(authUserId: string): Promise<number> {
      const listed = await client.auth.admin.mfa.listFactors({ userId: authUserId });
      if (listed.error !== null)
        throw new Error(`listFactors failed: ${listed.error.message}`);
      let removed = 0;
      for (const factor of listed.data.factors) {
        if (factor.factor_type !== "totp") continue;
        const r = await client.auth.admin.mfa.deleteFactor({
          id: factor.id,
          userId: authUserId,
        });
        if (r.error !== null) throw new Error(`deleteFactor failed: ${r.error.message}`);
        removed += 1;
      }
      return removed;
    },
  };
}
