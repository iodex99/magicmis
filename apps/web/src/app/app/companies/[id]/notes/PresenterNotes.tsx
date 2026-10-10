"use client";

import { periodLabel } from "@magicmis/render-dashboard";
import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import {
  isPresentMessage,
  presentChannelName,
  type PresentAsk,
} from "@/lib/present-channel";

import { BoardActionsView } from "../BoardActionsView";
import { CommentaryView } from "../CommentaryView";

/**
 * The presenter's own screen (ADR 0087). It follows the month the board is showing in Present —
 * the board says which over a BroadcastChannel as it steps — and shows what was written about
 * that month: where to act first, because that is what a board meeting turns on, then the
 * commentary. Nothing here is on the room's screen.
 *
 * It asks the board for its month as it opens, and has a month picker of its own (ADR 0091):
 * a presenter rehearses with these notes before the meeting, when nothing is being presented
 * for them to follow. Picking a month here stops following until the board steps again.
 */
export function PresenterNotes({
  companyId,
  companyName,
  initialPeriod,
  months,
  written,
}: {
  companyId: string;
  companyName: string;
  initialPeriod: string | null;
  /** The months with something written, newest first, without the ones off the board. */
  months: readonly string[];
  written: Readonly<Record<string, { commentary?: string; actions?: string }>>;
}) {
  const [period, setPeriod] = useState<string | null>(initialPeriod);
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(presentChannelName(companyId));
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isPresentMessage(event.data)) return;
      if (event.data.kind === "ended") {
        setFollowing(false);
        return;
      }
      setPeriod(event.data.period);
      setFollowing(true);
    };
    const ask: PresentAsk = { kind: "ask" };
    channel.postMessage(ask);
    return () => {
      channel.close();
    };
  }, [companyId]);

  const notes = period === null ? undefined : written[period];
  const label = period === null ? "" : periodLabel(period);
  // The month the board sent may have nothing written; it is still the one on screen.
  const choices =
    period === null || months.includes(period)
      ? months
      : [...months, period].sort().reverse();

  return (
    <main className="min-h-screen bg-canvas px-6 py-6" data-testid="presenter-notes">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <p className="eyebrow">Presenter notes · on this screen only</p>
          <h1 className="display mt-1 text-[1.5rem] leading-tight font-semibold text-neutral-900">
            {companyName}
          </h1>
          <p className="mt-0.5 text-[1rem] text-neutral-600" data-testid="notes-period">
            {label}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {choices.length === 0 ? null : (
            <label className="flex items-center gap-2 text-[0.8125rem] font-medium text-neutral-600">
              <span>Month</span>
              <select
                className="h-9 rounded-md border border-neutral-200 bg-surface px-2.5 text-[0.8125rem] font-medium text-neutral-900 hover:border-neutral-300"
                value={period ?? ""}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setFollowing(false);
                }}
                data-testid="notes-month"
              >
                {choices.map((m) => (
                  <option key={m} value={m}>
                    {periodLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span
            className="flex items-center gap-1.5 text-[0.75rem] text-neutral-500"
            role="status"
            data-testid="notes-following"
          >
            <Icon name={following ? "check" : "info"} size={13} />
            {following
              ? "Following the board"
              : "Not following the board. Start Present, or step a month there, and these notes go with it."}
          </span>
        </div>
      </header>

      {period === null ? (
        <p className="text-sm text-neutral-600">
          Nothing has been written about this company yet.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[1.0625rem] font-semibold text-neutral-900">
              <Icon name="target" size={16} className="text-accent-600" />
              Where to act
            </h2>
            {notes?.actions === undefined ? (
              <p className="text-sm text-neutral-500" data-testid="notes-no-actions">
                No suggestions written for {label}. Ask for them from the board&rsquo;s
                Where to act button.
              </p>
            ) : (
              <BoardActionsView key={notes.actions} jobId={notes.actions} />
            )}
          </section>
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[1.0625rem] font-semibold text-neutral-900">
              <Icon name="document" size={16} className="text-accent-600" />
              Commentary
            </h2>
            {notes?.commentary === undefined ? (
              <p className="text-sm text-neutral-500" data-testid="notes-no-commentary">
                No commentary written for {label}. Ask the assistant beside the board to
                write it.
              </p>
            ) : (
              <CommentaryView
                key={notes.commentary}
                jobId={notes.commentary}
                companyName={companyName}
                periodLabel={label}
              />
            )}
          </section>
        </div>
      )}
    </main>
  );
}
