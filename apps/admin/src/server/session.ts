import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { resolveSession, type AdminSession } from "./identity";
import { adminEnv, allowlist, db, ipAllowlist, requestMeta } from "./runtime";

/** `__Host-` binds the cookie to this exact origin over HTTPS (RFC 6265bis). */
export const sessionCookieName = (): string =>
  adminEnv().APP_ENVIRONMENT !== "development" ? "__Host-mis_admin" : "mis_admin";

export async function sessionToken(): Promise<string> {
  return (await cookies()).get(sessionCookieName())?.value ?? "";
}

/**
 * The gate for every admin page and action. Pages and actions call it themselves; nothing
 * relies on a layout or proxy having run first.
 */
export async function requireAdmin(): Promise<AdminSession & { ip: string | null }> {
  const { ip } = await requestMeta();
  const allowedIps = ipAllowlist();
  if (allowedIps !== null && (ip === null || !allowedIps.has(ip)))
    redirect("/login?error=ip");
  const session = await resolveSession(db(), await sessionToken());
  // Removing an email from ADMIN_ALLOWED_EMAILS ends its live sessions at the next request.
  if (session === null || !allowlist().has(session.email.toLowerCase()))
    redirect("/login");
  return { ...session, ip };
}
