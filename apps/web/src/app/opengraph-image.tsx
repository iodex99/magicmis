import { ImageResponse } from "next/og";

import { MARK_END, MARK_PATH } from "@/components/Logo";

import { PRODUCT_NAME } from "@/lib/brand";

/**
 * The card a shared link shows
 * (https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image).
 *
 * 1200×630 is the size both OpenGraph and Twitter consumers crop to. Deliberately plain:
 * the mark, the name, and the one sentence that says what this is. A screenshot at this
 * size is unreadable in a chat client, and a stock illustration says nothing.
 *
 * No claim here is one the product cannot back, because a share card is quoted far more
 * often than it is checked.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${PRODUCT_NAME} — monthly MIS reports from your Tally exports`;

export default function OpengraphImage() {
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
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 64,
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#5846d2",
            borderRadius: 18,
          }}
        >
          <svg width={64} height={64} viewBox="0 0 64 64">
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
        <div style={{ fontSize: 34, fontWeight: 600, color: "#17171c" }}>
          {PRODUCT_NAME}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            fontSize: 68,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            color: "#17171c",
            maxWidth: 940,
          }}
        >
          The monthly MIS, built from the exports you already have.
        </div>
        <div style={{ fontSize: 30, color: "#5b5b68", maxWidth: 900 }}>
          Trial balances in. A validated Excel workbook, dashboard and commentary out —
          with every figure traceable to its ledger.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24 }}>
        <div style={{ width: 40, height: 4, background: "#5846d2", borderRadius: 2 }} />
        <div style={{ color: "#5b5b68" }}>For accountants and finance teams</div>
      </div>
    </div>,
    size,
  );
}
