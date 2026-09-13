import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages are consumed as TypeScript source (ADR 0001).
  transpilePackages: [
    "@magicmis/accounts",
    "@magicmis/billing",
    "@magicmis/core",
    "@magicmis/db",
    "@magicmis/ingest",
    "@magicmis/redact",
    "@magicmis/tally",
    "@magicmis/wallet",
    "@magicmis/ui",
  ],
  // pg loads optional native bindings dynamically; keep it out of the bundle.
  serverExternalPackages: ["pg", "pdf-lib"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
