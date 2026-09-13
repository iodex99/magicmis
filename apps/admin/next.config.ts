import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages are consumed as TypeScript source (ADR 0001).
  transpilePackages: [
    "@magicmis/ai",
    "@magicmis/billing",
    "@magicmis/core",
    "@magicmis/crypto",
    "@magicmis/db",
    "@magicmis/engine",
    "@magicmis/jobs",
    "@magicmis/semantic",
    "@magicmis/render-dashboard",
    "@magicmis/templates",
    "@magicmis/pipeline",
    "@magicmis/ingest",
    "@magicmis/redact",
    "@magicmis/tally",
    "@magicmis/render-excel",
    "@magicmis/wallet",
  ],
  serverExternalPackages: ["pg", "pdf-lib", "@aws-sdk/client-kms"],
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-frame-options", value: "DENY" },
          { key: "referrer-policy", value: "no-referrer" },
          { key: "x-content-type-options", value: "nosniff" },
          { key: "cache-control", value: "private, no-store" },
          { key: "x-robots-tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default config;
