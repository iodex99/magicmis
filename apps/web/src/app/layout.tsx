import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { PRODUCT_NAME } from "@/lib/brand";
import { publicPage, siteOrigin } from "@/lib/seo";

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

/**
 * Site-wide metadata. Individual public pages override title, description and canonical
 * through `pageMetadata` (lib/seo.ts); everything here is the floor beneath them.
 *
 * `metadataBase` is what makes relative OpenGraph image paths resolve to absolute URLs —
 * without it Next.js emits a relative `og:image` that no crawler can fetch. It is only set
 * when the origin is actually configured, so a build without it fails loudly at the one
 * place it matters rather than silently shipping half-formed cards.
 */
const origin = siteOrigin();

export const metadata: Metadata = {
  ...(origin === "" ? {} : { metadataBase: new URL(origin) }),
  title: { default: publicPage("/").title, template: `%s · ${PRODUCT_NAME}` },
  description: publicPage("/").description,
  applicationName: PRODUCT_NAME,
  // The app is behind a sign-in and desktop-only; the marketing pages opt themselves in.
  robots: { index: true, follow: true },
  formatDetection: { telephone: false, address: false, email: false },
  openGraph: {
    type: "website",
    siteName: PRODUCT_NAME,
    locale: "en_IN",
    title: publicPage("/").title,
    description: publicPage("/").description,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#5846d2",
  width: "device-width",
  initialScale: 1,
};

/**
 * Every page renders per request so Next.js can apply the CSP nonce (proxy.ts, SPEC §30).
 *
 * The theme is read from a cookie here rather than set by a script after paint, so a reader who
 * has chosen dark never sees a white flash on the way in (ADR 0034). With no cookie the attribute
 * is absent and the stylesheet follows the operating system.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
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
