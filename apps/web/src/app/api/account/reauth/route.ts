import { reauthenticate } from "@magicmis/accounts";
import { z } from "zod";

import { SupabaseAuthProvider } from "@/lib/auth-provider";
import { db } from "@/lib/db";
import { apiError, ok, parseJson, requestMeta, withAccount } from "@/lib/http";
import { supabaseForRequest } from "@/lib/supabase/server";

const bodySchema = z.object({ password: z.string().min(1).max(128) });

/** POST /api/account/reauth — the password again, before a sensitive action (SPEC §8). */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const { ip } = await requestMeta();
    const supabase = await supabaseForRequest();

    const result = await reauthenticate(
      db(),
      new SupabaseAuthProvider(supabase),
      account,
      { password: parsed.data.password, ip },
    );

    switch (result.status) {
      case "granted":
        return ok({ status: "granted", expiresAt: result.expiresAt.toISOString() });
      case "invalid_credentials":
        return apiError(
          401,
          "invalid_credentials",
          `That password is incorrect. ${String(result.attemptsRemaining)} attempts left.`,
        );
      case "password_not_set":
        // ADR 0043: this account signs in through Google or Apple. The screen offers the
        // emailed link that sets a password, which is itself a fresh re-authentication.
        return apiError(
          409,
          "password_not_set",
          "This account has no password yet. Set one from the link we email you, and you can continue.",
        );
      case "locked":
        return apiError(
          429,
          "too_many_attempts",
          "Too many incorrect attempts. Try again in 30 minutes.",
        );
    }
  });
}
