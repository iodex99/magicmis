import Link from "next/link";

import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";

import { PriceBook } from "./PriceBook";

export const metadata = { title: "What actions cost" };
export const dynamic = "force-dynamic";

/** The per-action price book, off the Wallet and one link away from it (ADR 0050). */
export default async function PricesPage() {
  const account = await accountOrRedirect("/wallet/prices");
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        eyebrow="Credits"
        title="What actions cost"
        description="Reading this is free. Credits are held when you press an action, and only what is used is charged."
      />
      <div className="flex flex-col gap-5">
        <PriceBook />
        <p className="text-[0.8125rem] text-neutral-600">
          <Link
            href="/wallet"
            className="font-medium text-accent-700 underline underline-offset-2"
          >
            Back to the Wallet
          </Link>
        </p>
      </div>
    </AppFrame>
  );
}
