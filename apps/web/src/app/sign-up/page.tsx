import { enabledProviders } from "@/lib/server/oauth";

import { SignUpScreen } from "./SignUpForm";

export const metadata = { title: "Create your account" };
// Which providers are offered is configuration read at request time, not at build.
export const dynamic = "force-dynamic";

/** The server half decides which sign-up options exist; the form is a client component. */
export default function SignUpPage() {
  return <SignUpScreen providers={enabledProviders()} />;
}
