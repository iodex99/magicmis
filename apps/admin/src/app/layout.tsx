import { PRODUCT_NAME } from "@magicmis/core/brand";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";

import "./globals.css";

/** Self-hosted by `next/font`, so the CSP's `font-src 'self'` holds (SPEC §30). */
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: `${PRODUCT_NAME} Admin`, template: `%s · ${PRODUCT_NAME} Admin` },
  robots: { index: false, follow: false },
};

/** Every page renders per request so Next.js can apply the CSP nonce (proxy.ts, SPEC §30). */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en-IN" className={inter.variable}>
      <body className="min-h-screen bg-neutral-50 antialiased">{children}</body>
    </html>
  );
}
