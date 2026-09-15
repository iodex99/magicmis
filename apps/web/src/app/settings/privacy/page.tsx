import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";

import { PrivacySettings } from "./PrivacySettings";

export const metadata = { title: "Privacy and data" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const account = await accountOrRedirect("/settings/privacy");
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        title="Privacy and data"
        description="What is stored, how to take a copy of it, and how to have it destroyed."
      />
      <PrivacySettings email={account.email} />
    </AppFrame>
  );
}
