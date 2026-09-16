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
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/app",
          "/api",
          "/wallet",
          "/settings",
          "/sign-in",
          "/sign-up",
          "/auth",
          "/signed-out",
          "/desktop-required",
        ],
      },
    ],
    ...(origin === "" ? {} : { sitemap: absoluteUrl("/sitemap.xml") }),
  };
}
