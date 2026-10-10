import Link from "next/link";

import { PRODUCT_NAME } from "@/lib/brand";

import { CopyThisLink } from "./CopyThisLink";

export const metadata = { title: "Desktop required" };

/**
 * What a link opened on a phone was for, said plainly (ADR 0091). Most people read email on a
 * phone, so the links that bring them here are the confirmation, the password reset and a shared
 * board — and each needs a different next step. The path is all this page is told; the link's
 * token stays in the address bar, where "Copy this link" picks it up for the reader.
 */
function reason(from: string): { title: string; body: string } {
  if (from.startsWith("/auth/callback"))
    return {
      title: "Open this link on your computer",
      body: "Your sign-up link has not been used: it still works. Open the email on the computer where you signed up, or copy the link and open it there, and it signs you straight in.",
    };
  if (from.startsWith("/reset-password"))
    return {
      title: "Open this link on your computer",
      body: "Your password reset link has not been used: it still works. Open it on a computer to choose your new password.",
    };
  if (from.startsWith("/s/"))
    return {
      title: "Someone shared a board with you",
      body: "It is drawn for a computer screen. Open this link on a computer to see it — it has not been used up by opening it here.",
    };
  return {
    title: "Please use a desktop computer",
    body: `${PRODUCT_NAME} works with large spreadsheets and dense financial tables, so it is available on desktop browsers only: the latest Chrome, Edge or Firefox.`,
  };
}

/** SPEC §2.13, §32: a clean "desktop required" page for non-desktop user agents. */
export default async function DesktopRequiredPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from = "" } = await searchParams;
  const { title, body } = reason(from);
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">{title}</h1>
        <p className="text-sm leading-relaxed text-neutral-700">{body}</p>
        <CopyThisLink />
        <Link
          href="/"
          className="text-sm font-medium text-accent-700 underline underline-offset-2"
        >
          Back to {PRODUCT_NAME}
        </Link>
      </div>
    </main>
  );
}
