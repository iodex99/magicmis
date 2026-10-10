"use client";

import { companyFormat } from "@magicmis/render-dashboard";
import { useState } from "react";

import { Icon, type IconName } from "@/components/Icon";
import { PRODUCT_NAME } from "@/lib/brand";
import type { SharedBoard } from "@/lib/server/shares";

import { BoardActionsView } from "../../app/companies/[id]/BoardActionsView";
import { CommentaryView } from "../../app/companies/[id]/CommentaryView";
import { DashboardClient } from "../../app/companies/[id]/DashboardClient";

type Reading = "actions" | "commentary";

/** A shared board opens nothing of the owner's: no chat, no change, no file. */
const nowhere = () => undefined;

/** A date as the product shows one: in IST, day first (locked decision 14). */
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * A shared board (ADR 0090): the owner's board, read-only and frozen, with what was written about
 * the month beside it when they chose to send it. Every figure is still the engine's and still
 * opens to show how it was computed; Range, Compare and Present still work, because they only
 * read figures already computed.
 */
export function SharedWorkspace({
  board,
  expiresAt,
}: {
  board: SharedBoard;
  expiresAt: string;
}) {
  const readings: { id: Reading; label: string; icon: IconName }[] = [
    ...(board.boardActions === null
      ? []
      : [{ id: "actions" as const, label: "Where to act", icon: "target" as const }]),
    ...(board.commentary === null
      ? []
      : [{ id: "commentary" as const, label: "Commentary", icon: "document" as const }]),
  ];
  const [reading, setReading] = useState<Reading | null>(readings[0]?.id ?? null);
  const { money, currencySymbol } = board.dashboard.company;
  const format = companyFormat(money, currencySymbol);

  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-5 px-6 py-6">
      <header
        className="flex flex-wrap items-end justify-between gap-4"
        data-testid="share-header"
      >
        <div className="flex items-center gap-3">
          {board.logo === null ? null : (
            <img
              src={board.logo}
              alt=""
              className="h-11 w-auto max-w-[9rem] rounded-md object-contain"
            />
          )}
          <div>
            <h1 className="display text-[1.5rem] font-semibold leading-tight text-neutral-900">
              {board.companyName}
            </h1>
            <p className="text-[0.8125rem] text-neutral-600">
              The board as of {format.period(board.period)}, shared on{" "}
              {day(board.sharedOn)}. Read only; this link works until {day(expiresAt)}.
            </p>
          </div>
        </div>
        {board.preparer === null ? null : (
          <div
            className="flex items-center gap-2 text-[0.8125rem] text-neutral-600"
            data-testid="share-preparer"
          >
            {board.preparer.logo === null ? null : (
              <img
                src={board.preparer.logo}
                alt=""
                className="h-7 w-auto max-w-[6rem] object-contain"
              />
            )}
            <span>
              Prepared by{" "}
              <strong className="font-semibold text-neutral-900">
                {board.preparer.name}
              </strong>
            </span>
          </div>
        )}
      </header>

      <div
        className={`grid items-start gap-5 ${readings.length > 0 ? "xl:grid-cols-[minmax(0,1fr)_25rem]" : ""}`}
      >
        <div className="min-w-0" data-testid="share-board">
          <DashboardClient
            companyId="shared"
            logoUrl={board.logo}
            onInvestigate={nowhere}
            reloadKey={0}
            onChangeBox={nowhere}
            onWhereToAct={nowhere}
            sample={board.dashboard}
            preparer={
              board.preparer === null
                ? null
                : { name: board.preparer.name, logoUrl: board.preparer.logo }
            }
          />
        </div>

        {reading === null ? null : (
          <aside
            className="rounded-xl border border-neutral-200/80 bg-surface shadow-sm xl:sticky xl:top-7"
            data-testid="share-reading"
            aria-label={`Written for ${format.period(board.period)}`}
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
              <div
                role="radiogroup"
                aria-label="What to read"
                className="inline-flex items-center gap-0.5 rounded-full border border-neutral-200/80 bg-surface p-1"
              >
                {readings.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={reading === r.id}
                    onClick={() => {
                      setReading(r.id);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
                      reading === r.id
                        ? "bg-accent-600 text-white"
                        : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                    }`}
                  >
                    <Icon name={r.icon} size={14} />
                    {r.label}
                  </button>
                ))}
              </div>
              <span className="text-[0.8125rem] text-neutral-500">
                {format.period(board.period)}
              </span>
            </header>
            <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-4">
              {reading === "actions" && board.boardActions !== null ? (
                <BoardActionsView jobId="shared" sample={board.boardActions} />
              ) : board.commentary !== null ? (
                <CommentaryView
                  jobId="shared"
                  companyName={board.companyName}
                  periodLabel={format.period(board.period)}
                  sample={board.commentary}
                />
              ) : null}
            </div>
          </aside>
        )}
      </div>

      <footer className="border-t border-neutral-200/80 pt-4 text-[0.75rem] leading-relaxed text-neutral-500">
        Every figure here was computed from the company&rsquo;s own books by{" "}
        {PRODUCT_NAME}, never written by AI, and each one opens to show how. This is a
        copy made on {day(board.sharedOn)}: it does not change when the books do.
      </footer>
    </main>
  );
}
