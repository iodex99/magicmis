import "server-only";

import { serverEnv } from "@/lib/env";
import { apiError } from "@/lib/http";

/**
 * Before launch (ADR 0078): the public site is live so search engines can find it, and the
 * product is not. `PRELAUNCH=1` closes every door into an account — sign-up, sign-in, the
 * password reset, the provider sign-in and the email link — and leaves every public page open.
 */
export function prelaunch(): boolean {
  return serverEnv().PRELAUNCH;
}

/** What an auth endpoint answers while the product is not open yet. */
export function openingSoon(): Response {
  return apiError(503, "opening_soon", "Sign-up is not open yet. It opens soon.");
}
