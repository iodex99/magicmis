"use client";

/**
 * Setup and refresh flow (SPEC §23). Files stay in the pipeline worker. Before the price is
 * confirmed the page shows only file names, sizes, sheet and row counts (SPEC §2.3); recognition,
 * mappings, checks and the workbook appear only once credits are held.
 */

import type { ReviewRow } from "@magicmis/semantic";
import type { RowBinding } from "@magicmis/templates";
import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { MappingReview } from "@/components/MappingReview";
import { ProcessingNotice } from "@/components/ProcessingNotice";
import { ReferenceBindingReview } from "@/components/ReferenceBindingReview";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Panel,
  SelectField,
  Td,
  Th,
  Tr,
  type BadgeTone,
} from "@/components/ui";
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
  const step: 1 | 2 | 3 | 4 =
    phase.kind === "files" || phase.kind === "pricing"
      ? 1
      : phase.kind === "confirm"
        ? 2
        : phase.kind === "done" || phase.kind === "failed"
          ? 4
          : 3;

  return (
    <div className="flex flex-col gap-5">
      <Steps current={step} />

      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {phase.kind === "files" || phase.kind === "pricing" ? (
        <ProcessingNotice>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Panel
              title={
                mode === "setup" ? "Upload trial balances" : "Upload this month's files"
              }
              icon="upload"
              description={
                mode === "setup"
                  ? "Include every month you want in the MIS. Files are read in your browser and never uploaded."
                  : "Include the new month. Files are read in your browser and never uploaded."
              }
            >
              <div className="rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-25 px-5 py-6 text-center">
                <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent-50 text-accent-600">
                  <Icon name="upload" size={20} />
                </span>
                <input
                  type="file"
                  multiple
                  accept=".xlsx,.xlsm,.xls,.csv"
                  aria-label="Choose files"
                  disabled={!ready || busy}
                  onChange={(e) => void onFiles(e.target.files)}
                  className="mt-3 text-[0.8125rem] text-neutral-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-accent-600 file:px-3.5 file:py-2 file:text-[0.8125rem] file:font-medium file:text-white hover:file:bg-accent-700"
                />
              </div>
              {files.length === 0 ? null : (
                <div className="mt-4">
                  <DataTable
                    testId="job-files"
                    maxHeight="18rem"
                    head={
                      <>
                        <Th>File</Th>
                        <Th numeric>Size</Th>
                        <Th numeric>Sheets</Th>
                        <Th numeric>Rows</Th>
                      </>
                    }
                  >
                    {files.map((f) => (
                      <Tr key={f.name}>
                        <Td className="font-medium text-neutral-900">{f.name}</Td>
                        <Td numeric>
                          {Math.ceil(f.size / 1024).toLocaleString("en-IN")} KB
                        </Td>
                        <Td numeric>{f.sheets}</Td>
                        <Td numeric>{f.rows}</Td>
                      </Tr>
                    ))}
                  </DataTable>
                </div>
              )}
              {mode === "setup" ? (
                <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-25 p-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.8125rem] font-medium text-neutral-800">
                      Your current MIS workbook (optional)
                    </span>
                    <span className="text-[0.75rem] text-neutral-500">
                      We recreate its layout. Only the layout is read; every figure comes
                      from your trial balances.
                    </span>
                    <input
                      type="file"
                      accept=".xlsx,.xlsm"
                      aria-label="Choose reference MIS"
                      disabled={!ready || busy}
                      onChange={(e) => void onReference(e.target.files)}
                      className="mt-1.5 text-[0.8125rem] text-neutral-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-neutral-200 file:bg-white file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-medium file:text-neutral-800"
                    />
                  </label>
                  {reference === null ? null : (
                    <p
                      className="mt-2 flex items-center gap-1.5 text-[0.8125rem] text-neutral-700"
                      data-testid="job-reference"
                    >
                      <Icon name="check" size={14} className="text-positive" />
                      {reference.name} ·{" "}
                      {Math.ceil(reference.size / 1024).toLocaleString("en-IN")} KB ·{" "}
                      {reference.sheets} sheets
                    </p>
                  )}
                </div>
              ) : null}
            </Panel>

            <Panel title="Options" icon="sliders">
              <div className="flex flex-col gap-4">
                <SelectField
                  id="job-tier"
                  label="Intelligence tier"
                  value={tier}
                  hint="A higher tier reasons harder on unfamiliar data. It never changes the figures."
                  onChange={(e) => {
                    setTier(e.target.value as Tier);
                  }}
                >
                  {Object.entries(TIER_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  id="job-delivery"
                  label="Delivery"
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
                </SelectField>
                <Button
                  disabled={!ready || files.length === 0 || busy}
                  onClick={() => void getPrice()}
                  size="lg"
                  className="w-full"
                  iconAfter="arrow-right"
                >
                  {phase.kind === "pricing" ? "Pricing…" : "Get price"}
                </Button>
                <p className="text-[0.75rem] text-neutral-500">
                  You see the exact price and confirm it before anything is charged.
                </p>
              </div>
            </Panel>
          </div>
        </ProcessingNotice>
      ) : null}

      {phase.kind === "confirm" ? (
        <Panel title="Confirm price" icon="wallet" padding="none">
          <dl
            className="grid max-w-lg grid-cols-2 gap-y-2.5 px-5 pb-5 text-sm"
            data-testid="job-price"
          >
            <dt className="text-neutral-500">Action</dt>
            <dd className="text-right font-medium">{ACTION_LABELS[phase.job.type]}</dd>
            <dt className="text-neutral-500">Intelligence tier</dt>
            <dd className="text-right font-medium">{TIER_LABELS[tier]}</dd>
            <dt className="text-neutral-500">Delivery</dt>
            <dd className="text-right font-medium">{DELIVERY_LABELS[delivery]}</dd>
            <dt className="pt-1 font-medium text-neutral-900">
              {phase.job.quote === null ? "Price" : "Quote"}
            </dt>
            <dd className="num pt-1 text-[1.125rem] font-semibold">
              {formatCredits(phase.job.quote?.credits ?? phase.job.priceCredits)} credits
            </dd>
            <dt className="text-neutral-500">Available now</dt>
            <dd className="num">{formatCredits(phase.job.available)}</dd>
            <dt className="text-neutral-500">Available after</dt>
            <dd className="num">
              {formatCredits(
                (
                  BigInt(phase.job.available) -
                  BigInt(phase.job.quote?.credits ?? phase.job.priceCredits)
                ).toString(),
              )}
            </dd>
          </dl>
          <div className="flex flex-col gap-3 border-t border-neutral-100 bg-neutral-25 p-5">
            {phase.job.restructure ? (
              <Alert tone="warning" title="Structure has changed">
                This month&rsquo;s files are structured differently from last time, so the
                restructure price applies.
              </Alert>
            ) : null}
            {phase.job.quote === null ? null : (
              <Alert tone="warning" title="A quote was needed">
                This job needs more analysis than the standard price covers. The quote is
                valid until {new Date(phase.job.quote.expiresAt).toLocaleString("en-IN")}.
              </Alert>
            )}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setPhase({ kind: "files" });
                }}
              >
                Back
              </Button>
              <Button onClick={() => void run(phase.job)} size="lg">
                Confirm —{" "}
                {formatCredits(phase.job.quote?.credits ?? phase.job.priceCredits)}{" "}
                credits
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {phase.kind === "running" ? (
        <Panel title="Working" icon="loader">
          <div className="flex items-center gap-3">
            <Icon
              name="loader"
              size={18}
              className="animate-spin text-accent-600 [animation-duration:1.6s]"
            />
            <p className="text-sm text-neutral-700" role="status" data-testid="job-step">
              {phase.step.replace(/_/gu, " ")}…
            </p>
          </div>
          <p className="mt-2 text-[0.8125rem] text-neutral-500">
            Keep this tab open. Your files are being processed here in the browser.
          </p>
        </Panel>
      ) : null}

      {phase.kind === "review" ? (
        <Panel
          title="Review mappings"
          icon="table"
          description="Confirm how your ledgers map to the MIS schema. This is learned once and reused every month."
        >
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
        <Panel
          title="Review your MIS rows"
          icon="table"
          description="Tell us what each row of your own workbook shows, so the recreated layout means the same thing."
        >
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
        <Panel padding="none">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-100 p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-positive-subtle text-positive">
                <Icon name="check-circle" size={20} />
              </span>
              <div>
                <h2 className="text-[1.0625rem] font-semibold text-neutral-900">
                  Your MIS is ready
                </h2>
                <p className="mt-0.5 text-[0.8125rem] text-neutral-500">
                  <span data-testid="job-done">
                    {formatCredits(phase.captured)} credits charged
                  </span>
                  . Every figure was checked against its source.
                </p>
              </div>
            </div>
            {phase.outputId === null ? null : (
              <a
                className="inline-flex h-10 items-center gap-2 rounded-md bg-accent-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-accent-700"
                href={`/api/outputs/${phase.outputId}`}
                data-testid="job-download"
              >
                <Icon name="download" size={16} />
                Download {phase.result.fileName}
              </a>
            )}
          </div>
          <ChecksTable checks={phase.result.checks} />
        </Panel>
      ) : null}

      {phase.kind === "failed" ? (
        <Panel title="The job could not be completed" icon="alert" padding="none">
          <div className="flex flex-col gap-3 px-5 pb-5">
            <Alert tone="error">{phase.message}</Alert>
            <p className="text-sm text-neutral-700" data-testid="job-failed">
              {phase.captured === "0"
                ? "No credits were charged."
                : `${formatCredits(phase.captured)} credits were charged for the diagnostic.`}
            </p>
          </div>
          <ChecksTable checks={phase.checks} />
        </Panel>
      ) : null}
    </div>
  );
}

/** Where the run has got to. Each step is named, so the state is never a bare spinner. */
function Steps({ current }: { current: 1 | 2 | 3 | 4 }) {
  const labels = ["Load files", "Confirm price", "Build", "Collect"] as const;
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {labels.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const now = n === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-[0.8125rem] font-medium ${
                now
                  ? "bg-accent-600 text-white"
                  : done
                    ? "bg-positive-subtle text-positive"
                    : "bg-white text-neutral-400 ring-1 ring-neutral-200"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.6875rem] ${
                  now
                    ? "bg-white/20"
                    : done
                      ? "bg-positive text-white"
                      : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {done ? <Icon name="check" size={11} /> : n}
              </span>
              {label}
            </span>
            {n < labels.length ? (
              <span aria-hidden="true" className="h-px w-4 bg-neutral-200" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

const CHECK_TONE: Record<string, BadgeTone> = {
  pass: "positive",
  fail: "negative",
  warn: "warning",
  not_applicable: "muted",
};

function ChecksTable({ checks }: { checks: ComputeResult["checks"] }) {
  if (checks.length === 0) return null;
  return (
    <DataTable
      testId="job-checks"
      className="px-2 pb-2"
      maxHeight="24rem"
      head={
        <>
          <Th>Check</Th>
          <Th>Result</Th>
          <Th>Details</Th>
        </>
      }
    >
      {checks.map((c) => (
        <Tr key={c.id} className="align-top">
          <Td className="font-mono text-[0.8125rem] whitespace-nowrap text-neutral-900">
            {c.id}
          </Td>
          <Td>
            <Badge tone={CHECK_TONE[c.status] ?? "neutral"} dot>
              {c.status === "not_applicable" ? "not applicable" : c.status}
            </Badge>
          </Td>
          <Td>
            {c.message}
            {c.fix === "" ? null : (
              <span className="mt-0.5 block text-[0.75rem] text-neutral-500">
                {c.fix}
              </span>
            )}
          </Td>
        </Tr>
      ))}
    </DataTable>
  );
}
