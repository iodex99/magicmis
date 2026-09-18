import "server-only";

import { headers } from "next/headers";

/**
 * Which price list a visitor who has not signed in is shown (ADR 0041).
 *
 * The product is positioned in dollars, so dollars are what everyone sees — except a visitor
 * in India, who will be billed in rupees (ADR 0030) and must not be quoted one currency and
 * charged another. Prices are set per currency and never converted, so the two lists are not
 * a rate apart and showing the wrong one is showing the wrong price. It is also the only
 * audience that ever sees a rupee sign: nobody abroad is told where the company is.
 *
 * `x-vercel-ip-country` is an ISO 3166-1 alpha-2 code that Vercel sets, and overwrites, on
 * every request (https://vercel.com/docs/headers/request-headers#x-vercel-ip-country).
 * Locally and anywhere else it is absent, which reads as "not India".
 */
export async function visitorCurrency(): Promise<"INR" | "USD"> {
  const country = (await headers()).get("x-vercel-ip-country");
  return country?.toUpperCase() === "IN" ? "INR" : "USD";
}
