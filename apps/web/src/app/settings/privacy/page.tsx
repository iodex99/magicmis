import Link from "next/link";

import { AppFrame } from "@/components/AppFrame";
import { accountOrRedirect } from "@/lib/account-page";

import { PrivacySettings } from "./PrivacySettings";

export const metadata = { title: "Privacy and data" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const account = await accountOrRedirect("/settings/privacy");
  return (
    <AppFrame businessName={account.businessName}>
      <div className="mb-6 flex items-baseline gap-6">
        <h1 className="text-xl font-semibold text-neutral-900">Privacy and data</h1>
        <Link href="/settings/profile" className="text-sm text-neutral-700 underline">
          Business profile
        </Link>
        <Link href="/settings/security" className="text-sm text-neutral-700 underline">
          Security
        </Link>
      </div>
      <PrivacySettings email={account.email} />
    </AppFrame>
  );
}
