/**
 * What the site says about welcome credits (ADR 0068), in one place.
 *
 * Every sentence is built from the live offer, so it cannot outlive it: the number is the
 * configured grant, "enough to set up your first company" is said only while the price book
 * makes it true, and with the offer switched off the product says plainly that it is paid.
 * "No card needed" is true by construction: signing up asks for four things and none is a card.
 */

import { formatCredits } from "./actions";

export interface WelcomeOfferCopy {
  readonly credits: bigint;
  readonly coversFirstCompany: boolean;
}

const n = (offer: WelcomeOfferCopy): string => formatCredits(offer.credits.toString());

/** "1,500 free credits", or null when the offer is off. */
export function welcomeCreditsLabel(offer: WelcomeOfferCopy): string | null {
  return offer.credits > 0n ? `${n(offer)} free credits` : null;
}

/** One line under a call to action, or null when the offer is off. */
export function welcomeLine(offer: WelcomeOfferCopy): string | null {
  if (offer.credits <= 0n) return null;
  return offer.coversFirstCompany
    ? `Start with ${n(offer)} free credits, enough to set up your first company on your own books. No card needed.`
    : `Start with ${n(offer)} free credits. No card needed.`;
}

/** A short band for a page that sells packs, or null when the offer is off. */
export function welcomeBand(offer: WelcomeOfferCopy): string | null {
  return offer.credits > 0n ? `${n(offer)} free credits to start. No card needed.` : null;
}

/** The answer to "Is there a free trial?". */
export function trialAnswer(offer: WelcomeOfferCopy): string {
  if (offer.credits <= 0n)
    return "No. Creating an account and adding a company cost nothing; anything that analyses your own data is paid from prepaid credits.";
  const enough = offer.coversFirstCompany
    ? ", enough to set up one company on your own books"
    : "";
  return `New accounts start with ${n(offer)} free credits${enough}. There is no card to enter and nothing to cancel: the credits are added when you first sign in, and every action shows its price before you press it. After that you buy credits in packs, and they never expire.`;
}
