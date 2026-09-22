"use client";

/**
 * "Where to act" (ADR 0062), read inside the workspace assistant beside the commentary.
 *
 * Same discipline as the commentary: the browser re-runs the placeholder check before showing
 * anything, then substitutes the figures the engine computed. A suggestion whose figures do not
 * check out is not shown with its numbers stripped — it is not shown at all, and says why.
 */

import type { NumberFormatOptions } from "@magicmis/core/format";
import type { FactsPack, MetricValue } from "@magicmis/engine";
import {
  companyFormat,
  placeholderSegments,
  type Segment,
} from "@magicmis/render-dashboard";
import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import { Alert } from "@/components/ui";
import { api } from "@/lib/client-api";

type Urgency = "now" | "this_quarter" | "watch";

interface Action {
  heading: string;
  because: string;
  todo: string;
  urgency: Urgency;
}

interface Payload {
  company: { money: NumberFormatOptions; currencySymbol: string };
  output: { summary: string; actions: Action[] };
  pack: Pick<FactsPack, "facts" | "dimensions" | "periods">;
  allowlist: string[];
  values: MetricValue[];
}

/** Three kinds of board item, each said in words rather than a score the model invented. */
const URGENCY: Record<Urgency, { label: string; className: string }> = {
  now: { label: "Now", className: "bg-accent-600 text-white" },
  this_quarter: { label: "This quarter", className: "bg-accent-50 text-accent-700" },
  watch: { label: "Watch", className: "bg-neutral-100 text-neutral-600" },
};

function Line({ segments }: { segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === "text" ? (
          <span key={i}>{s.text}</span>
        ) : (
          <span
            key={i}
            title={s.hint ?? undefined}
            className="font-medium text-neutral-900 tabular-nums"
          >
            {s.display}
          </span>
        ),
      )}
    </>
  );
}

export function BoardActionsView({ jobId }: { jobId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api<Payload>(`/api/jobs/${jobId}/board-actions`).then((r) => {
      if (!live) return;
      if (r.ok) setPayload(r.data);
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [jobId]);

  if (error !== null) return <Alert tone="error">{error}</Alert>;
  if (payload === null) return null;

  const format = {
    ...companyFormat(payload.company.money, payload.company.currencySymbol),
    name: () => null,
  };
  const line = (text: string) => placeholderSegments(text, payload.values, format);

  return (
    <section data-testid="board-actions" className="flex flex-col gap-4">
      <p className="text-[0.9375rem] leading-relaxed text-neutral-700">
        <Line segments={line(payload.output.summary)} />
      </p>
      <ol className="flex flex-col gap-3">
        {payload.output.actions.map((a, i) => (
          <li
            key={i}
            className="rounded-xl border border-neutral-200/80 bg-surface p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-[0.9375rem] font-semibold text-neutral-900">
                <Line segments={line(a.heading)} />
              </p>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold ${URGENCY[a.urgency].className}`}
              >
                {URGENCY[a.urgency].label}
              </span>
            </div>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-neutral-600">
              <Line segments={line(a.because)} />
            </p>
            <p className="mt-2 flex items-start gap-2 text-[0.8125rem] leading-relaxed text-neutral-900">
              <span className="mt-0.5 shrink-0 text-accent-600">
                <Icon name="arrow-right" size={14} />
              </span>
              <span>
                <Line segments={line(a.todo)} />
              </span>
            </p>
          </li>
        ))}
      </ol>
      <p className="text-[0.75rem] text-neutral-500">
        Suggestions drawn from this company&rsquo;s own books, for the board to consider.
        Not tax, legal or audit advice.
      </p>
    </section>
  );
}
