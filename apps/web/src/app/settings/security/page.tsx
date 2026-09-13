import Link from "next/link";

import { AppFrame } from "@/components/AppFrame";
import { accountOrRedirect } from "@/lib/account-page";

import { SecuritySettings } from "./SecuritySettings";

export const metadata = { title: "Security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const account = await accountOrRedirect("/settings/security");
  return (
    <AppFrame businessName={account.businessName}>
      <div className="mb-6 flex items-baseline gap-6">
        <h1 className="text-xl font-semibold text-neutral-900">Security</h1>
        <Link href="/settings/profile" className="text-sm text-neutral-700 underline">
          Business profile
        </Link>
      </div>
      <SecuritySettings />
    </AppFrame>
  );
}
