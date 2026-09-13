import { PRODUCT_NAME } from "@magicmis/core/brand";
import Link from "next/link";
import type { ReactNode } from "react";

import { requireAdmin } from "@/server/session";

import { signOutAction } from "../login/actions";

const NAV: [string, string][] = [
  ["/", "Overview"],
  ["/accounts", "Accounts"],
  ["/bank-transfers", "Bank transfers"],
  ["/price-book", "Price book"],
  ["/packs", "Credit packs"],
  ["/exports", "Accounting exports"],
  ["/margin", "Margin"],
  ["/audit", "Audit log"],
];

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white px-4 py-6">
        <p className="mb-6 text-sm font-semibold text-neutral-900">
          {PRODUCT_NAME} Admin
        </p>
        <nav aria-label="Admin" className="flex flex-col gap-1 text-sm">
          {NAV.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="rounded px-2 py-1 text-neutral-700 hover:bg-neutral-100"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-8 border-t border-neutral-200 pt-4 text-xs text-neutral-600">
          <p className="mb-2 truncate">{admin.email}</p>
          <form action={signOutAction}>
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
