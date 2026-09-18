import { PRODUCT_NAME } from "@magicmis/core/brand";
import type { Metadata } from "next";
import { cookies } from "next/headers";
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
  // The same cookie and the same palette as the customer app (ADR 0034, ADR 0035).
  const theme = (await cookies()).get("theme")?.value;
  const chosen = theme === "dark" || theme === "light" ? theme : undefined;
  return (
    <html
      lang="en-IN"
      className={inter.variable}
      {...(chosen === undefined ? {} : { "data-theme": chosen })}
    >
      <body className="min-h-screen bg-canvas antialiased">{children}</body>
    </html>
  );
}
