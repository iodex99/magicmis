import "server-only";

import { walletSummary } from "@magicmis/wallet";
import type { ReactNode } from "react";

import { formatCredits } from "@/lib/actions";
import { db } from "@/lib/db";

import { SessionWatcher } from "./SessionWatcher";
import { Sidebar } from "./Sidebar";
import { SignOutButton } from "./SignOutButton";

/**
 * The signed-in shell: a dark navigation rail against the light working surface.
 *
 * The available balance sits in the rail on every page because this is a prepaid product
 * (SPEC §2.4) -- knowing what is left is part of deciding whether to start a paid action,
 * and hunting for it on the Wallet page each time is the wrong answer.
 */
export async function AppFrame({
  accountId,
  businessName,
  company,
  children,
}: {
  /** Omit only where the caller has no account context; the rail then shows a dash. */
  accountId?: string;
  businessName: string;
  company?: { id: string; name: string };
  children: ReactNode;
}) {
  const available =
    accountId === undefined
      ? "—"
      : formatCredits((await walletSummary(db(), accountId)).available.toString());

  return (
    <div className="flex min-h-screen">
      <SessionWatcher />
      <Sidebar
        businessName={businessName}
        availableCredits={available}
        {...(company === undefined ? {} : { company })}
        onSignOut={<SignOutButton />}
      />
      <main className="min-w-0 flex-1 px-8 py-7">
        <div className="mx-auto w-full max-w-[1180px]">{children}</div>
      </main>
    </div>
  );
}
