import type { Metadata } from "next";

import { pageMetadata } from "@/lib/seo";
import { readConfig } from "@magicmis/db/config";
import { priceList } from "@magicmis/wallet";
import { z } from "zod";

import { PublicShell } from "@/components/PublicShell";
import { Badge, ButtonLink, DataTable, Panel, Td, Th, Tr } from "@/components/ui";
import { ACTION_LABELS, formatCredits, formatMoney } from "@/lib/actions";
import { db } from "@/lib/db";

export const metadata: Metadata = pageMetadata("/pricing");
// Read from the versioned price book on each request; never prerendered at build time.
export const dynamic = "force-dynamic";

/** Public pricing (SPEC §2.3: viewing the price book is never charged). */
export default async function PricingPage() {
  const pool = db();
  const [rows, gstRate, validityMonths, packs] = await Promise.all([
    priceList(pool),
    readConfig(pool, "billing.gst_rate_percent", z.string()),
    readConfig(pool, "wallet.lot_validity_months", z.number().int().positive()),
    // Both currencies: the price book is public, and a visitor abroad should see what
    // they would actually pay rather than a rupee figure to convert themselves.
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
          <h1 className="mt-4 text-[2.25rem] leading-tight font-semibold tracking-tight text-neutral-900">
            A fixed price per action, paid up front.
          </h1>
          <p className="mt-4 text-[1.0625rem] leading-relaxed text-neutral-600">
            Every action has a fixed price from a published price book, in US dollars or —
            for customers in India — rupees. Credits are charged only for what you run,
            and you are never billed by the minute or by how much work it took.
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
              title: "Three intelligence tiers",
              body: "Efficient, Professional and Expert. You pick the tier; we pick everything behind it.",
            },
            {
              title: "Nothing recurring but usage",
              body: `Each active company carries a monthly memory fee. Credits expire ${String(validityMonths)} months after purchase.`,
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
            title="Price book"
            description="Credits per action, by intelligence tier."
            icon="table"
            padding="none"
          >
            <DataTable
              testId="price-list"
              className="px-2 pb-2"
              head={
                <>
                  <Th>Action</Th>
                  <Th numeric>Efficient</Th>
                  <Th numeric>Professional</Th>
                  <Th numeric>Expert</Th>
                </>
              }
            >
              {rows.map((r) => (
                <Tr key={r.actionKey}>
                  <Td className="text-neutral-900">
                    <span className="font-medium">{ACTION_LABELS[r.actionKey]}</span>
                    {r.instant ? (
                      <span className="mt-0.5 block text-[0.75rem] text-neutral-500">
                        Instant delivery: {formatCredits(r.instant.efficient.toString())}{" "}
                        / {formatCredits(r.instant.professional.toString())} /{" "}
                        {formatCredits(r.instant.expert.toString())}
                      </span>
                    ) : null}
                  </Td>
                  <Td numeric>{formatCredits(r.standard.efficient.toString())}</Td>
                  <Td numeric>{formatCredits(r.standard.professional.toString())}</Td>
                  <Td numeric>{formatCredits(r.standard.expert.toString())}</Td>
                </Tr>
              ))}
            </DataTable>
          </Panel>
        </div>

        <div className="mt-6">
          <Panel
            title="Credit packs"
            description="Larger packs carry bonus credits. Oldest credits are spent first."
            icon="wallet"
            padding="none"
          >
            <DataTable
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

        <p className="mt-5 text-[0.8125rem] text-neutral-500">
          GST at {gstRate}% is added at checkout. Credits expire {validityMonths} months
          after purchase and are non-refundable. There is no free tier or trial.
        </p>
      </div>
    </PublicShell>
  );
}
