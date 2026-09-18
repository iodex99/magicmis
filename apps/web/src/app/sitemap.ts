import type { MetadataRoute } from "next";

import { PUBLIC_PAGES, absoluteUrl } from "@/lib/seo";

/**
 * https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
 *
 * Generated from `PUBLIC_PAGES`, so a page cannot be added without appearing here and an
 * entry cannot outlive its page.
 *
 * `lastModified` is each page's own `updated` date (ADR 0038): a deploy that changes nothing
 * no longer claims every page changed, and a revised page is re-read because its date moved.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified: new Date(`${page.updated}T00:00:00Z`),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
