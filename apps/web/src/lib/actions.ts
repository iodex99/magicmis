/**
 * Customer-facing names for priced actions and tiers (SPEC §2.5, §2.10): tiers, never model
 * names; credits, never tokens or AI cost. Shared by server pages and client components.
 */

export const ACTION_LABELS = {
  data_diagnostic: "Data diagnostic",
  company_setup: "Company setup",
  reference_mis_recreate: "Recreate reference MIS",
  monthly_refresh: "Monthly refresh",
  refresh_with_restructure: "Refresh with restructure",
  dashboard_addon: "Dashboard",
  dashboard_refresh: "Dashboard refresh",
  commentary: "Commentary",
  chat_quick: "Chat — quick answer",
  chat_deep: "Chat — deep answer",
  chat_edit: "Chat — edit",
  company_memory_monthly: "Company memory (per company, per month)",
  company_restore: "Restore archived company",
  cancel_after_ai_fee: "Cancellation after analysis has started",
} as const;

export type ActionKeyLabel = keyof typeof ACTION_LABELS;

export const TIER_LABELS = {
  efficient: "Efficient",
  professional: "Professional",
  expert: "Expert",
} as const;

export const DELIVERY_LABELS = { standard: "Standard", instant: "Instant" } as const;

/** Indian grouping for a credit count held as a decimal string. */
export function formatCredits(value: string): string {
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const grouped =
    digits.length <= 3
      ? digits
      : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/gu, ",")},${digits.slice(-3)}`;
  return negative ? `-${grouped}` : grouped;
}

/** Paise (decimal string) as rupees with Indian grouping: "236000" → "₹2,360.00". */
export function formatRupees(paise: string): string {
  const padded = paise.padStart(3, "0");
  return `₹${formatCredits(padded.slice(0, -2))}.${padded.slice(-2)}`;
}
