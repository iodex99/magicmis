import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";

import { ProfileForm } from "./ProfileForm";

export const metadata = { title: "Business profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const account = await accountOrRedirect("/settings/profile");
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        title="Business profile"
        description="The name, GSTIN and billing address printed on your tax invoices."
      />
      <ProfileForm />
    </AppFrame>
  );
}
