import { neverSignedInAccount, sessionClaimsSchema } from "@magicmis/accounts";

import { db } from "@/lib/db";
import { supabaseForRequest } from "@/lib/supabase/server";

import { FinishForm } from "./FinishForm";

export const metadata = { title: "Finish creating your account" };
// Whether a password is asked for depends on this session and this account.
export const dynamic = "force-dynamic";

/**
 * A password is asked for when the address was proven by the confirmation link rather than by
 * Google or Apple, on an account nobody has signed in to: a password sign-up confirmed in another
 * browser, whose password was destroyed at the callback (ADR 0071).
 */
export default async function FinishSignUpPage() {
  const supabase = await supabaseForRequest();
  const claims = sessionClaimsSchema.safeParse(
    (await supabase.auth.getClaims()).data?.claims,
  );
  const askPassword =
    claims.success &&
    !(claims.data.amr ?? []).some((m) => m.method === "oauth") &&
    (await neverSignedInAccount(db(), claims.data.sub)) !== null;
  return <FinishForm askPassword={askPassword} />;
}
