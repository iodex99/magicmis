import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { walletView } from "@/lib/billing";

import { PriceBook } from "./PriceBook";
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
  const view = await walletView(account.accountId);
  // Only a plain credit count is honoured; anything else is ignored rather than shown.
  const needed = need !== undefined && /^[0-9]{1,9}$/u.test(need) ? need : null;
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        eyebrow="Credits"
        title="Wallet"
        description="Your credits, what they buy, your invoices and every movement."
      />
      <div className="flex flex-col gap-5">
        <WalletClient initial={view} businessName={account.businessName} need={needed} />
        <PriceBook />
      </div>
    </AppFrame>
  );
}
