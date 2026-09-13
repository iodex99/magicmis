import { PRODUCT_NAME } from "@magicmis/core/brand";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${PRODUCT_NAME} Admin`, template: `%s · ${PRODUCT_NAME} Admin` },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-neutral-50 antialiased">{children}</body>
    </html>
  );
}
