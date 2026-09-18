import Link from "next/link";
import type { ReactNode } from "react";

import { PRODUCT_NAME } from "@/lib/brand";

import { Logo } from "./Logo";

/**
 * The shell for pages a signed-out visitor can reach (SPEC §32).
 *
 * These stay responsive down to a phone -- only the app itself is desktop-only -- so the
 * header collapses rather than hides, and no call to action is ever behind a menu.
 *
 * Exactly one link here is named "Create an account": the page's own primary call to
 * action. The header offers "Sign in" instead, so the two never compete.
 */
const FOOTER_GROUPS: readonly {
  heading: string;
  links: readonly (readonly [string, string])[];
}[] = [
  {
    heading: "Product",
    links: [
      ["/product", "What you get"],
      ["/how-it-works", "How it works"],
      ["/security", "Security"],
      ["/pricing", "Credit packs"],
    ],
  },
  {
    heading: "Solutions",
    links: [
      ["/ai-mis-report", "MIS with AI"],
      ["/chat-with-your-mis", "Chat with your MIS"],
      ["/boardroom-ready-mis", "Boardroom-ready MIS"],
      ["/ai-variance-analysis", "AI variance analysis"],
      ["/ai-management-accounts", "AI management accounts"],
      ["/ai-financial-reporting", "AI financial reporting"],
      ["/mis-dashboard", "MIS dashboard"],
      ["/mis-in-minutes", "MIS in minutes"],
      ["/automated-management-accounts", "Automated management accounts"],
      ["/monthly-financial-reporting", "Monthly financial reporting"],
      ["/for-accountants", "For accountants"],
      ["/board-pack", "Board packs"],
      ["/month-end-reporting-package", "Month-end reporting package"],
      ["/management-reporting-software", "Management reporting software"],
    ],
  },
  {
    heading: "Guides",
    links: [
      ["/what-is-an-mis-report", "What is an MIS report?"],
      ["/mis-report-format", "MIS report format"],
      ["/mis-report-template", "Sample MIS to download"],
      ["/management-accounts", "Management accounts"],
      ["/guides/mis-kpis-and-ratios", "KPIs and ratios"],
      ["/guides/debtors-ageing-report", "Debtors ageing"],
      ["/guides/mis-commentary", "Writing commentary"],
      ["/guides", "All guides"],
    ],
  },
  {
    heading: "Legal",
    links: [
      ["/legal/terms", "Terms of service"],
      ["/legal/privacy", "Privacy notice"],
    ],
  },
];

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
          <Link href="/" className="flex items-center" aria-label={PRODUCT_NAME}>
            <Logo size={28} animate />
          </Link>
          <nav aria-label="Site" className="flex items-center gap-1 text-[0.8125rem]">
            {/* The three a visitor evaluating the product needs, in the order they ask:
                what is it, how does it work, what does it cost. The guides are reached
                from the home page and from each other, not crowded in here. */}
            {[
              ["/product", "Product"],
              ["/how-it-works", "How it works"],
              ["/security", "Security"],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href ?? "/"}
                className="hidden rounded-md px-3 py-2 font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 md:block"
              >
                {label}
              </Link>
            ))}
            <Link
              href="/pricing"
              className="hidden rounded-md px-3 py-2 font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 sm:block"
            >
              Credit packs
            </Link>
            <Link
              href="/sign-in"
              className="ml-1 inline-flex h-9 items-center rounded-md border border-neutral-200 bg-surface px-3.5 font-medium text-neutral-800 shadow-sm hover:border-neutral-300"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="press ml-1 inline-flex h-9 items-center rounded-md bg-accent-600 px-3.5 font-medium text-white shadow-sm hover:bg-accent-700"
            >
              Get started
            </Link>
            {action}
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {/* A real footer, not a copyright line: it is how a reader who arrived on one guide
          from search finds the rest of the site, and how a crawler reaches every page from
          every page. */}
      <footer className="border-t border-neutral-200/70 bg-surface">
        <div className="mx-auto w-full max-w-[1120px] px-6 py-12">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <Link href="/" className="flex items-center" aria-label={PRODUCT_NAME}>
                <Logo size={26} />
              </Link>
              <p className="mt-3 text-[0.8125rem] leading-relaxed text-neutral-500">
                Monthly management reports from your accounting data, for accountants and
                finance teams.
              </p>
            </div>
            {FOOTER_GROUPS.map((group) => (
              <nav key={group.heading} aria-label={group.heading}>
                <h2 className="text-[0.75rem] font-medium tracking-wide text-neutral-500 uppercase">
                  {group.heading}
                </h2>
                <ul className="mt-3 flex flex-col gap-2 text-[0.8125rem]">
                  {group.links.map(([href, label]) => (
                    <li key={href}>
                      <Link
                        href={href}
                        className="text-neutral-600 hover:text-neutral-900"
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
          <p className="mt-10 border-t border-neutral-200/70 pt-6 text-[0.8125rem] text-neutral-500">
            © {new Date().getFullYear()} {PRODUCT_NAME}. Prepaid credits. No subscription.
          </p>
        </div>
      </footer>
    </div>
  );
}
