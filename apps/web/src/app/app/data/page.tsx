import { AppFrame } from "@/components/AppFrame";
import { accountOrRedirect } from "@/lib/account-page";
import { appPublicEnv } from "@/lib/env";

import { DataSession } from "./DataSession";

export const metadata = { title: "Source files" };
export const dynamic = "force-dynamic";

export default async function DataPage() {
  const account = await accountOrRedirect("/app/data");
  return (
    <AppFrame businessName={account.businessName}>
      <h1 className="mb-2 text-xl font-semibold text-neutral-900">Source files</h1>
      <p className="mb-6 max-w-2xl text-sm text-neutral-700">
        Files are read in this browser tab and never uploaded. Only file names, sizes,
        sheet counts and row counts are shown until you run a paid action.
      </p>
      <DataSession
        sessionKey={account.sessionId}
        developerMode={appPublicEnv().NEXT_PUBLIC_ENVIRONMENT === "development"}
      />
    </AppFrame>
  );
}
