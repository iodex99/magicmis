import "server-only";

import { consumeRateLimit, type RateLimitName } from "@magicmis/db/ratelimit";

import { db } from "@/lib/db";

/** SPEC §30: null when the request may proceed, otherwise the 429 to return. */
export async function rateLimited(
  name: RateLimitName,
  subject: string,
): Promise<Response | null> {
  const decision = await consumeRateLimit(db(), name, subject);
  if (decision.allowed) return null;
  return Response.json(
    {
      error: "rate_limited",
      message: `Too many requests. Try again in ${String(decision.retryAfter)} seconds.`,
    },
    {
      status: 429,
      headers: {
        "retry-after": String(decision.retryAfter),
        "cache-control": "no-store",
      },
    },
  );
}
