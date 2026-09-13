import Link from "next/link";
import type { ReactNode } from "react";

import { PRODUCT_NAME } from "@/lib/brand";

import { SessionWatcher } from "./SessionWatcher";
import { SignOutButton } from "./SignOutButton";

export function AppFrame({
  businessName,
  children,
}: {
  businessName: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SessionWatcher />
      <header className="flex h-12 items-center justify-between border-b border-neutral-200 bg-white px-6">
        <nav aria-label="Main" className="flex items-center gap-6 text-sm">
          <Link href="/app" className="font-semibold text-neutral-900">
            {PRODUCT_NAME}
          </Link>
          <Link href="/app" className="text-neutral-700 hover:text-neutral-900">
            Companies
          </Link>
          <Link href="/wallet" className="text-neutral-700 hover:text-neutral-900">
            Wallet
          </Link>
          <Link
            href="/settings/security"
            className="text-neutral-700 hover:text-neutral-900"
          >
            Settings
          </Link>
        </nav>
        <div className="flex items-center gap-4 text-sm text-neutral-700">
          <span>{businessName}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
