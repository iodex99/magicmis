import { createHash } from "node:crypto";

import { consumeRateLimit } from "@magicmis/db/ratelimit";
import { openShare } from "@magicmis/jobs";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { keyWrapper } from "@/lib/server/runtime";
import { sharedBoardSchema, type SharedBoard } from "@/lib/server/shares";

import { SharedWorkspace } from "./SharedWorkspace";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Shared board",
  // Never indexed and never followed: a link is for the person it was sent to (ADR 0090).
  robots: { index: false, follow: false },
};

/**
 * A board shared by its owner (ADR 0090): read-only, frozen when the link was made, open to
 * whoever holds the link until it expires or is withdrawn. No account is needed and none is
 * asked for. Opening it is recorded before the board is decrypted; a link that is wrong, expired
 * or withdrawn shows the same page as one that never existed, so a guess learns nothing.
 */
export default async function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) notFound();
  // Each opening unwraps the company's key and writes a row: one link is not opened in a loop.
  const limit = await consumeRateLimit(
    db(),
    "share_per_link",
    createHash("sha256").update(token).digest("hex"),
  );
  if (!limit.allowed)
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-12">
        <p
          className="max-w-sm text-center text-sm text-neutral-700"
          data-testid="share-busy"
        >
          This board has been opened many times in the last few minutes. Try again in{" "}
          {limit.retryAfter.toString()} seconds.
        </p>
      </main>
    );
  const opened = await openShare(db(), keyWrapper(), token);
  if (opened === null) notFound();
  const board = sharedBoardSchema.safeParse(opened.board);
  if (!board.success) notFound();
  return (
    <SharedWorkspace
      board={board.data as unknown as SharedBoard}
      expiresAt={opened.expiresAt.toISOString()}
    />
  );
}
