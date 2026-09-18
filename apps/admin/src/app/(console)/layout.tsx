import { PRODUCT_NAME } from "@magicmis/core/brand";

import { ThemeToggle } from "@/components/ThemeToggle";
import Link from "next/link";
import type { ReactNode } from "react";

import { requireAdmin } from "@/server/session";

import { signOutAction } from "../login/actions";

/**
 * The console shell (ADR 0026): the same dark navigation rail as the customer app, so an
 * operator moving between the two is not moving between two products.
 */

const NAV: readonly (readonly [string, string])[] = [
  ["/", "Overview"],
  ["/accounts", "Accounts"],
  ["/bank-transfers", "Bank transfers"],
  ["/price-book", "Price book"],
  ["/packs", "Credit packs"],
  ["/exports", "Accounting exports"],
  ["/margin", "Margin"],
  ["/jobs", "Jobs"],
  ["/models", "Models and routing"],
  ["/prompts", "Prompts and evals"],
  ["/library", "Mapping library"],
  ["/config", "Config"],
  ["/audit", "Audit log"],
];

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="flex min-h-screen">
      <aside className="on-ink sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-ink-900 px-3 py-4">
        <p className="mb-6 flex items-center gap-2.5 px-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[28%] bg-accent-600">
            <svg width={18} height={18} viewBox="0 0 64 64" aria-hidden="true">
              <path
                d="M13 47 L23 19 L32 33 L42 13 L51 29"
                fill="none"
                stroke="#ffffff"
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={51} cy={29} r={5.5} fill="#ffffff" />
            </svg>
          </span>
          <span className="text-[0.9375rem] font-semibold tracking-tight text-white">
            {PRODUCT_NAME} Admin
          </span>
        </p>
        <nav aria-label="Admin" className="flex flex-col gap-0.5 overflow-y-auto">
          {NAV.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="rounded-lg px-3 py-2 text-[0.8125rem] font-medium text-neutral-300 transition-colors hover:bg-ink-700 hover:text-white"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-ink-700 pt-4">
          <div className="mb-2 flex items-center gap-2 px-1">
            <p className="min-w-0 flex-1 truncate text-[0.75rem] text-neutral-400">
              {admin.email}
            </p>
            <ThemeToggle />
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="w-full rounded-lg bg-ink-700 px-3 py-2 text-left text-[0.8125rem] font-medium text-neutral-200 transition-colors hover:bg-ink-600 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-7">
        <div className="mx-auto w-full max-w-[1180px]">{children}</div>
      </main>
    </div>
  );
}
