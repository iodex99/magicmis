import { ImageResponse } from "next/og";

import { MARK_END, MARK_PATH } from "@/components/Logo";
import { PRODUCT_NAME } from "@/lib/brand";
import { GUIDE_PATHS, PUBLIC_PAGES, SOLUTION_PATHS } from "@/lib/seo";

/**
 * GET /og?path=/some-page — the share card for one public page (ADR 0038).
 *
 * The site-wide card (`opengraph-image.tsx`) says what the product is; a page shared into a
 * chat is opened for what the *page* says, so its card carries the page's own title. The path
 * is validated against `PUBLIC_PAGES` — an unknown one gets the home card rather than an
 * error, and nothing from the query string is ever drawn.
 */
// Read per request: the path is a query parameter, and a static route would freeze every
// card to the home page's. The CDN caches the response for a day instead.
export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 630 };

export function GET(request: Request): ImageResponse {
  const wanted = new URL(request.url).searchParams.get("path") ?? "/";
  const page = PUBLIC_PAGES.find((p) => p.path === wanted) ?? PUBLIC_PAGES[0];
  const [title = PRODUCT_NAME, tail] = (page?.title ?? PRODUCT_NAME).split(/:\s/u, 2);
  // The section the page belongs to, so the card says what kind of page it is.
  const eyebrow = GUIDE_PATHS.includes(wanted)
    ? "Guide"
    : SOLUTION_PATHS.includes(wanted) || wanted === "/"
      ? "Monthly management reporting"
      : "Product";
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#fbfbfd",
        padding: 72,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          style={{
            width: 56,
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#5846d2",
            borderRadius: 16,
          }}
        >
          <svg width={56} height={56} viewBox="0 0 64 64">
            <path
              d={MARK_PATH}
              fill="none"
              stroke="#ffffff"
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx={MARK_END.x} cy={MARK_END.y} r={5.5} fill="#ffffff" />
            <circle cx={MARK_END.x} cy={MARK_END.y} r={2.4} fill="#5846d2" />
          </svg>
        </div>
        <div style={{ fontSize: 30, fontWeight: 600, color: "#191824" }}>
          {PRODUCT_NAME}
        </div>
        <div
          style={{ fontSize: 22, color: "#6f6c85", marginLeft: 8 }}
        >{`· ${eyebrow}`}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div
          style={{
            fontSize: title.length > 48 ? 56 : 64,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            color: "#191824",
            maxWidth: 1000,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 28, color: "#6f6c85", maxWidth: 960, lineHeight: 1.35 }}>
          {tail ?? page?.description ?? ""}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 22 }}>
        <div style={{ width: 40, height: 4, background: "#5846d2", borderRadius: 2 }} />
        <div style={{ color: "#6f6c85" }}>
          Trial balance in · checked workbook, dashboard and commentary out
        </div>
      </div>
    </div>,
    {
      ...SIZE,
      headers: { "cache-control": "public, max-age=86400, s-maxage=86400" },
    },
  );
}
