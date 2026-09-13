import { AppFrame } from "@/components/AppFrame";
import { accountOrRedirect } from "@/lib/account-page";
import { walletView } from "@/lib/billing";

import { WalletClient } from "./WalletClient";

export const metadata = { title: "Wallet" };
export const dynamic = "force-dynamic";

export default async function WalletPage() {
  const account = await accountOrRedirect("/wallet");
  const view = await walletView(account.accountId);
  return (
    <AppFrame businessName={account.businessName}>
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Wallet</h1>
      <WalletClient initial={view} businessName={account.businessName} />
    </AppFrame>
  );
}
