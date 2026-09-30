import { OpeningSoon } from "@/components/OpeningSoon";
import { db } from "@/lib/db";
import { enabledProviders } from "@/lib/server/oauth";
import { prelaunch } from "@/lib/server/prelaunch";
import { welcomeOffer } from "@/lib/server/welcome";
import { welcomeConditions, welcomeLine } from "@/lib/welcome-copy";

import { SignUpScreen } from "./SignUpForm";

export const metadata = { title: "Create your account" };
// Which providers are offered is configuration read at request time, not at build.
export const dynamic = "force-dynamic";

/** The server half decides which sign-up options exist; the form is a client component. */
export default async function SignUpPage() {
  if (prelaunch()) return <OpeningSoon />;
  // The welcome offer as it stands now (ADR 0068), said where the decision is made.
  const offer = await welcomeOffer(db());
  const line = welcomeLine(offer);
  // The claim and its conditions together, in the same type (ADR 0072).
  const welcome =
    line === null ? null : `${line} ${welcomeConditions(offer) ?? ""}`.trim();
  return <SignUpScreen providers={enabledProviders()} welcome={welcome} />;
}
