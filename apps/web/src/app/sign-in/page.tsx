import { OpeningSoon } from "@/components/OpeningSoon";
import { enabledProviders } from "@/lib/server/oauth";
import { prelaunch } from "@/lib/server/prelaunch";

import { SignInScreen } from "./SignInForm";

export const metadata = { title: "Sign in" };
// Which providers are offered is configuration read at request time, not at build.
export const dynamic = "force-dynamic";

/** The server half decides which sign-in options exist; the form is a client component. */
export default function SignInPage() {
  if (prelaunch()) return <OpeningSoon />;
  return <SignInScreen providers={enabledProviders()} />;
}
