import { llmsTxt } from "@/lib/llms";

/** https://llmstxt.org — the short form. Plain text, cached for a day like the share cards. */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(llmsTxt(false), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
