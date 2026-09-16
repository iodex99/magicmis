import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";

import { SecuritySettings } from "./SecuritySettings";

export const metadata = { title: "Security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const account = await accountOrRedirect("/settings/security");
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        title="Security"
        description="Your password, and every sign-in on this account."
      />
      <SecuritySettings />
    </AppFrame>
  );
}
