import type { Metadata } from "next";

import { pageMetadata } from "@/lib/seo";
import { readConfig } from "@magicmis/db/config";
import { z } from "zod";

import { PublicShell } from "@/components/PublicShell";
import { Badge, ButtonLink, DataTable, Panel, Td, Th, Tr } from "@/components/ui";
import { formatCredits, formatMoney } from "@/lib/actions";
import { db } from "@/lib/db";

export const metadata: Metadata = pageMetadata("/pricing");
// Read from the versioned pack prices on each request; never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * What it costs to buy in (ADR 0040).
 *
 * The per-action price book is no longer published here: a table of credits per action per
 * tier answered a question nobody had bought their way into yet, and read as complexity
 * rather than as the reassurance it was meant to be. It moved to the wallet, where it is
 * still free to read (SPEC §2.3) and where it is actually useful — beside a balance.
 *
 * What stays is what is actually sold for money: credit packs, priced in rupees for India
 * and dollars everywhere else. Razorpay requires the price of what you sell to be visible
 * and in INR before a merchant account is activated, so this page is not optional.
 */
export default async function PricingPage() {
  const pool = db();
  const [gstRate, packs] = await Promise.all([
    readConfig(pool, "billing.gst_rate_percent", z.string()),
    // Both currencies: a visitor abroad should see what they would actually pay rather
    // than a rupee figure to convert themselves.
    pool.query<{
      price_inr_minor: string | null;
      price_usd_minor: string | null;
      credits_granted: string;
      bonus_credits: string;
    }>(
      `select max(pp.price_minor_ex_tax) filter (where pp.currency = 'INR')::text as price_inr_minor,
              max(pp.price_minor_ex_tax) filter (where pp.currency = 'USD')::text as price_usd_minor,
              p.credits_granted::text, p.bonus_credits::text
         from public.credit_packs p
         left join public.credit_pack_prices pp on pp.pack_id = p.id
        where p.active
        group by p.id, p.sort_order, p.credits_granted, p.bonus_credits
        order by p.sort_order, price_inr_minor`,
    ),
  ]);

  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-[1120px] px-6 py-14">
        <header className="max-w-2xl">
          <Badge tone="accent">Prepaid credits</Badge>
          <h1 className="display mt-4 text-[2.25rem] leading-tight font-semibold tracking-tight text-neutral-900">
            Buy credits. Spend them when you run something.
          </h1>
          <p className="mt-4 text-[1.0625rem] leading-relaxed text-neutral-600">
            There is no subscription, no per-seat fee and no minimum. You buy credits up
            front, each action costs a fixed number of them, and nothing is charged in a
            month you do not run anything.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href="/sign-up" iconAfter="arrow-right">
              Create an account
            </ButtonLink>
          </div>
        </header>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "Credits never expire",
              body: "What you buy stays yours until you spend it. No validity period, no quiet reset at twelve months.",
            },
            {
              title: "A fixed price per action",
              body: "Each action costs the same every time, however hard it turned out to be. You see the number on the button before you press it.",
            },
            {
              title: "No free tier",
              body: "Creating an account, adding a company and reading this page are free. Analysis is not.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-neutral-200/80 bg-surface p-4 shadow-sm"
            >
              <h2 className="text-[0.875rem] font-semibold text-neutral-900">
                {item.title}
              </h2>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-neutral-600">
                {item.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <Panel
            title="Credit packs"
            description="Larger packs carry bonus credits. Oldest credits are spent first."
            icon="wallet"
            padding="none"
          >
            <DataTable
              testId="pack-list"
              className="px-2 pb-2"
              head={
                <>
                  <Th numeric>India (ex-GST)</Th>
                  <Th numeric>Rest of world</Th>
                  <Th numeric>Credits</Th>
                  <Th numeric>Bonus credits</Th>
                </>
              }
            >
              {packs.rows.map((p) => (
                <Tr key={p.credits_granted}>
                  <Td numeric className="font-semibold">
                    {p.price_inr_minor === null
                      ? "—"
                      : formatMoney("INR", p.price_inr_minor)}
                  </Td>
                  <Td numeric className="font-semibold">
                    {p.price_usd_minor === null
                      ? "—"
                      : formatMoney("USD", p.price_usd_minor)}
                  </Td>
                  <Td numeric>{formatCredits(p.credits_granted)}</Td>
                  <Td numeric>
                    {p.bonus_credits === "0" ? (
                      <span className="text-neutral-400">—</span>
                    ) : (
                      <span className="text-positive">
                        +{formatCredits(p.bonus_credits)}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </DataTable>
          </Panel>
        </div>

        <p className="mt-5 max-w-2xl text-[0.8125rem] leading-relaxed text-neutral-500">
          GST at {gstRate}% is added at checkout for customers in India; sales outside
          India are a zero-rated export of services. Credits are non-refundable once
          bought, and there is no free tier or trial. What each action costs is listed in
          your wallet, and shown on the button before you press it.
        </p>
      </div>
    </PublicShell>
  );
}
