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
        areaServed: { "@type": "Country", name: "India" },
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
        inLanguage: "en-IN",
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
  const page = publicPage(path);
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: PRODUCT_NAME,
            item: absoluteUrl("/"),
          },
          {
            "@type": "ListItem",
            position: 2,
            name: page.title,
            item: absoluteUrl(path),
          },
        ],
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
        inLanguage: "en-IN",
        mainEntityOfPage: absoluteUrl(path),
        publisher: { "@id": `${absoluteUrl("/")}#organization` },
      }}
    />
  );
}
