import { AppFrame } from "@/components/AppFrame";
import { ButtonLink, PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { walletView } from "@/lib/billing";

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
        title="Wallet"
        description="Prepaid credits, the lots they came in, your invoices and every movement."
        actions={
          <ButtonLink href="/pricing" variant="secondary" icon="table">
            Price book
          </ButtonLink>
        }
      />
      <WalletClient initial={view} businessName={account.businessName} need={needed} />
    </AppFrame>
  );
}
