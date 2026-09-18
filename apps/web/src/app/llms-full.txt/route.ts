import { llmsTxt } from "@/lib/llms";

/** https://llmstxt.org — the long form: every page, and the facts an answer can rely on. */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(llmsTxt(true), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
