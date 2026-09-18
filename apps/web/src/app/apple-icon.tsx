import { ImageResponse } from "next/og";

import { MARK_END, MARK_PATH } from "@/components/Logo";

/**
 * The home-screen icon
 * (https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons): the same
 * mark as the favicon at 180 px, drawn from the same path so it cannot drift (ADR 0037).
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#5846d2",
      }}
    >
      <svg width={150} height={150} viewBox="0 0 64 64">
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
    </div>,
    size,
  );
}
