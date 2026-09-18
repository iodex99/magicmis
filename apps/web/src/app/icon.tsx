import { ImageResponse } from "next/og";

import { MARK_END, MARK_PATH } from "@/components/Logo";

/**
 * The favicon, drawn rather than shipped as a binary
 * (https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons).
 *
 * The same mark as `LogoMark` (ADR 0037), from the same path constant, so a pinned tab and the
 * header cannot disagree. At 32 px the ring is drawn a touch larger than in the full mark so it
 * still reads as a point.
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
      <svg width={32} height={32} viewBox="0 0 64 64">
        <path
          d={MARK_PATH}
          fill="none"
          stroke="#ffffff"
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={MARK_END.x} cy={MARK_END.y} r={6.5} fill="#ffffff" />
        <circle cx={MARK_END.x} cy={MARK_END.y} r={2.8} fill="#5846d2" />
      </svg>
    </div>,
    size,
  );
}
