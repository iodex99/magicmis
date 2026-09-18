import type { MetadataRoute } from "next";

import { absoluteUrl, siteOrigin } from "@/lib/seo";

/**
 * https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt
 *
 * Everything behind sign-in is disallowed. None of it is reachable without a session, so
 * this is not a security control — it is to keep a signed-in surface out of search results,
 * where an indexed `/app` URL becomes a stream of visitors landing on a sign-in redirect.
 *
 * `robots.txt` cannot be served from a path-less origin, so when `NEXT_PUBLIC_APP_URL` is
 * unset (a preview build, a test) the sitemap line is omitted rather than pointing at
 * `/sitemap.xml` on the wrong host.
 */
/** Behind sign-in, or machinery: nothing here belongs in an index or an answer. */
const PRIVATE: string[] = [
  "/app",
  "/api",
  "/wallet",
  "/settings",
  "/sign-in",
  "/sign-up",
  "/auth",
  "/signed-out",
  "/forgot-password",
  "/reset-password",
  "/desktop-required",
  "/og",
];

/**
 * The crawlers behind AI search and assistants, named so the welcome is explicit (ADR 0042).
 * People now ask an assistant which tool to use; being readable by the thing that answers is
 * the same bet as being readable by Google. A named group replaces the `*` group for that
 * agent rather than adding to it, so the private list is repeated, not inherited.
 *
 * Names as each operator documents them: OpenAI (GPTBot, OAI-SearchBot, ChatGPT-User),
 * Anthropic (ClaudeBot, Claude-SearchBot, Claude-User), Perplexity (PerplexityBot,
 * Perplexity-User), Google-Extended, Applebot-Extended, and Common Crawl's CCBot.
 */
const AI_AGENTS: string[] = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      { userAgent: AI_AGENTS, allow: "/", disallow: PRIVATE },
    ],
    ...(origin === "" ? {} : { sitemap: absoluteUrl("/sitemap.xml") }),
  };
}
