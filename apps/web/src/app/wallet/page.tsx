import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { walletView } from "@/lib/billing";
import { visitorCurrency } from "@/lib/server/visitor-currency";

import { WalletClient } from "./WalletClient";

export const metadata = { title: "Wallet" };
export const dynamic = "force-dynamic";

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ need?: string }>;
}) {
  const account = await accountOrRedirect("/wallet");
  const { need } = await searchParams;
  const view = await walletView(account.accountId, await visitorCurrency());
  // Only a plain credit count is honoured; anything else is ignored rather than shown.
  const needed = need !== undefined && /^[0-9]{1,9}$/u.test(need) ? need : null;
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        eyebrow="Credits"
        title="Wallet"
        description="Add credits, and see your balance, your invoices and every movement."
      />
      <div className="flex flex-col gap-5">
        <WalletClient initial={view} businessName={account.businessName} need={needed} />
      </div>
    </AppFrame>
  );
}
