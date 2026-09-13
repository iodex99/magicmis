import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { PRODUCT_NAME } from "@/lib/brand";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description:
    "Management information reports from your accounting data, for CA firms and SMEs.",
};

/** Every page renders per request so Next.js can apply the CSP nonce (proxy.ts, SPEC §30). */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en-IN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
