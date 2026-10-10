import "server-only";

import { priceFor } from "@magicmis/wallet";
import type { Pool } from "pg";

import { firstRunCredits } from "./welcome";

/**
 * What a credit pack is worth in the customer's own terms, from the live price book rather than
 * a number typed into a page (SPEC §0.5): a company set up, then months of reporting. Shared by
 * the public Credit packs page and the Wallet, so the two never describe one pack two ways.
 *
 * A small pack is a company's first months; a large one is a firm's client list for a year.
 * "286 months" is true and useless, so past two years it is counted in companies.
 *
 * Priced as a run is charged (ADR 0091): every run is instant (ADR 0050) and every completed run
 * also puts its figures on the dashboard as its own priced action — `dashboard_addon` the first
 * time, `dashboard_refresh` after (`bringDashboardUpToDate`, ADR 0047). Leaving the dashboard out
 * told a buyer a pack went a quarter further than it does, and disagreed with the welcome offer's
 * own first-run figure (`firstRunCredits`). The memory fee is a standard-price capture
 * (`lifecycle.ts`), and setup includes the first month of it.
 */
export async function packWorth(pool: Pool): Promise<(totalCredits: bigint) => string> {
  const instant = (actionKey: "monthly_refresh" | "dashboard_refresh") =>
    priceFor(pool, { actionKey, tier: "professional", delivery: "instant" });
  const [setup, refresh, board, memory] = await Promise.all([
    // Setting up a company and the dashboard that run delivers.
    firstRunCredits(pool),
    instant("monthly_refresh"),
    instant("dashboard_refresh"),
    priceFor(pool, {
      actionKey: "company_memory_monthly",
      tier: "professional",
      delivery: "standard",
    }),
  ]);
  const perMonth = refresh.credits + board.credits + memory.credits;
  /** One company set up and reported on for twelve months. */
  const companyYear = setup + 12n * perMonth;
  return (total) => {
    // A pack smaller than a setup is never described as one (ADR 0091).
    if (total < setup) {
      const months = total / perMonth;
      return months === 0n
        ? "A top-up for single actions and chat questions."
        : `Roughly ${months.toString()} ${
            months === 1n ? "month" : "months"
          } of reporting on a company already set up.`;
    }
    const months = (total - setup) / perMonth;
    if (months === 0n) return "Enough to set up one company and see what it produces.";
    if (months <= 24n)
      return `Roughly one company set up and ${months.toString()} ${
        months === 1n ? "month" : "months"
      } of reporting.`;
    return `Roughly ${(total / companyYear).toString()} companies set up and reported on for a year.`;
  };
}

export interface ListedPack {
  readonly packId: string;
  readonly name: string | null;
  readonly credits: string;
  readonly bonusCredits: string;
  /** Before tax, in the currency asked for. */
  readonly priceMinor: string;
}

/**
 * The active packs at their list price in one currency, before tax. What the Wallet shows an
 * account that has not yet said where to invoice it: tax and the final total depend on that, the
 * list price does not, and a customer should see what is for sale before filling in a form.
 */
export async function listedPacks(
  pool: Pool,
  currency: "INR" | "USD",
): Promise<ListedPack[]> {
  const r = await pool.query<{
    id: string;
    name: string | null;
    credits: string;
    bonus: string;
    price_minor: string;
  }>(
    `select p.id, p.name, p.credits_granted::text as credits, p.bonus_credits::text as bonus,
            pp.price_minor_ex_tax::text as price_minor
       from public.credit_packs p
       join public.credit_pack_prices pp on pp.pack_id = p.id and pp.currency = $1
      where p.active
      order by p.sort_order, pp.price_minor_ex_tax`,
    [currency],
  );
  return r.rows.map((p) => ({
    packId: p.id,
    name: p.name,
    credits: p.credits,
    bonusCredits: p.bonus,
    priceMinor: p.price_minor,
  }));
}
