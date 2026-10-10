import { OpeningSoon } from "@/components/OpeningSoon";
import { enabledProviders } from "@/lib/server/oauth";
import { prelaunch } from "@/lib/server/prelaunch";

import { SignInScreen } from "./SignInForm";

export const metadata = { title: "Sign in" };
// Which providers are offered is configuration read at request time, not at build.
export const dynamic = "force-dynamic";

/** The server half decides which sign-in options exist; the form is a client component. */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (prelaunch()) return <OpeningSoon />;
  // Sent here by the proxy from a page that needs a session (ADR 0091 says so on the form).
  const { next } = await searchParams;
  return (
    <SignInScreen
      providers={enabledProviders()}
      continuing={typeof next === "string" && next !== "" && next !== "/app"}
    />
  );
}
