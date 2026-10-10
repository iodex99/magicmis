/**
 * What the site says about welcome credits (ADR 0068, ADR 0072), in one place.
 *
 * Every sentence is built from the live offer, so it cannot outlive it: the number is the
 * configured grant, "enough to set up your first company" is said only while the price book
 * makes it true, and with the offer switched off the product says plainly that it is paid.
 * "No card needed" is true by construction: signing up asks for four things and none is a card.
 *
 * A claim that something is free carries its conditions beside it, in the same type (CCPA
 * Guidelines for Prevention of Misleading Advertisements 2022, clauses 7(b) and 11(2)(b)): who it
 * is for, and what is paid after it — including the monthly memory fee, since describing a service
 * as free without saying continued use costs money is drip pricing (Dark Patterns Guidelines
 * 2023). "At its standard price" is there because a job that needs more than its standard price
 * shows a quote first, and the grant covers the standard one.
 */

import { formatCredits } from "./actions";

export interface WelcomeOfferCopy {
  readonly credits: bigint;
  readonly coversFirstCompany: boolean;
}

/** Where the offer's terms are, for a link beside every claim. */
export const WELCOME_TERMS_HREF = "/legal/terms#credits";

const n = (offer: WelcomeOfferCopy): string => formatCredits(offer.credits.toString());

/** "1,500 free credits", or null when the offer is off. */
export function welcomeCreditsLabel(offer: WelcomeOfferCopy): string | null {
  return offer.credits > 0n ? `${n(offer)} free credits` : null;
}

/** One line under a call to action, or null when the offer is off. */
export function welcomeLine(offer: WelcomeOfferCopy): string | null {
  if (offer.credits <= 0n) return null;
  return offer.coversFirstCompany
    ? `Start with ${n(offer)} free credits, enough to set up your first company at its standard price. No card needed.`
    : `Start with ${n(offer)} free credits. No card needed.`;
}

/** A short band for a page that sells packs, or null when the offer is off. */
export function welcomeBand(offer: WelcomeOfferCopy): string | null {
  return offer.credits > 0n ? `${n(offer)} free credits to start. No card needed.` : null;
}

/**
 * The conditions that go beside every claim, or null when the offer is off. Followed on the page
 * by a link to the offer's terms.
 */
export function welcomeConditions(offer: WelcomeOfferCopy): string | null {
  if (offer.credits <= 0n) return null;
  return "One welcome grant per person or business, not for throwaway email addresses. After that you buy credits in packs, and each company you keep has a monthly memory fee.";
}

/** The answer to "Is there a free trial?". */
export function trialAnswer(offer: WelcomeOfferCopy): string {
  if (offer.credits <= 0n)
    return "No. Creating an account and adding a company cost nothing; anything that analyses your own data is paid from prepaid credits.";
  const enough = offer.coversFirstCompany
    ? ", enough to set up one company on your own books at its standard price"
    : "";
  return `New accounts start with ${n(offer)} free credits${enough}: one grant per person or business, not for throwaway email addresses. There is no card to enter and nothing to cancel: the credits are added when you first sign in, and every action shows its price before you press it. After that you buy credits in packs, which never expire, and each company you keep has a monthly memory fee.`;
}

/**
 * What evaluating the product costs a practice, for the accountants' page: the offer with its
 * conditions, or plainly that it is paid when the offer is off. Followed on the page by a link to
 * the offer's terms (ADR 0091).
 */
export function welcomeEvaluation(offer: WelcomeOfferCopy): string {
  if (offer.credits <= 0n)
    return "There is no free tier or trial, so evaluating it means buying credits for a real month.";
  const enough = offer.coversFirstCompany
    ? ", enough to set up one client’s company on a real month of its books at its standard price"
    : "";
  return `Evaluating it costs nothing up front: a new account starts with ${n(offer)} free credits${enough} — one grant per person or business, not for throwaway email addresses, and after that you buy credits in packs and each company you keep has a monthly memory fee.`;
}

/**
 * The closing band on the credit packs page, or null when the offer is off (ADR 0091): a heading
 * and a body, so the claim and its conditions are written in one place.
 */
export function welcomePacksClosing(
  offer: WelcomeOfferCopy,
): { heading: string; body: string } | null {
  const label = welcomeCreditsLabel(offer);
  if (label === null) return null;
  return {
    heading: `Start with ${label}. Buy a pack when you want more.`,
    body: offer.coversFirstCompany
      ? "Your first company is set up on your own books at its standard price before you spend anything, and every action shows its price before you press it. One grant per person or business, not for throwaway email addresses; each company you keep has a monthly memory fee."
      : "Try it on your own books before you spend anything; every action shows its price before you press it. One grant per person or business, not for throwaway email addresses; each company you keep has a monthly memory fee.",
  };
}

/** A closing band's body, or null when the offer is off. */
export function welcomeClosing(offer: WelcomeOfferCopy): string | null {
  if (offer.credits <= 0n) return null;
  const enough = offer.coversFirstCompany
    ? ", enough to set up one company on your own books at its standard price"
    : "";
  return `Your first ${n(offer)} credits are on us${enough}. One grant per person or business; after that you buy credits when you need them, and each company you keep has a monthly memory fee.`;
}
