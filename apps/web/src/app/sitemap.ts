import type { MetadataRoute } from "next";

import { PUBLIC_PAGES, absoluteUrl } from "@/lib/seo";

/**
 * https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
 *
 * Generated from `PUBLIC_PAGES`, so a page cannot be added without appearing here and an
 * entry cannot outlive its page.
 *
 * `lastModified` is the build time. A date that moves on every deploy would be a lie about
 * the content, but a fixed one is worse — it tells a crawler nothing has changed since the
 * day the constant was written, which is how a revised page stops being re-read.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_PAGES.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
