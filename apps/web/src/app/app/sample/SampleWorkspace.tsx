"use client";

import { companyFormat } from "@magicmis/render-dashboard";
import { useState } from "react";

import { Icon, type IconName } from "@/components/Icon";
import type { SampleCompany } from "@/lib/sample-company";

import { BoardActionsView } from "../companies/[id]/BoardActionsView";
import { CommentaryView } from "../companies/[id]/CommentaryView";
import { DashboardClient } from "../companies/[id]/DashboardClient";

type Reading = "actions" | "commentary";

const READINGS: readonly { id: Reading; label: string; icon: IconName }[] = [
  { id: "actions", label: "Where to act", icon: "target" },
  { id: "commentary", label: "Commentary", icon: "document" },
];

/** Nothing on the sample opens the chat: it belongs to a company, and this one is invented. */
const nowhere = () => undefined;

/**
 * The sample company's workspace (ADR 0086): the board where a company's own would be, and
 * beside it, where the chat sits, the two things the assistant writes about a month. Every
 * figure is the engine's, from the recording, and each still opens its lineage.
 */
export function SampleWorkspace({ sample }: { sample: SampleCompany }) {
  const [reading, setReading] = useState<Reading>("actions");
  const { money, currencySymbol } = sample.dashboard.company;
  const format = companyFormat(money, currencySymbol);
  const period =
    reading === "actions" ? sample.boardActions.period : sample.commentary.period;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="min-w-0" data-testid="sample-board">
        <DashboardClient
          companyId="sample"
          logoUrl={null}
          onInvestigate={nowhere}
          reloadKey={0}
          onChangeBox={nowhere}
          onWhereToAct={nowhere}
          sample={sample.dashboard}
        />
      </div>

      <aside
        className="rounded-xl border border-neutral-200/80 bg-surface shadow-sm xl:sticky xl:top-7"
        data-testid="sample-reading"
        aria-label={`Written for ${format.period(period)}`}
      >
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
          <div
            role="radiogroup"
            aria-label="What to read"
            className="inline-flex items-center gap-0.5 rounded-full border border-neutral-200/80 bg-surface p-1"
          >
            {READINGS.map((r) => (
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
            {format.period(period)}
          </span>
        </header>
        <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-4">
          {reading === "actions" ? (
            <BoardActionsView jobId="sample" sample={sample.boardActions.payload} />
          ) : (
            <CommentaryView
              jobId="sample"
              companyName={sample.name}
              periodLabel={format.period(period)}
              sample={sample.commentary.payload}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
