import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";
import { legalFacts } from "@/lib/server/legal";

import { PrivacySettings } from "./PrivacySettings";

export const metadata = { title: "Privacy and data" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const account = await accountOrRedirect("/settings/privacy");
  const [{ welcomeFingerprintDays, deletionPurgeDelayDays }, wallet] = await Promise.all([
    legalFacts(),
    // What deleting the account gives up, said as a number (ADR 0091).
    db().query<{ balance: string }>(
      `select balance_credits::text as balance from public.wallets where account_id = $1`,
      [account.accountId],
    ),
  ]);
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        title="Privacy and data"
        description="What is stored, how to take a copy of it, and how to have it destroyed."
      />
      <PrivacySettings
        email={account.email}
        fingerprintDays={welcomeFingerprintDays}
        purgeDays={deletionPurgeDelayDays}
        balance={wallet.rows[0]?.balance ?? "0"}
      />
    </AppFrame>
  );
}
