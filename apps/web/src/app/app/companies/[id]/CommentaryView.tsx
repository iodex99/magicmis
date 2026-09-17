"use client";

/**
 * Commentary (SPEC §25), read inside the workspace assistant (ADR 0033). The browser re-runs the
 * placeholder post-check before showing anything, substitutes the stored values, and makes every
 * substituted value a lineage link.
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

import { Drawer } from "@/components/Drawer";
import { LineagePanel } from "@/components/LineagePanel";
import { Alert } from "@/components/ui";
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

export function CommentaryView({ jobId }: { jobId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

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
  return (
    <>
      <article
        className="flex flex-col gap-3 text-sm leading-6 text-neutral-800"
        data-testid="commentary"
      >
        {rendered.commentary.sections.map((s, i) => (
          <section key={i}>
            <h3 className="mb-1 font-semibold text-neutral-900">
              <Segments segments={s.heading} onOpen={setSelected} />
            </h3>
            {s.paragraphs.map((p, j) => (
              <p key={j} className="mb-2">
                <Segments segments={p} onOpen={setSelected} />
              </p>
            ))}
          </section>
        ))}
      </article>
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
