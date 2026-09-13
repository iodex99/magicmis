import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PRODUCT_NAME } from "@/lib/brand";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description:
    "Management information reports from your accounting data, for CA firms and SMEs.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
