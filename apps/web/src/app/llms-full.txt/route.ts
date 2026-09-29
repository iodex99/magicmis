import { db } from "@/lib/db";
import { llmsTxt } from "@/lib/llms";
import { welcomeOffer } from "@/lib/server/welcome";

/** https://llmstxt.org — the long form: every page, and the facts an answer can rely on. */
// Read per request because the price fact follows the live welcome offer (ADR 0068); the
// header below still lets every cache in front of it keep it for a day.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response(llmsTxt(true, await welcomeOffer(db())), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // An hour, not a day: the price fact follows the live offer, which can be switched off.
      "cache-control": "public, max-age=3600",
    },
  });
}
