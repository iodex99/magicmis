import { readConfig } from "@magicmis/db/config";
import { priceList } from "@magicmis/wallet";
import Link from "next/link";
import { z } from "zod";

import { ACTION_LABELS, formatCredits, formatRupees } from "@/lib/actions";
import { PRODUCT_NAME } from "@/lib/brand";
import { db } from "@/lib/db";

export const metadata = { title: "Pricing" };
// Read from the versioned price book on each request; never prerendered at build time.
export const dynamic = "force-dynamic";

/** Public pricing (SPEC §2.3: viewing the price book is never charged). */
export default async function PricingPage() {
  const pool = db();
  const [rows, gstRate, validityMonths, packs] = await Promise.all([
    priceList(pool),
    readConfig(pool, "billing.gst_rate_percent", z.string()),
    readConfig(pool, "wallet.lot_validity_months", z.number().int().positive()),
    pool.query<{
      price_paise_ex_gst: string;
      credits_granted: string;
      bonus_credits: string;
    }>(
      `select price_paise_ex_gst::text, credits_granted::text, bonus_credits::text
       from public.credit_packs where active order by sort_order, price_paise_ex_gst`,
    ),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="font-semibold text-neutral-900">
          {PRODUCT_NAME}
        </Link>
        <Link href="/sign-up" className="text-sm text-accent-700 underline">
          Create an account
        </Link>
      </header>

      <h1 className="mb-2 text-2xl font-semibold text-neutral-900">Pricing</h1>
      <p className="mb-8 max-w-2xl text-sm text-neutral-700">
        Prepaid credits. 1 credit = ₹1 before GST. Every action has a fixed price, shown
        and confirmed before anything is charged. Prices below are in credits.
      </p>

      <section className="mb-12 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm" data-testid="price-list">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-600">
            <tr>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 text-right font-medium">Efficient</th>
              <th className="px-4 py-2 text-right font-medium">Professional</th>
              <th className="px-4 py-2 text-right font-medium">Expert</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.actionKey} className="border-t border-neutral-100">
                <td className="px-4 py-2">
                  {ACTION_LABELS[r.actionKey]}
                  {r.instant ? (
                    <span className="block text-xs text-neutral-600">
                      Instant delivery: {formatCredits(r.instant.efficient.toString())} /{" "}
                      {formatCredits(r.instant.professional.toString())} /{" "}
                      {formatCredits(r.instant.expert.toString())}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {formatCredits(r.standard.efficient.toString())}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {formatCredits(r.standard.professional.toString())}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {formatCredits(r.standard.expert.toString())}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <h2 className="mb-4 text-lg font-semibold text-neutral-900">Credit packs</h2>
      <section className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-600">
            <tr>
              <th className="px-4 py-2 font-medium">Price (ex-GST)</th>
              <th className="px-4 py-2 text-right font-medium">Credits</th>
              <th className="px-4 py-2 text-right font-medium">Bonus credits</th>
            </tr>
          </thead>
          <tbody>
            {packs.rows.map((p) => (
              <tr key={p.price_paise_ex_gst} className="border-t border-neutral-100">
                <td className="px-4 py-2 font-mono tabular-nums">
                  {formatRupees(p.price_paise_ex_gst)}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {formatCredits(p.credits_granted)}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {formatCredits(p.bonus_credits)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="mt-4 text-xs text-neutral-600">
        GST at {gstRate}% is added at checkout. Credits expire {validityMonths} months
        after purchase and are non-refundable. There is no free tier or trial.
      </p>
    </main>
  );
}
