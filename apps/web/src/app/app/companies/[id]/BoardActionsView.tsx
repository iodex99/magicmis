"use client";

/**
 * "Where to act" (ADR 0062), read inside the workspace assistant beside the commentary.
 *
 * Same discipline as the commentary: the browser re-runs the placeholder check before showing
 * anything, then substitutes the figures the engine computed. A suggestion whose figures do not
 * check out is not shown with its numbers stripped — it is not shown at all, and says why. The
 * check was promised here and not made until ADR 0091; so were the lineage links, and every
 * figure now opens its source as the commentary's do.
 */

import type { NumberFormatOptions } from "@magicmis/core/format";
import type { FactsPack, MetricValue } from "@magicmis/engine";
import { checkCommentary } from "@magicmis/engine/client";
import {
  companyFormat,
  formatValue,
  placeholderSegments,
  type Segment,
} from "@magicmis/render-dashboard";
import { useEffect, useMemo, useState } from "react";

import { Drawer } from "@/components/Drawer";
import { Icon } from "@/components/Icon";
import { LineagePanel } from "@/components/LineagePanel";
import { PRODUCT_NAME } from "@/lib/brand";
import { Alert } from "@/components/ui";
import { api } from "@/lib/client-api";

type Urgency = "now" | "this_quarter" | "watch";

interface Action {
  heading: string;
  because: string;
  todo: string;
  urgency: Urgency;
}

export interface BoardActionsPayload {
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

function Line({
  segments,
  onOpen,
}: {
  segments: readonly Segment[];
  onOpen: (key: string) => void;
}) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === "text" ? (
          <span key={i}>{s.text}</span>
        ) : s.metricKey === null ? (
          <span
            key={i}
            title={s.hint ?? undefined}
            className="font-medium text-neutral-900 tabular-nums"
          >
            {s.display}
          </span>
        ) : (
          <button
            key={i}
            type="button"
            title={s.hint ?? undefined}
            className="font-medium text-neutral-900 tabular-nums underline decoration-neutral-300 underline-offset-4 hover:decoration-accent-600"
            onClick={() => {
              onOpen(s.metricKey ?? "");
            }}
          >
            {s.display}
          </button>
        ),
      )}
    </>
  );
}

export function BoardActionsView({
  jobId,
  sample,
}: {
  jobId: string;
  /** The sample company's recorded suggestions (ADR 0086), shown without a fetch. */
  sample?: BoardActionsPayload;
}) {
  const [payload, setPayload] = useState<BoardActionsPayload | null>(sample ?? null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (sample !== undefined) return;
    let live = true;
    void api<BoardActionsPayload>(`/api/jobs/${jobId}/board-actions`).then((r) => {
      if (!live) return;
      if (r.ok) setPayload(r.data);
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [jobId, sample]);

  // The stage's own V12 rule over every field the model wrote — the summary, and each heading,
  // reason and step — exactly as the server applied it before the suggestions were stored.
  const passes = useMemo(() => {
    if (payload === null) return null;
    const texts = [
      payload.output.summary,
      ...payload.output.actions.flatMap((a) => [a.heading, a.because, a.todo]),
    ];
    return (
      checkCommentary(
        { sections: [{ heading: "", paragraphs: texts.map((text) => ({ text })) }] },
        payload.pack,
        payload.allowlist,
      ).length === 0
    );
  }, [payload]);

  if (error !== null) return <Alert tone="error">{error}</Alert>;
  if (payload === null || passes === null)
    return <p className="text-sm text-neutral-500">Opening the suggestions…</p>;
  if (!passes)
    return (
      <Alert tone="error">
        These suggestions did not pass the figure check, so they are not shown.
      </Alert>
    );

  const format = {
    ...companyFormat(payload.company.money, payload.company.currencySymbol),
    name: () => null,
  };
  const line = (text: string) => (
    <Line
      segments={placeholderSegments(text, payload.values, format)}
      onOpen={setSelected}
    />
  );

  return (
    <section data-testid="board-actions" className="flex flex-col gap-4">
      <p className="text-[0.9375rem] leading-relaxed break-words text-neutral-700">
        {line(payload.output.summary)}
      </p>
      <ol className="flex flex-col gap-3">
        {payload.output.actions.map((a, i) => (
          <li
            key={i}
            className="rounded-xl border border-neutral-200/80 bg-surface p-4 break-words shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-[0.9375rem] font-semibold text-neutral-900">
                {line(a.heading)}
              </p>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold ${URGENCY[a.urgency].className}`}
              >
                {URGENCY[a.urgency].label}
              </span>
            </div>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-neutral-600">
              {line(a.because)}
            </p>
            <p className="mt-2 flex items-start gap-2 text-[0.8125rem] leading-relaxed text-neutral-900">
              <span className="mt-0.5 shrink-0 text-accent-600">
                <Icon name="arrow-right" size={14} />
              </span>
              <span>{line(a.todo)}</span>
            </p>
          </li>
        ))}
      </ol>
      <p className="text-[0.75rem] text-neutral-500">
        Suggestions drawn from this company&rsquo;s own books, for the board to consider.
        Not tax, legal or audit advice. {PRODUCT_NAME} can make mistakes, so weigh each
        against what you know of the business.
      </p>
      <Drawer
        open={selected !== null}
        label="Lineage"
        onClose={() => {
          setSelected(null);
        }}
        closeButton={false}
      >
        {selected === null ? null : (
          <LineagePanel
            selected={selected}
            values={payload.values}
            label={format.label}
            display={(v) =>
              v.value === null
                ? "—"
                : formatValue(
                    v.value,
                    v.unit,
                    payload.company.money,
                    payload.company.currencySymbol,
                  )
            }
            onSelect={setSelected}
            onClose={() => {
              setSelected(null);
            }}
          />
        )}
      </Drawer>
    </section>
  );
}
