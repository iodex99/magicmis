"use client";

/**
 * Setup and refresh flow (SPEC §23). Files stay in the pipeline worker. Before the price is
 * confirmed the page shows only file names, sizes, sheet and row counts (SPEC §2.3); recognition,
 * mappings, checks and the workbook appear only once credits are held.
 */

import type { ReviewRow } from "@magicmis/semantic";
import type { RowBinding } from "@magicmis/templates";
import { useCallback, useEffect, useRef, useState } from "react";

import { MappingReview } from "@/components/MappingReview";
import { ProcessingNotice } from "@/components/ProcessingNotice";
import { ReferenceBindingReview } from "@/components/ReferenceBindingReview";
import { Alert, Button, Panel } from "@/components/ui";
import {
  ACTION_LABELS,
  DELIVERY_LABELS,
  formatCredits,
  TIER_LABELS,
} from "@/lib/actions";
import { api, newIdempotencyKey } from "@/lib/client-api";
import { clearPipeline, pipelineClient } from "@/lib/pipeline/client";
import type {
  ComputeResult,
  PipelineFileSummary,
  ReferenceReviewRow,
} from "@/lib/pipeline/types";
import type { JobSession } from "@/lib/server/companies";

type Tier = keyof typeof TIER_LABELS;
type Delivery = keyof typeof DELIVERY_LABELS;

interface CreatedJob {
  jobId: string;
  state: string;
  type: keyof typeof ACTION_LABELS;
  priceCredits: string;
  quote: { credits: string; expiresAt: string } | null;
  restructure: boolean;
  available: string;
}

type Phase =
  | { kind: "files" }
  | { kind: "pricing" }
  | { kind: "confirm"; job: CreatedJob }
  | { kind: "running"; jobId: string; step: string }
  | {
      kind: "review";
      jobId: string;
      rows: readonly ReviewRow[];
      references: readonly ReferenceReviewRow[] | null;
    }
  | {
      kind: "bindings";
      jobId: string;
      rows: readonly ReferenceReviewRow[];
      confirmed: Parameters<typeof MappingReview>[0] extends {
        onConfirm: (c: infer C) => void;
      }
        ? C
        : never;
      unmappedAccepted: boolean;
    }
  | {
      kind: "done";
      jobId: string;
      outputId: string | null;
      captured: string;
      result: ComputeResult;
    }
  | {
      kind: "failed";
      jobId: string;
      message: string;
      checks: ComputeResult["checks"];
      captured: string;
    };

const REFUSALS: Record<string, string> = {
  unsupported_type: "Only .xlsx, .xlsm, .xls and .csv files are accepted.",
  file_too_large: "A file is larger than the per-file limit.",
  session_too_large: "These files together exceed the session limit.",
  too_many_files: "Too many files for one job.",
  unsafe_workbook: "A workbook's contents are too large or malformed to open safely.",
};

export function JobRunner({
  companyId,
  mode,
}: {
  companyId: string;
  mode: "setup" | "refresh";
}) {
  const [files, setFiles] = useState<PipelineFileSummary[]>([]);
  const [reference, setReference] = useState<PipelineFileSummary | null>(null);
  const [tier, setTier] = useState<Tier>("professional");
  const [delivery, setDelivery] = useState<Delivery>("instant");
  const [phase, setPhase] = useState<Phase>({ kind: "files" });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const effect = { cancelled: false };
    void (async () => {
      const [session, config] = await Promise.all([
        api<JobSession>(`/api/companies/${companyId}/session`),
        api<{
          limits: Parameters<Awaited<ReturnType<typeof pipelineClient>>["start"]>[1];
        }>("/api/ingest/config"),
      ]);
      if (effect.cancelled) return;
      if (!session.ok) {
        setError(session.message);
        return;
      }
      if (!config.ok) {
        setError(config.message);
        return;
      }
      await pipelineClient().start(session.data, config.data.limits);
      setReady(true);
    })();
    return () => {
      effect.cancelled = true;
      if (heartbeat.current !== null) clearInterval(heartbeat.current);
      void clearPipeline();
    };
  }, [companyId]);

  const advance = async (jobId: string, to: string) => {
    const r = await api(`/api/jobs/${jobId}/advance`, { body: { to } });
    if (!r.ok) throw new Error(r.message);
    setPhase({ kind: "running", jobId, step: to });
  };

  const onReference = async (list: FileList | null) => {
    const file = list?.[0];
    if (file === undefined) return;
    setError(null);
    const r = await pipelineClient().addReference(file);
    if (r.summary === null)
      setError(
        r.refused === "unsupported_type"
          ? "The reference MIS must be an .xlsx or .xlsm workbook."
          : (REFUSALS[r.refused ?? ""] ?? "The reference MIS could not be read."),
      );
    setReference(r.summary);
  };

  const onFiles = async (list: FileList | null) => {
    if (list === null || list.length === 0) return;
    setError(null);
    const r = await pipelineClient().addFiles([...list]);
    if (r.refused !== null)
      setError(REFUSALS[r.refused] ?? "These files could not be added.");
    setFiles((f) => [...f, ...r.added]);
  };

  const getPrice = async () => {
    setError(null);
    setPhase({ kind: "pricing" });
    const inputs = await pipelineClient().pricingInputs();
    const r = await api<CreatedJob>("/api/jobs", {
      body: {
        companyId,
        type:
          mode === "refresh"
            ? "monthly_refresh"
            : reference === null
              ? "company_setup"
              : "reference_mis_recreate",
        tier,
        delivery,
        size: inputs.size,
        fingerprints: inputs.fingerprints,
      },
      idempotencyKey: newIdempotencyKey(),
    });
    if (!r.ok) {
      setError(r.message);
      setPhase({ kind: "files" });
      return;
    }
    setPhase({ kind: "confirm", job: r.data });
  };

  const fail = useCallback(
    async (jobId: string, result: ComputeResult | null, message: string) => {
      const first = result?.blocking[0];
      const r = await api<{ capturedCredits: string }>(`/api/jobs/${jobId}/fail`, {
        body: {
          failureClass: result?.failureClass ?? "platform_fault",
          code: first?.id ?? "browser_error",
          detail: first === undefined ? message : `${first.message} ${first.fix}`.trim(),
        },
      });
      setPhase({
        kind: "failed",
        jobId,
        message: first?.message ?? message,
        checks: result?.checks ?? [],
        captured: r.ok ? r.data.capturedCredits : "0",
      });
    },
    [],
  );

  const finish = async (
    jobId: string,
    confirmed: readonly {
      ledgerKey: string;
      head: string;
      applyToAllCompanies: boolean;
      source?: string;
    }[],
    unmappedAccepted: boolean,
  ) => {
    const pipeline = pipelineClient();
    await advance(jobId, "computing");
    const result = await pipeline.compute({
      confirmed,
      unmappedAccepted,
      tierLabel: TIER_LABELS[tier],
    });
    await advance(jobId, "validating");
    if (result.failureClass !== null) return fail(jobId, result, "Validation failed.");
    await advance(jobId, "rendering");
    const done = await api<{ capturedCredits: string; outputId: string | null }>(
      `/api/jobs/${jobId}/complete`,
      {
        body: {
          snapshot: result.snapshot,
          blueprint: result.blueprint,
          accountRules: result.accountRules,
          output: { fileName: result.fileName, base64: result.workbookBase64 },
        },
        idempotencyKey: newIdempotencyKey(),
      },
    );
    if (!done.ok) return fail(jobId, null, done.message);
    if (heartbeat.current !== null) clearInterval(heartbeat.current);
    setPhase({
      kind: "done",
      jobId,
      outputId: done.data.outputId,
      captured: done.data.capturedCredits,
      result,
    });
  };

  const run = async (job: CreatedJob) => {
    setError(null);
    const hold = await api(
      job.quote === null
        ? `/api/jobs/${job.jobId}/confirm`
        : `/api/jobs/${job.jobId}/accept-quote`,
      {
        body: {},
        idempotencyKey: newIdempotencyKey(),
      },
    );
    if (!hold.ok) {
      setError(hold.message);
      return;
    }
    heartbeat.current = setInterval(
      () => void api(`/api/jobs/${job.jobId}/heartbeat`, { body: {} }),
      60_000,
    );
    const pipeline = pipelineClient();
    try {
      await advance(job.jobId, "preflight");
      await advance(job.jobId, "profiling");
      await advance(job.jobId, "classifying");
      if ((await pipeline.unrecognisedSheets()) > 0) {
        await fail(
          job.jobId,
          null,
          "Some sheets could not be recognised. Upload the Tally exports listed in the help guide.",
        );
        return;
      }
      await advance(job.jobId, "mapping");
      let mapped = await pipeline.map();
      if (mapped.unmatched.length > 0) {
        const ai = await api<{
          output: {
            mappings: {
              ref: string;
              head: string | null;
              confidence: "high" | "medium" | "low";
            }[];
          };
        }>(`/api/jobs/${job.jobId}/ai/ledger_mapping`, {
          body: { ledgers: mapped.unmatched },
        });
        if (!ai.ok) {
          setPhase({
            kind: "failed",
            jobId: job.jobId,
            message: ai.message,
            checks: [],
            captured: "0",
          });
          return;
        }
        mapped = await pipeline.applyAi(ai.data.output.mappings);
      }
      let references: readonly ReferenceReviewRow[] | null = null;
      if (reference !== null) {
        const layout = await pipeline.referenceLayout();
        const bound = await api<{ bindings: RowBinding[] }>(
          `/api/jobs/${job.jobId}/ai/reference_layout`,
          { body: { layout } },
        );
        if (!bound.ok) {
          setPhase({
            kind: "failed",
            jobId: job.jobId,
            message: bound.message,
            checks: [],
            captured: "0",
          });
          return;
        }
        references = await pipeline.referenceReview(bound.data.bindings);
      }
      if (mapped.reviewRows.length === 0 && references === null) {
        // SPEC §19: nothing new or changed on refresh — review is skipped.
        await finish(job.jobId, [], false);
        return;
      }
      await advance(job.jobId, "awaiting_review");
      if (mapped.reviewRows.length === 0 && references !== null) {
        setPhase({
          kind: "bindings",
          jobId: job.jobId,
          rows: references,
          confirmed: [],
          unmappedAccepted: false,
        });
        return;
      }
      setPhase({ kind: "review", jobId: job.jobId, rows: mapped.reviewRows, references });
    } catch (e) {
      await fail(
        job.jobId,
        null,
        e instanceof Error ? e.message : "The job stopped unexpectedly.",
      );
    }
  };

  const busy = phase.kind === "pricing" || phase.kind === "running";

  return (
    <div className="flex flex-col gap-6">
      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {phase.kind === "files" || phase.kind === "pricing" ? (
        <ProcessingNotice>
        <Panel
          title={mode === "setup" ? "Upload trial balances" : "Upload this month's files"}
        >
          <p className="mb-3 text-sm text-neutral-700">
            Files are read in your browser and never uploaded.{" "}
            {mode === "setup"
              ? "Include every month you want in the MIS."
              : "Include the new month."}
          </p>
          <input
            type="file"
            multiple
            accept=".xlsx,.xlsm,.xls,.csv"
            aria-label="Choose files"
            disabled={!ready || busy}
            onChange={(e) => void onFiles(e.target.files)}
          />
          {files.length === 0 ? null : (
            <table className="mt-4 w-full text-sm" data-testid="job-files">
              <thead>
                <tr className="text-left text-xs text-neutral-600">
                  <th className="py-1">File</th>
                  <th className="py-1 text-right">Size</th>
                  <th className="py-1 text-right">Sheets</th>
                  <th className="py-1 text-right">Rows</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.name} className="border-t border-neutral-100">
                    <td className="py-1">{f.name}</td>
                    <td className="py-1 text-right tabular-nums">
                      {Math.ceil(f.size / 1024).toLocaleString("en-IN")} KB
                    </td>
                    <td className="py-1 text-right tabular-nums">{f.sheets}</td>
                    <td className="py-1 text-right tabular-nums">{f.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {mode === "setup" ? (
            <div className="mt-4 text-sm">
              <label className="flex flex-col gap-1">
                <span>
                  Your current MIS workbook (optional) — we recreate its layout. Only its
                  layout is read; figures come from your trial balances.
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xlsm"
                  aria-label="Choose reference MIS"
                  disabled={!ready || busy}
                  onChange={(e) => void onReference(e.target.files)}
                />
              </label>
              {reference === null ? null : (
                <p className="mt-1 text-neutral-700" data-testid="job-reference">
                  {reference.name} ·{" "}
                  {Math.ceil(reference.size / 1024).toLocaleString("en-IN")} KB ·{" "}
                  {reference.sheets} sheets
                </p>
              )}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-end gap-4 text-sm">
            <label className="flex flex-col">
              Intelligence tier
              <select
                className="rounded border px-2 py-1"
                value={tier}
                onChange={(e) => {
                  setTier(e.target.value as Tier);
                }}
              >
                {Object.entries(TIER_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              Delivery
              <select
                className="rounded border px-2 py-1"
                value={delivery}
                onChange={(e) => {
                  setDelivery(e.target.value as Delivery);
                }}
              >
                {Object.entries(DELIVERY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={!ready || files.length === 0 || busy}
              onClick={() => void getPrice()}
            >
              {phase.kind === "pricing" ? "Pricing…" : "Get price"}
            </Button>
          </div>
        </Panel>
        </ProcessingNotice>
      ) : null}

      {phase.kind === "confirm" ? (
        <Panel title="Confirm price">
          <dl
            className="mb-4 grid max-w-md grid-cols-2 gap-y-2 text-sm"
            data-testid="job-price"
          >
            <dt className="text-neutral-600">Action</dt>
            <dd className="text-right font-medium">{ACTION_LABELS[phase.job.type]}</dd>
            <dt className="text-neutral-600">Intelligence tier</dt>
            <dd className="text-right font-medium">{TIER_LABELS[tier]}</dd>
            <dt className="text-neutral-600">Delivery</dt>
            <dd className="text-right font-medium">{DELIVERY_LABELS[delivery]}</dd>
            <dt className="text-neutral-600">
              {phase.job.quote === null ? "Price" : "Quote"}
            </dt>
            <dd className="text-right font-medium tabular-nums">
              {formatCredits(phase.job.quote?.credits ?? phase.job.priceCredits)} credits
            </dd>
            <dt className="text-neutral-600">Available now</dt>
            <dd className="text-right tabular-nums">
              {formatCredits(phase.job.available)}
            </dd>
            <dt className="text-neutral-600">Available after</dt>
            <dd className="text-right tabular-nums">
              {formatCredits(
                (
                  BigInt(phase.job.available) -
                  BigInt(phase.job.quote?.credits ?? phase.job.priceCredits)
                ).toString(),
              )}
            </dd>
          </dl>
          {phase.job.restructure ? (
            <Alert tone="warning">
              This month's files are structured differently from last time, so the
              restructure price applies.
            </Alert>
          ) : null}
          {phase.job.quote === null ? null : (
            <Alert tone="warning">
              This job needs more analysis than the standard price covers. The quote is
              valid until {new Date(phase.job.quote.expiresAt).toLocaleString("en-IN")}.
            </Alert>
          )}
          <div className="mt-4 flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPhase({ kind: "files" });
              }}
            >
              Back
            </Button>
            <Button onClick={() => void run(phase.job)}>
              Confirm —{" "}
              {formatCredits(phase.job.quote?.credits ?? phase.job.priceCredits)} credits
            </Button>
          </div>
        </Panel>
      ) : null}

      {phase.kind === "running" ? (
        <Panel title="Working">
          <p className="text-sm text-neutral-700" role="status" data-testid="job-step">
            {phase.step.replace(/_/gu, " ")}…
          </p>
        </Panel>
      ) : null}

      {phase.kind === "review" ? (
        <Panel title="Review mappings">
          <MappingReview
            rows={phase.rows}
            onConfirm={(confirmed) => {
              const accepted = confirmed.some((c) => c.head === "UNMAPPED");
              if (phase.references !== null) {
                setPhase({
                  kind: "bindings",
                  jobId: phase.jobId,
                  rows: phase.references,
                  confirmed,
                  unmappedAccepted: accepted,
                });
                return;
              }
              void finish(phase.jobId, confirmed, accepted).catch((e: unknown) =>
                fail(
                  phase.jobId,
                  null,
                  e instanceof Error ? e.message : "The job stopped unexpectedly.",
                ),
              );
            }}
          />
        </Panel>
      ) : null}

      {phase.kind === "bindings" ? (
        <Panel title="Review your MIS rows">
          <ReferenceBindingReview
            rows={phase.rows}
            onConfirm={(bindings) => {
              void pipelineClient()
                .useReferenceBindings(bindings)
                .then(() => finish(phase.jobId, phase.confirmed, phase.unmappedAccepted))
                .catch((e: unknown) =>
                  fail(
                    phase.jobId,
                    null,
                    e instanceof Error ? e.message : "The job stopped unexpectedly.",
                  ),
                );
            }}
          />
        </Panel>
      ) : null}

      {phase.kind === "done" ? (
        <Panel title="Your MIS is ready">
          <p className="mb-3 text-sm text-neutral-700" data-testid="job-done">
            {formatCredits(phase.captured)} credits charged. Every figure was checked
            against its source.
          </p>
          {phase.outputId === null ? null : (
            <a
              className="text-accent-700 underline"
              href={`/api/outputs/${phase.outputId}`}
              data-testid="job-download"
            >
              Download {phase.result.fileName}
            </a>
          )}
          <ChecksTable checks={phase.result.checks} />
        </Panel>
      ) : null}

      {phase.kind === "failed" ? (
        <Panel title="The job could not be completed">
          <Alert tone="error">{phase.message}</Alert>
          <p className="mt-3 text-sm text-neutral-700" data-testid="job-failed">
            {phase.captured === "0"
              ? "No credits were charged."
              : `${formatCredits(phase.captured)} credits were charged for the diagnostic.`}
          </p>
          <ChecksTable checks={phase.checks} />
        </Panel>
      ) : null}
    </div>
  );
}

function ChecksTable({ checks }: { checks: ComputeResult["checks"] }) {
  if (checks.length === 0) return null;
  return (
    <table className="mt-4 w-full text-sm" data-testid="job-checks">
      <thead>
        <tr className="text-left text-xs text-neutral-600">
          <th className="py-1">Check</th>
          <th className="py-1">Result</th>
          <th className="py-1">Details</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((c) => (
          <tr key={c.id} className="border-t border-neutral-100 align-top">
            <td className="py-1 font-mono">{c.id}</td>
            <td className="py-1">
              {c.status === "not_applicable" ? "not applicable" : c.status}
            </td>
            <td className="py-1">
              {c.message}
              {c.fix === "" ? null : (
                <span className="block text-xs text-neutral-600">{c.fix}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
