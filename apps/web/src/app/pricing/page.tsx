import type { Metadata } from "next";

import { priceFor } from "@magicmis/wallet";

import { Icon } from "@/components/Icon";
import { Faqs } from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import { BreadcrumbSchema, FaqSchema, type Faq } from "@/components/StructuredData";
import { Badge, ButtonLink } from "@/components/ui";
import { formatCredits, formatMoney } from "@/lib/actions";
import { db } from "@/lib/db";
import { pageMetadata } from "@/lib/seo";
import { visitorCurrency } from "@/lib/server/visitor-currency";

export const metadata: Metadata = pageMetadata("/pricing");
// Read from the versioned pack prices on each request; never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Credit packs (ADR 0040, ADR 0041).
 *
 * What is sold for money is a pack of credits, so that is what this page prices: six tiers,
 * each a name, a price and a number of credits. The per-action price book is in the wallet.
 *
 * One currency per visitor, chosen by `visitorCurrency` — dollars for the world, rupees for a
 * visitor who will be billed in rupees — and no tax rate on the page: tax depends on who is
 * buying and is shown at checkout, before payment, where it is known. The payment provider
 * requires what is sold to be priced publicly in the buyer's currency, which is why this page
 * exists at all.
 */

interface PackRow {
  name: string | null;
  price_minor: string;
  credits_granted: string;
  bonus_credits: string;
}

const INCLUDED: readonly string[] = [
  "Every feature: workbook, dashboard, commentary and chat",
  "All three intelligence tiers",
  "As many companies as you need",
  "Credits never expire",
];

const FAQS: readonly Faq[] = [
  {
    question: "Do credits expire?",
    answer:
      "No. Credits stay on your account until you spend them. There is no validity period and nothing resets.",
  },
  {
    question: "Is there a subscription?",
    answer:
      "No. There is no subscription, no per-seat fee and no minimum. You buy a pack when you need credits. Each active company carries a small monthly fee in credits for keeping its mappings and history; beyond that, a month in which you run nothing costs nothing.",
  },
  {
    question: "What does a credit buy?",
    answer:
      "Each action — setting up a company, adding a month, a dashboard, written commentary, a chat question — has a standard price in credits, listed in your wallet once you have an account. Setting up a company costs the most because it is where the ledgers are mapped; every month after that reuses the mapping and costs a fraction of it.",
  },
  {
    question: "What if a job needs more than its standard price?",
    answer:
      "Then it stops and shows you a quote before anything runs. Unusually large or unusual books can take more work than the standard price covers; you decide whether to go ahead, and nothing is charged unless you accept.",
  },
  {
    question: "Can I get a refund?",
    answer:
      "Credits are non-refundable once bought, except where the law requires otherwise. If an action fails because of a fault on our side, its credits go back to your balance.",
  },
  {
    question: "Is there a free trial?",
    answer:
      "No. Creating an account and adding a company are free, and the sample workbook on this site shows exactly what the output looks like. Anything that analyses your own data is a paid action.",
  },
];

/** The tier most buyers should look at first: a company set up with room for its first years. */
const RECOMMENDED_INDEX = 2;

export default async function PricingPage() {
  const pool = db();
  const currency = await visitorCurrency();
  const [packs, setup, refresh, memory] = await Promise.all([
    pool.query<PackRow>(
      `select p.name, pp.price_minor_ex_tax::text as price_minor,
              p.credits_granted::text, p.bonus_credits::text
         from public.credit_packs p
         join public.credit_pack_prices pp on pp.pack_id = p.id and pp.currency = $1
        where p.active
        order by p.sort_order, pp.price_minor_ex_tax`,
      [currency],
    ),
    // What a pack is worth in the customer's terms, from the live price book rather than a
    // number typed here (SPEC §0.5): one company set up, then months of reporting.
    priceFor(pool, {
      actionKey: "company_setup",
      tier: "professional",
      delivery: "standard",
    }),
    priceFor(pool, {
      actionKey: "monthly_refresh",
      tier: "professional",
      delivery: "standard",
    }),
    priceFor(pool, {
      actionKey: "company_memory_monthly",
      tier: "professional",
      delivery: "standard",
    }),
  ]);
  const perMonth = refresh.credits + memory.credits;
  /** One company set up and reported on for twelve months. */
  const companyYear = setup.credits + 12n * perMonth;

  // A small pack is a company's first months; a large one is a firm's client list for a
  // year. "286 months" is true and useless, so past two years it is counted in companies.
  const worth = (total: bigint): string => {
    if (total <= setup.credits)
      return "Enough to set up one company and see what it produces.";
    const months = (total - setup.credits) / perMonth;
    if (months <= 24n)
      return `Roughly one company set up and ${months.toString()} ${
        months === 1n ? "month" : "months"
      } of reporting.`;
    return `Roughly ${(total / companyYear).toString()} companies set up and reported on for a year.`;
  };

  return (
    <PublicShell>
      <BreadcrumbSchema path="/pricing" />
      <FaqSchema faqs={FAQS} />

      <div className="canvas-grid">
        <div className="mx-auto w-full max-w-[1120px] px-6 pt-14 pb-16">
          <header className="mx-auto max-w-2xl text-center">
            <Badge tone="accent">Credit packs</Badge>
            <h1
              className="display rise mt-4 text-[2.5rem] leading-[1.08] font-semibold tracking-tight text-neutral-900"
              style={{ "--i": "0" } as React.CSSProperties}
            >
              Buy credits once. Spend them when you run something.
            </h1>
            <p
              className="rise mt-4 text-[1.0625rem] leading-relaxed text-neutral-600"
              style={{ "--i": "1" } as React.CSSProperties}
            >
              No subscription, no seats, no minimum. Pick a pack, and the credits are
              yours until you use them.
            </p>
          </header>

          <ul
            className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="pack-list"
          >
            {packs.rows.map((p, i) => {
              const total = BigInt(p.credits_granted) + BigInt(p.bonus_credits);
              const recommended = i === RECOMMENDED_INDEX;
              return (
                <li
                  key={p.credits_granted}
                  className={`lift rise relative flex flex-col rounded-2xl border bg-surface p-6 shadow-sm ${
                    recommended
                      ? "border-accent-400 ring-1 ring-accent-400"
                      : "border-line"
                  }`}
                  style={{ "--i": String(i + 2) } as React.CSSProperties}
                  data-testid="pack"
                >
                  {recommended ? (
                    <span className="absolute -top-3 left-6 rounded-full bg-accent-600 px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-white uppercase">
                      Recommended
                    </span>
                  ) : null}
                  <h2 className="display text-[1.125rem] font-semibold text-neutral-900">
                    {p.name ?? `${formatCredits(p.credits_granted)} credits`}
                  </h2>
                  <p className="mt-4 flex items-baseline gap-1.5">
                    <span className="display num text-left text-[2.25rem] leading-none font-semibold tracking-tight text-neutral-900">
                      {formatMoney(currency, p.price_minor).replace(/\.00$/u, "")}
                    </span>
                    <span className="text-[0.8125rem] text-neutral-500">one-time</span>
                  </p>
                  <p className="mt-4 text-[0.9375rem] text-neutral-700">
                    <span className="num font-semibold text-neutral-900">
                      {formatCredits(p.credits_granted)}
                    </span>{" "}
                    credits
                    {p.bonus_credits === "0" ? null : (
                      <span className="ml-2 rounded-full bg-positive-subtle px-2 py-0.5 text-[0.75rem] font-medium text-positive">
                        +{formatCredits(p.bonus_credits)} bonus
                      </span>
                    )}
                  </p>
                  <p className="mt-2 min-h-[2.5rem] text-[0.8125rem] leading-relaxed text-neutral-500">
                    {worth(total)}
                  </p>
                  <div className="mt-5 flex-1" />
                  <ButtonLink
                    href="/sign-up"
                    variant={recommended ? "primary" : "secondary"}
                    iconAfter="arrow-right"
                  >
                    Get started
                  </ButtonLink>
                </li>
              );
            })}
          </ul>

          <p className="mx-auto mt-6 max-w-2xl text-center text-[0.8125rem] leading-relaxed text-neutral-500">
            Estimates are at standard prices for one company; a job that needs more than
            its standard price shows you a quote first. Prices exclude tax, which is added
            at checkout where it applies.
          </p>

          <section className="mt-14 rounded-2xl border border-line bg-surface p-6 sm:p-8">
            <h2 className="display text-[1.25rem] font-semibold text-neutral-900">
              Every pack includes everything
            </h2>
            <ul className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {INCLUDED.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2.5 text-[0.9375rem] text-neutral-700"
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-700">
                    <Icon name="check" size={13} />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </section>

          <section className="mx-auto mt-14 max-w-[760px]">
            <h2 className="display text-[1.375rem] font-semibold tracking-tight text-neutral-900">
              Questions about credits
            </h2>
            <div className="mt-5">
              <Faqs faqs={FAQS} />
            </div>
          </section>
        </div>
      </div>
    </PublicShell>
  );
}
