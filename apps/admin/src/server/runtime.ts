import "server-only";

import { LocalKeyWrapper, type KeyWrapper } from "@magicmis/crypto";
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
      : new KmsKeyWrapper(
          e.KMS_MASTER_KEY_ID ?? "",
          e.AWS_REGION === undefined ? {} : { region: e.AWS_REGION },
        );
  return wrapper;
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
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip:
      forwarded !== undefined && forwarded !== ""
        ? forwarded
        : (h.get("x-real-ip") ?? null),
    userAgent: h.get("user-agent") ?? "",
  };
}
