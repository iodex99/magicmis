import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { authCookieOptions } from "@magicmis/core/security-headers";

import { appPublicEnv, serverEnv } from "../env";

/**
 * Supabase client bound to the request's auth cookies.
 *
 * Pattern from https://supabase.com/docs/guides/auth/server-side/nextjs (verified
 * 2026-09-13). Server code authorises with `getClaims()`, never `getSession()`.
 */
export async function supabaseForRequest(): Promise<SupabaseClient> {
  const store = await cookies();
  const env = appPublicEnv();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: authCookieOptions(env.NEXT_PUBLIC_ENVIRONMENT),
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(toSet) {
          try {
            for (const { name, value, options } of toSet) store.set(name, value, options);
          } catch {
            // Called from a Server Component, where cookies are read-only. The proxy
            // refreshes the session on the next request, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * A throwaway client that never persists a session. Used only to check a password
 * during re-authentication without touching the caller's own session.
 */
export function ephemeralSupabase() {
  const env = appPublicEnv();
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}

/** Admin client with the secret key. Server only; bypasses RLS and Auth policies. */
export function supabaseAdmin() {
  const env = appPublicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
