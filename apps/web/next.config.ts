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
  // DuckDB-WASM and pdf.js load WebAssembly and worker modules from their own package
  // directories at runtime; server jobs use them (ADR 0032), so they stay unbundled too.
  serverExternalPackages: [
    "pg",
    "pdf-lib",
    "@aws-sdk/client-kms",
    "libpg-query",
    "@duckdb/duckdb-wasm",
    "pdfjs-dist",
    // SheetJS bundled as ESM loses Node zlib and inflates workbooks in pure JavaScript, about
    // five times slower on a 50 MB file (ADR 0032); unbundled it loads its Node build.
    "xlsx",
    "exceljs",
  ],
  // The downloadable sample MIS is gone (ADR 0051). Its page ranked and is linked from outside,
  // so the address moves for good to the page about the dashboard rather than ending in a 404.
  async redirects() {
    return [
      { source: "/mis-report-template", destination: "/mis-dashboard", permanent: true },
      { source: "/samples/:path*", destination: "/mis-dashboard", permanent: true },
    ];
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
