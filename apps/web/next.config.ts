import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages are consumed as TypeScript source (ADR 0001).
  transpilePackages: [
    "@magicmis/ai",
    "@magicmis/chat",
    "@magicmis/sql-guard",
    "@magicmis/render-dashboard",
    "@magicmis/crypto",
    "@magicmis/engine",
    "@magicmis/jobs",
    "@magicmis/pipeline",
    "@magicmis/render-excel",
    "@magicmis/templates",
    "@magicmis/accounts",
    "@magicmis/billing",
    "@magicmis/core",
    "@magicmis/db",
    "@magicmis/ingest",
    "@magicmis/redact",
    "@magicmis/semantic",
    "@magicmis/tally",
    "@magicmis/wallet",
    "@magicmis/ui",
  ],
  // pg loads optional native bindings dynamically; keep it out of the bundle.
  // libpg-query loads its WebAssembly relative to its own file, which bundling would move (ADR 0023).
  serverExternalPackages: ["pg", "pdf-lib", "@aws-sdk/client-kms", "libpg-query"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
