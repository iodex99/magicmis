import { PRODUCT_NAME } from "@/lib/brand";
import { absoluteUrl, cspNonce, publicPage } from "@/lib/seo";

/**
 * Schema.org structured data (https://schema.org, consumed per
 * https://developers.google.com/search/docs/appearance/structured-data/search-gallery).
 *
 * Rendered as JSON through `JSON.stringify`, never string concatenation: the values include
 * copy with apostrophes and rupee signs, and hand-built JSON in a script tag is how an
 * escaping bug becomes an injection. The nonce is required because the policy carries no
 * `unsafe-inline` (SPEC §30).
 *
 * Everything asserted here has to be true. Structured data that overstates — a rating
 * nobody gave, a price that is not the price — is a manual-action risk and, more to the
 * point, a lie in a machine-readable format.
 */
async function Json({ data }: { data: Record<string, unknown> }) {
  const nonce = await cspNonce();
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // The content is ours and JSON-encoded; `<` is escaped so it cannot close the tag.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</gu, "\\u003c"),
      }}
    />
  );
}

/** Identity of the publisher, referenced by the other blocks. */
export function OrganizationSchema() {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": `${absoluteUrl("/")}#organization`,
        name: PRODUCT_NAME,
        url: absoluteUrl("/"),
        description: publicPage("/").description,
        // Sold worldwide (ADR 0030): the markets the pages are written for, by name.
        areaServed: [
          "India",
          "United Kingdom",
          "Ireland",
          "United States",
          "Canada",
          "Australia",
          "New Zealand",
          "South Africa",
          "Singapore",
          "United Arab Emirates",
        ].map((name) => ({ "@type": "Country", name })),
        knowsAbout: [
          "MIS reports",
          "management accounts",
          "monthly financial reporting",
          "board packs",
          "month-end reporting packages",
        ],
      }}
    />
  );
}

/**
 * The product itself.
 *
 * No `aggregateRating`: there are no ratings. No `offers` price either — prices live in the
 * admin-editable price book (§0.5) and a number frozen into a schema block would be the one
 * place it could not be changed.
 */
export function SoftwareApplicationSchema() {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: PRODUCT_NAME,
        url: absoluteUrl("/"),
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Accounting and management reporting",
        operatingSystem: "Web browser (desktop)",
        description: publicPage("/").description,
        inLanguage: ["en-IN", "en-GB", "en-US"],
        featureList: [
          "Trial balance to monthly MIS, management accounts or reporting package",
          "Excel workbook with live formulas and lineage on every cell",
          "Dashboard with KPIs, charts and drill-down to source",
          "Written commentary with every figure computed, never generated",
          "Validation checks against the trial balance before delivery",
          "Works from exports of any accounting system — no connector",
        ],
        publisher: { "@id": `${absoluteUrl("/")}#organization` },
      }}
    />
  );
}

export interface Faq {
  readonly question: string;
  readonly answer: string;
}

/** Only for questions actually shown on the page — the two must match. */
export function FaqSchema({ faqs }: { faqs: readonly Faq[] }) {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: { "@type": "Answer", text: f.answer },
        })),
      }}
    />
  );
}

/** The trail a search result shows instead of a bare URL. */
export function BreadcrumbSchema({ path }: { path: string }) {
  const trail: [string, string][] = [[PRODUCT_NAME, "/"]];
  // A guide under /guides/ sits one level down, and the trail says so.
  if (path.startsWith("/guides/")) trail.push(["Guides", "/guides"]);
  trail.push([publicPage(path).title, path]);
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: trail.map(([name, href], i) => ({
          "@type": "ListItem",
          position: i + 1,
          name,
          item: absoluteUrl(href),
        })),
      }}
    />
  );
}

/** An explanatory page, which is what the keyword-led guides are. */
export function ArticleSchema({ path }: { path: string }) {
  const page = publicPage(path);
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "Article",
        headline: page.title,
        description: page.description,
        inLanguage: page.locale.replace("_", "-"),
        dateModified: page.updated,
        mainEntityOfPage: absoluteUrl(path),
        publisher: { "@id": `${absoluteUrl("/")}#organization` },
      }}
    />
  );
}
