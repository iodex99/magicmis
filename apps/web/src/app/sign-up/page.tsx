import { db } from "@/lib/db";
import { enabledProviders } from "@/lib/server/oauth";
import { welcomeOffer } from "@/lib/server/welcome";
import { welcomeLine } from "@/lib/welcome-copy";

import { SignUpScreen } from "./SignUpForm";

export const metadata = { title: "Create your account" };
// Which providers are offered is configuration read at request time, not at build.
export const dynamic = "force-dynamic";

/** The server half decides which sign-up options exist; the form is a client component. */
export default async function SignUpPage() {
  // The welcome offer as it stands now (ADR 0068), said where the decision is made.
  const welcome = welcomeLine(await welcomeOffer(db()));
  return <SignUpScreen providers={enabledProviders()} welcome={welcome} />;
}
