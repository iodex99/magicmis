import Link from "next/link";
import type { ReactNode } from "react";

import { PRODUCT_NAME } from "@/lib/brand";

import { BrandMark } from "./ui";

/**
 * The shell for pages a signed-out visitor can reach (SPEC §32).
 *
 * These stay responsive down to a phone -- only the app itself is desktop-only -- so the
 * header collapses rather than hides, and no call to action is ever behind a menu.
 *
 * Exactly one link here is named "Create an account": the page's own primary call to
 * action. The header offers "Sign in" instead, so the two never compete.
 */
export function PublicShell({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-neutral-200/70 bg-neutral-50/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between gap-4 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark size={28} />
            <span className="text-[0.9375rem] font-semibold tracking-tight text-neutral-900">
              {PRODUCT_NAME}
            </span>
          </Link>
          <nav aria-label="Site" className="flex items-center gap-1 text-[0.8125rem]">
            <Link
              href="/pricing"
              className="rounded-md px-3 py-2 font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
            >
              Pricing
            </Link>
            <Link
              href="/legal/privacy"
              className="hidden rounded-md px-3 py-2 font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 sm:block"
            >
              Privacy
            </Link>
            <Link
              href="/sign-in"
              className="ml-1 inline-flex h-9 items-center rounded-md border border-neutral-200 bg-white px-3.5 font-medium text-neutral-800 shadow-sm hover:border-neutral-300"
            >
              Sign in
            </Link>
            {action}
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-neutral-200/70 bg-white">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-3 px-6 py-8 text-[0.8125rem] text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {PRODUCT_NAME}. Prices in INR, exclusive of GST.
          </p>
          <nav aria-label="Legal" className="flex gap-5">
            <Link href="/pricing" className="hover:text-neutral-900">
              Pricing
            </Link>
            <Link href="/legal/terms" className="hover:text-neutral-900">
              Terms
            </Link>
            <Link href="/legal/privacy" className="hover:text-neutral-900">
              Privacy notice
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
