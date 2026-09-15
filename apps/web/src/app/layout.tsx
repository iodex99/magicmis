import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { PRODUCT_NAME } from "@/lib/brand";

import "./globals.css";

/**
 * SPEC §32 asks for a highly legible sans serif with tabular numerals. `next/font`
 * downloads Inter at build time and serves it from our own origin, so the CSP's
 * `font-src 'self'` holds (SPEC §30) and no request reaches a font CDN at runtime.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description:
    "Management information reports from your accounting data, for CA firms and SMEs.",
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
