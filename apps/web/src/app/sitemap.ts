import type { MetadataRoute } from "next";

import { PRODUCT_NAME } from "@/lib/brand";
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
/** The pages the product tour plays on (ADR 0041), for the video sitemap extension. */
const TOUR_PAGES: readonly string[] = ["/", "/how-it-works"];

const TOUR = {
  title: `${PRODUCT_NAME} — the tour`,
  thumbnail_loc: absoluteUrl("/brand/tour-poster.png"),
  description:
    "A silent, forty-second tour: raw data in, ledgers mapped, a checked workbook and dashboard out, a chat that answers from the figures and builds the dashboard, and Present for the boardroom. Figures shown are fictional.",
  content_loc: absoluteUrl("/brand/tour.webm"),
  duration: 39,
  family_friendly: "yes" as const,
};

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified: new Date(`${page.updated}T00:00:00Z`),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
    ...(TOUR_PAGES.includes(page.path) ? { videos: [TOUR] } : {}),
  }));
}
