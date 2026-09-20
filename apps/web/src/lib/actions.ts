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

/**
 * What choosing a tier actually changes, in the customer's terms (SPEC §2.10). Never model
 * names, never tokens: a tier reasons harder on unfamiliar ledgers and awkward questions, and
 * it never changes a figure, because figures come from the engine (locked decision 7).
 */
export const TIER_NOTES = {
  efficient: "Quick and cheapest. Good for familiar books and simple questions.",
  professional: "The default. Suits most books and most questions.",
  expert: "Reasons hardest on unusual ledgers and awkward questions. Costs more.",
} as const;

/** The tier in two words, where a sentence will not fit. */
export const TIER_TAGS = {
  efficient: "Quick, light",
  professional: "Balanced",
  expert: "Deepest",
} as const;

/** 1,234,567 — how most of the world groups digits. */
function groupWestern(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

/** 12,34,567 — lakhs and crores, for rupee amounts. */
function groupIndian(digits: string): string {
  return digits.length <= 3
    ? digits
    : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/gu, ",")},${digits.slice(-3)}`;
}

const signed = (value: string, group: (digits: string) => string): string =>
  value.startsWith("-") ? `-${group(value.slice(1))}` : group(value);

/**
 * A credit count held as a decimal string. Credits are the platform's own unit and the
 * platform is sold in dollars (ADR 0041), so they group the western way for everyone; only
 * rupee *money* groups in lakhs, in `formatMoney`.
 */
export function formatCredits(value: string): string {
  return signed(value, groupWestern);
}

/** Any whole count held as a decimal string: rows, sheets, files. */
export const formatCount = (value: string): string => formatCredits(value);

/**
 * Integer minor units as money in the billing currency (ADR 0030).
 *
 * Rupees group 12,34,567 and dollars 1,234,567. Mixing them is the kind of mistake a
 * reader spots instantly and mistrusts everything else for, so the grouping follows the
 * currency rather than the page.
 */
export function formatMoney(currency: "INR" | "USD", minor: string): string {
  const negative = minor.startsWith("-");
  const padded = (negative ? minor.slice(1) : minor).padStart(3, "0");
  const whole = padded.slice(0, -2);
  const fraction = padded.slice(-2);
  const grouped = currency === "INR" ? groupIndian(whole) : groupWestern(whole);
  const symbol = currency === "INR" ? "₹" : "$";
  return `${negative ? "-" : ""}${symbol}${grouped}.${fraction}`;
}

/** Paise (decimal string) as rupees: "236000" → "₹2,360.00". */
export const formatRupees = (paise: string): string => formatMoney("INR", paise);
