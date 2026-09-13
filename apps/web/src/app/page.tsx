import Link from "next/link";

import { PRODUCT_NAME } from "@/lib/brand";

/**
 * Public home. The full marketing site (Product, Pricing, How it works, Security, Help as
 * distinct pages, SPEC §32) is built in a later phase; this page exists so the app has an
 * entry point and stays responsive on every device.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
        {PRODUCT_NAME}
      </h1>
      <p className="max-w-xl text-base text-neutral-700">
        Turn trial balances, ledgers and registers into a validated monthly MIS: an Excel
        workbook with live formulas, a dashboard, and management commentary.
      </p>
      <div className="flex gap-3">
        <Link
          href="/sign-up"
          className="inline-flex h-9 items-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
        >
          Create an account
        </Link>
        <Link
          href="/sign-in"
          className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
