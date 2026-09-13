import { PRODUCT_NAME } from "@magicmis/core/brand";
import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${PRODUCT_NAME} Admin`, template: `%s · ${PRODUCT_NAME} Admin` },
  robots: { index: false, follow: false },
};

/** Every page renders per request so Next.js can apply the CSP nonce (proxy.ts, SPEC §30). */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-neutral-50 antialiased">{children}</body>
    </html>
  );
}
