"use client";

/**
 * Commentary (SPEC §25): order it for a month, then read it. The browser re-runs the placeholder
 * post-check before showing anything, substitutes the stored values, and makes every substituted
 * value a lineage link. Party names appear only when their files are loaded in this session;
 * otherwise the token shows with a hint.
 */

import type { NumberFormatOptions } from "@magicmis/core/format";
import type { CommentaryOutput, FactsPack, MetricValue } from "@magicmis/engine";
import {
  companyFormat,
  formatValue,
  renderCommentary,
  type Segment,
} from "@magicmis/render-dashboard";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { LineagePanel } from "@/components/LineagePanel";
import { PaidJobButton } from "@/components/PaidJobButton";
import { Alert, Panel } from "@/components/ui";
import { api, newIdempotencyKey } from "@/lib/client-api";

export interface CommentaryJobRow {
  id: string;
  state: string;
  period: string | null;
  createdAt: string;
}

interface Payload {
  company: { money: NumberFormatOptions };
  output: CommentaryOutput;
  pack: Pick<FactsPack, "facts" | "dimensions" | "periods">;
  allowlist: string[];
  values: MetricValue[];
}

function Segments({ segments, onOpen }: { segments: readonly Segment[]; onOpen: (key: string) => void }) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === "text" ? (
          <span key={i}>{s.text}</span>
        ) : s.metricKey === null ? (
          <span key={i} title={s.hint ?? undefined} className={s.hint === null ? "" : "text-warning"}>
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

function CommentaryView({ jobId }: { jobId: string }) {
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
    const format = { ...companyFormat(payload.company.money), name: () => null };
    return renderCommentary(payload.output, payload.pack, payload.values, payload.allowlist, format);
  }, [payload]);

  if (error !== null) return <Alert tone="error">{error}</Alert>;
  if (payload === null || rendered === null) return <p className="text-sm text-neutral-700">Loading…</p>;
  if (!rendered.ok)
    return <Alert tone="error">This commentary did not pass the figure check, so it is not shown.</Alert>;
  return (
    <div className="flex gap-4">
      <article className="flex flex-1 flex-col gap-4 text-sm leading-6 text-neutral-900" data-testid="commentary">
        {rendered.commentary.sections.map((s, i) => (
          <section key={i}>
            <h3 className="mb-1 font-semibold">
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
      {selected === null ? null : (
        <div className="w-80 shrink-0">
          <LineagePanel
            selected={selected}
            values={payload.values}
            label={companyFormat(payload.company.money).label}
            display={(v) => (v.value === null ? "—" : formatValue(v.value, v.unit, payload.company.money))}
            onSelect={setSelected}
            onClose={() => {
              setSelected(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function CommentaryClient({
  companyId,
  periods,
  jobs,
}: {
  companyId: string;
  periods: string[];
  jobs: CommentaryJobRow[];
}) {
  const router = useRouter();
  const [period, setPeriod] = useState(periods[0] ?? "");
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const label = companyFormat({ style: "lakhs_crores", decimals: 2 }).period;

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Order commentary">
        {periods.length === 0 ? (
          <p className="text-sm text-neutral-700">Run the company setup first; commentary discusses its figures.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex max-w-xs flex-col text-sm">
              <span className="text-neutral-700">Month</span>
              <select
                className="h-9 rounded-md border border-neutral-300 px-2"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                }}
              >
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
                  </option>
                ))}
              </select>
            </label>
            <PaidJobButton
              companyId={companyId}
              type="commentary"
              label="Get price"
              deliveries={["standard", "instant"]}
              onHeld={async (jobId, delivery) => {
                const r = await api<{ state: string }>(`/api/jobs/${jobId}/commentary`, {
                  body: { period },
                  idempotencyKey: newIdempotencyKey(),
                });
                if (!r.ok) setNotice({ tone: "error", text: r.message });
                else if (r.data.state === "completed") {
                  setNotice({ tone: "success", text: "Commentary is ready." });
                  setOpen(jobId);
                } else if (r.data.state === "failed")
                  setNotice({ tone: "error", text: "Commentary could not be generated. No credits were charged." });
                else
                  setNotice({
                    tone: "success",
                    text:
                      delivery === "standard"
                        ? "Commentary is queued. You will get an email when it is ready."
                        : "Commentary needs a quote to continue.",
                  });
                router.refresh();
              }}
            />
          </div>
        )}
        {notice === null ? null : <Alert tone={notice.tone}>{notice.text}</Alert>}
      </Panel>

      <Panel title="Commentaries">
        {jobs.length === 0 ? (
          <p className="text-sm text-neutral-700">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm" data-testid="commentary-jobs">
            {jobs.map((j) => (
              <li key={j.id} className="flex gap-3">
                <span className="w-24">{j.period === null ? "—" : label(j.period)}</span>
                <span className="w-40">{j.state.replace(/_/gu, " ")}</span>
                {j.state === "completed" ? (
                  <button
                    type="button"
                    className="text-accent-700 underline"
                    onClick={() => {
                      setOpen(j.id);
                    }}
                  >
                    Read
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {open === null ? null : (
        <Panel title="Commentary">
          <CommentaryView key={open} jobId={open} />
        </Panel>
      )}
    </div>
  );
}
