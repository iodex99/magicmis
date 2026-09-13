import "server-only";

import { LocalKeyWrapper, RotatingKeyWrapper, type KeyWrapper } from "@magicmis/crypto";
import { clientIp } from "@magicmis/core/security-headers";
import { KmsKeyWrapper } from "@magicmis/crypto/kms";
import { headers } from "next/headers";
import pg from "pg";

import { loadAdminEnv, type AdminEnv } from "./env";
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
