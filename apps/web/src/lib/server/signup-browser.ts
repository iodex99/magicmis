import "server-only";

import { appPublicEnv } from "@/lib/env";

/**
 * The secret held by the browser that submitted the sign-up form (ADR 0071, R-85).
 *
 * Scoped to the callback, where it is read, and to one week, which covers any confirmation link
 * still worth opening. A confirmation opened in a browser without it does not sign anyone in: the
 * password chosen at sign-up is destroyed and the mailbox owner finishes the account.
 */
export const SIGNUP_BROWSER_COOKIE = "signup_browser";

export function signupBrowserCookie(nonce: string) {
  return {
    name: SIGNUP_BROWSER_COOKIE,
    value: nonce,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: appPublicEnv().NEXT_PUBLIC_APP_URL.startsWith("https://"),
    path: "/auth/callback",
    maxAge: 7 * 24 * 60 * 60,
  };
}
