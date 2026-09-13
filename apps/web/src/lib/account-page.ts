import "server-only";

import { requireAccount, type AccountContext } from "@magicmis/accounts";
import { redirect } from "next/navigation";

import { db } from "./db";
import { currentClaims } from "./http";

/**
 * The gate for server-rendered authenticated pages. Same decision as the API gate, mapped
 * to navigation: each refusal lands the user on the page that explains what to do next.
 */
export async function accountOrRedirect(path: string): Promise<AccountContext> {
  const decision = await requireAccount(db(), await currentClaims());
  if (decision.ok) return decision.account;

  switch (decision.reason) {
    case "session_superseded":
      return redirect("/signed-out?reason=elsewhere");
    case "mfa_required":
      return redirect(`/sign-in/mfa?next=${encodeURIComponent(path)}`);
    case "account_not_active":
      return redirect("/signed-out?reason=inactive");
    case "invalid_claims":
    case "no_account":
    case "session_not_claimed":
      return redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  }
}
