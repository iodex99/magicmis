import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { appPublicEnv } from "@/lib/env";

import { DataSession } from "./DataSession";

export const metadata = { title: "Source files" };
export const dynamic = "force-dynamic";

export default async function DataPage() {
  const account = await accountOrRedirect("/app/data");
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        title="Source files"
        description="Files are read in this browser tab and never uploaded. Until you run a paid action you see only file names, sizes, sheet counts and row counts."
      />
      <DataSession
        sessionKey={account.sessionId}
        developerMode={appPublicEnv().NEXT_PUBLIC_ENVIRONMENT === "development"}
      />
    </AppFrame>
  );
}
