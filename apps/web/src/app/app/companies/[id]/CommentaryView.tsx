"use client";

/**
 * Commentary (SPEC §25), read inside the workspace assistant (ADR 0033). The browser re-runs the
 * placeholder post-check before showing anything, substitutes the stored values, and makes every
 * substituted value a lineage link.
 *
 * It reads two ways (ADR 0035): in the conversation, where it is one more thing the assistant
 * said, and as a **report** — a title block, a measure that can be read for a page at a time, and
 * a print that puts the month's write-up into a board pack beside the workbook.
 */

import type { NumberFormatOptions } from "@magicmis/core/format";
import type { CommentaryOutput, FactsPack, MetricValue } from "@magicmis/engine";
import {
  companyFormat,
  formatValue,
  renderCommentary,
  type Segment,
} from "@magicmis/render-dashboard";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Drawer } from "@/components/Drawer";
import { LineagePanel } from "@/components/LineagePanel";
import { Alert, Button } from "@/components/ui";
import { api } from "@/lib/client-api";

interface Payload {
  company: { money: NumberFormatOptions; currencySymbol: string };
  output: CommentaryOutput;
  pack: Pick<FactsPack, "facts" | "dimensions" | "periods">;
  allowlist: string[];
  values: MetricValue[];
}

function Segments({
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
            className={s.hint === null ? "" : "text-warning"}
          >
            {s.display}
          </span>
        ) : (
          <button
            key={i}
            type="button"
            className="tabular-nums underline decoration-neutral-300 underline-offset-4 hover:decoration-accent-600"
            title={s.hint ?? undefined}
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

export function CommentaryView({
  jobId,
  companyName,
  periodLabel,
}: {
  jobId: string;
  companyName: string;
  periodLabel: string;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState(false);

  // While the report is open, printing prints the report and nothing else.
  useEffect(() => {
    if (!report) return;
    document.body.dataset["printing"] = "report";
    return () => {
      delete document.body.dataset["printing"];
    };
  }, [report]);

  useEffect(() => {
    void api<Payload>(`/api/jobs/${jobId}/commentary`).then((r) => {
      if (r.ok) setPayload(r.data);
      else setError(r.message);
    });
  }, [jobId]);

  const rendered = useMemo(() => {
    if (payload === null) return null;
    const format = {
      ...companyFormat(payload.company.money, payload.company.currencySymbol),
      name: () => null,
    };
    return renderCommentary(
      payload.output,
      payload.pack,
      payload.values,
      payload.allowlist,
      format,
    );
  }, [payload]);

  if (error !== null) return <Alert tone="error">{error}</Alert>;
  if (payload === null || rendered === null)
    return <p className="text-sm text-neutral-500">Opening the commentary…</p>;
  if (!rendered.ok)
    return (
      <Alert tone="error">
        This commentary did not pass the figure check, so it is not shown.
      </Alert>
    );
  const sections = rendered.commentary.sections.map((section, i) => ({ section, i }));

  return (
    <>
      <article
        className="flex flex-col gap-3 text-sm leading-6 text-neutral-800"
        data-testid="commentary"
      >
        {sections.map(({ section, i }) => (
          <section key={i}>
            <h3 className="mb-1 font-semibold text-neutral-900">
              <Segments segments={section.heading} onOpen={setSelected} />
            </h3>
            {section.paragraphs.map((p, j) => (
              <p key={j} className="mb-2">
                <Segments segments={p} onOpen={setSelected} />
              </p>
            ))}
          </section>
        ))}
        <button
          type="button"
          className="w-fit rounded-md px-1.5 py-1 text-[0.6875rem] font-medium text-accent-700 hover:bg-accent-50"
          onClick={() => {
            setReport(true);
          }}
          data-testid="commentary-open-report"
        >
          Open as a report
        </button>
      </article>

      {!report
        ? null
        : createPortal(
            <div className="report-overlay fixed inset-0 z-50 overflow-y-auto bg-canvas">
              <div className="mx-auto w-full max-w-[52rem] px-8 py-10">
                <div
                  className="mb-8 flex items-start justify-between gap-4"
                  data-print="hide"
                >
                  <div>
                    <p className="eyebrow">Commentary</p>
                    <h1 className="mt-1 text-[1.75rem] leading-tight font-semibold tracking-tight text-neutral-900">
                      {companyName}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500">
                      {periodLabel} · every figure computed from the books
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="secondary"
                      icon="document"
                      onClick={() => {
                        window.print();
                      }}
                    >
                      Print or save as PDF
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setReport(false);
                      }}
                    >
                      Close
                    </Button>
                  </div>
                </div>

                {/* The printed page needs the same heading, without the controls beside it. */}
                <header
                  className="mb-8 hidden border-b border-neutral-200 pb-4"
                  data-print="show"
                >
                  <h1 className="text-[1.5rem] font-semibold text-neutral-900">
                    {companyName} — Commentary
                  </h1>
                  <p className="mt-1 text-sm text-neutral-600">{periodLabel}</p>
                </header>

                <article
                  className="flex flex-col gap-7 text-[0.9375rem] leading-7 text-neutral-800"
                  data-testid="commentary-report"
                >
                  {sections.map(({ section, i }) => (
                    <section key={i} className="print-block">
                      <h2 className="mb-2 flex items-baseline gap-2 text-[1.0625rem] font-semibold text-neutral-900">
                        <span className="text-[0.8125rem] font-medium text-neutral-400">
                          {(i + 1).toString().padStart(2, "0")}
                        </span>
                        <Segments segments={section.heading} onOpen={setSelected} />
                      </h2>
                      {section.paragraphs.map((p, j) => (
                        <p key={j} className="mb-3 last:mb-0">
                          <Segments segments={p} onOpen={setSelected} />
                        </p>
                      ))}
                    </section>
                  ))}
                </article>

                <footer className="mt-10 border-t border-neutral-200 pt-4 text-[0.75rem] leading-relaxed text-neutral-500">
                  Every figure here is computed by the engine from the files you supplied
                  and checked before it was written; the wording is drafted from those
                  figures. Prepared from data provided by the user; requires professional
                  review.
                </footer>
              </div>
            </div>,
            document.body,
          )}
      <Drawer
        open={selected !== null}
        label="Lineage"
        onClose={() => {
          setSelected(null);
        }}
      >
        {selected === null ? null : (
          <LineagePanel
            selected={selected}
            values={payload.values}
            label={
              companyFormat(payload.company.money, payload.company.currencySymbol).label
            }
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
    </>
  );
}
