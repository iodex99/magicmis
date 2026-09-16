import { ImageResponse } from "next/og";

/**
 * The favicon, drawn rather than shipped as a binary
 * (https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons).
 *
 * The same ledger-column mark as `BrandMark`, so a pinned tab and the header agree. Keeping
 * it as code means the accent colour has exactly one definition to change, which matters
 * while the brand itself is still a placeholder (R-01).
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#5846d2",
        borderRadius: 9,
      }}
    >
      <svg
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth={2.6}
        strokeLinecap="round"
      >
        <path d="M7 16.5V11m5 5.5V6m5 10.5v-3.5M4.5 20.5h15" />
      </svg>
    </div>,
    size,
  );
}
