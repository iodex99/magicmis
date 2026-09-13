import Link from "next/link";

import { AppFrame } from "@/components/AppFrame";
import { accountOrRedirect } from "@/lib/account-page";

import { ProfileForm } from "./ProfileForm";

export const metadata = { title: "Business profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const account = await accountOrRedirect("/settings/profile");
  return (
    <AppFrame businessName={account.businessName}>
      <div className="mb-6 flex items-baseline gap-6">
        <h1 className="text-xl font-semibold text-neutral-900">Business profile</h1>
        <Link href="/settings/security" className="text-sm text-neutral-700 underline">
          Security
        </Link>
      </div>
      <ProfileForm />
    </AppFrame>
  );
}
