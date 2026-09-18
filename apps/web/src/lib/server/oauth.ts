import "server-only";

import { serverEnv } from "@/lib/env";

/**
 * Identity providers offered beside the password (ADR 0043).
 *
 * The list is configuration, not code: a provider appears on the sign-in and sign-up screens
 * only once the owner has put its credentials into Supabase and named it in
 * `AUTH_OAUTH_PROVIDERS`. Until then there is no button and the start route answers 404, so a
 * half-configured provider can never be reached by a customer.
 */
export type OAuthProvider = "google" | "apple";

/** Where to land after a provider sign-in, carried across the round trip (see the route). */
export const OAUTH_NEXT_COOKIE = "oauth_next";

export const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  apple: "Apple",
};

export function enabledProviders(): readonly OAuthProvider[] {
  return serverEnv().AUTH_OAUTH_PROVIDERS;
}

export function isEnabledProvider(value: string): value is OAuthProvider {
  return (enabledProviders() as readonly string[]).includes(value);
}
