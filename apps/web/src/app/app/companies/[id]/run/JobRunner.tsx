"use client";

/**
 * Setup and refresh (SPEC §23), run on the server (ADR 0032).
 *
 * Three moments for the customer: add files, see the price, collect the workbook. Files upload in
 * the background as soon as they are dropped; the price appears once they are in; the one button
 * is the SPEC §12 confirmation; and the server does everything else — recognition, mapping with
 * Claude, computation, checks and rendering — without stopping to ask. What it had to assume or
 * could not match is said on the result, and data problems arrive as warnings on a delivered
 * workbook (ADR 0031). Before payment the page shows only file names, sizes, sheet counts and row
 * counts (SPEC §2.3).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { BuyCreditsInline } from "@/components/BuyCreditsInline";
import { FileDropZone } from "@/components/FileDropZone";
import { Icon } from "@/components/Icon";
import { ProcessingNotice } from "@/components/ProcessingNotice";
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
  formatCount,
  formatCredits,
  TIER_LABELS,
} from "@/lib/actions";
import { api, newIdempotencyKey } from "@/lib/client-api";
import { removeUpload, uploadFile } from "@/lib/uploads";

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

interface Check {
  id: string;
  status: string;
  severity: string;
  message: string;
  fix: string;
}

interface RunOutcome {
  status: "completed" | "failed" | "needs_quote";
  message: string | null;
  capturedCredits: string;
  outputId: string | null;
  fileName: string | null;
  checks: Check[];
  notices: string[];
}

/** One file on screen: uploading, read, or refused with a reason. */
interface FileEntry {
  key: string;
  name: string;
  size: number;
  progress: number;
  uploadId: string | null;
  sheets: number | null;
  rows: number | null;
  problem: string | null;
}

type Phase =
  | { kind: "files" }
  | { kind: "running"; jobId: string; step: string }
  | { kind: "done"; jobId: string; outcome: RunOutcome }
  | { kind: "failed"; jobId: string; outcome: RunOutcome };

const STEP_LABELS: Record<string, string> = {
  reserved: "Starting",
  preflight: "Opening your files",
  profiling: "Reading your files",
  classifying: "Recognising the reports",
  mapping: "Matching ledgers to MIS lines",
  awaiting_review: "Matching ledgers to MIS lines",
  computing: "Computing the figures",
  validating: "Checking every figure",
  rendering: "Building your workbook",
  completed: "Finishing",
};

const fileKey = (f: File) =>
  `${f.name}:${f.size.toString()}:${f.lastModified.toString()}`;

export function JobRunner({
  companyId,
  mode,
  businessName,
}: {
  companyId: string;
  mode: "setup" | "refresh";
  /** Shown on the payment sheet when a run is short of credits. */
  businessName: string;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [reference, setReference] = useState<FileEntry | null>(null);
  const [tier, setTier] = useState<Tier>("professional");
  const [delivery, setDelivery] = useState<Delivery>("instant");
  const [phase, setPhase] = useState<Phase>({ kind: "files" });
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<CreatedJob | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [repriceAt, setRepriceAt] = useState(0);
  const priced = useRef(new Map<string, CreatedJob>());
  const createdDrafts = useRef(new Set<string>());
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  // Read through a function so each check is a fresh read of the ref, not a narrowed constant.
  const stopTimers = () => {
    if (heartbeat.current !== null) clearInterval(heartbeat.current);
    if (poll.current !== null) clearInterval(poll.current);
    heartbeat.current = null;
    poll.current = null;
  };
  useEffect(() => stopTimers, []);

  const patch = (key: string, change: Partial<FileEntry>) => {
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...change } : f)));
  };

  const onFiles = async (list: File[]) => {
    setError(null);
    const fresh = list.filter((f) => !files.some((e) => e.key === fileKey(f)));
    setFiles((prev) => [
      ...prev,
      ...fresh.map((f) => ({
        key: fileKey(f),
        name: f.name,
        size: f.size,
        progress: 0,
        uploadId: null,
        sheets: null,
        rows: null,
        problem: null,
      })),
    ]);
    // Uploads run one after another so a large batch does not saturate the connection.
    for (const f of fresh) {
      const key = fileKey(f);
      const r = await uploadFile(companyId, f, (fraction) => {
        patch(key, { progress: fraction });
      });
      if (!r.ok) {
        patch(key, { problem: r.message, progress: 1 });
        continue;
      }
      patch(key, {
        progress: 1,
        uploadId: r.file.refused === null ? r.file.uploadId : null,
        sheets: r.file.sheets,
        rows: r.file.rows,
        problem: r.file.refused,
      });
    }
  };

  const onReference = async (list: File[]) => {
    const f = list[0];
    if (f === undefined) return;
    setError(null);
    const entry: FileEntry = {
      key: fileKey(f),
      name: f.name,
      size: f.size,
      progress: 0,
      uploadId: null,
      sheets: null,
      rows: null,
      problem: null,
    };
    setReference(entry);
    const r = await uploadFile(companyId, f, (fraction) => {
      setReference((cur) => (cur === null ? cur : { ...cur, progress: fraction }));
    });
    setReference(
      r.ok
        ? {
            ...entry,
            progress: 1,
            uploadId: r.file.refused === null ? r.file.uploadId : null,
            sheets: r.file.sheets,
            rows: r.file.rows,
            problem: r.file.refused,
          }
        : { ...entry, progress: 1, problem: r.message },
    );
  };

  const remove = (entry: FileEntry) => {
    setFiles((list) => list.filter((f) => f.key !== entry.key));
    if (entry.uploadId !== null) void removeUpload(entry.uploadId);
  };

  const uploading = files.some((f) => f.progress < 1) || (reference?.progress ?? 1) < 1;
  const readyIds = files.flatMap((f) => (f.uploadId === null ? [] : [f.uploadId]));
  const referenceId = reference?.uploadId ?? null;
  const jobType =
    mode === "refresh"
      ? "monthly_refresh"
      : referenceId === null
        ? "company_setup"
        : "reference_mis_recreate";

  // Price as soon as the uploads are in, and again whenever something that changes it changes.
  useEffect(() => {
    if (uploading || readyIds.length === 0 || phase.kind !== "files") {
      if (readyIds.length === 0) setQuote(null);
      return;
    }
    const state = { cancelled: false };
    const cancelled = () => state.cancelled;
    const signature = JSON.stringify([jobType, tier, delivery, readyIds, referenceId]);
    const cached = priced.current.get(signature);
    if (cached !== undefined) {
      setQuote(cached);
      return;
    }
    setQuote(null);
    setQuoting(true);
    void (async () => {
      const r = await api<CreatedJob>("/api/jobs", {
        body: {
          companyId,
          type: jobType,
          tier,
          delivery,
          uploadIds: readyIds,
          referenceUploadId: referenceId,
        },
        idempotencyKey: newIdempotencyKey(),
      });
      if (r.ok) createdDrafts.current.add(r.data.jobId);
      if (cancelled()) return;
      setQuoting(false);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      priced.current.set(signature, r.data);
      for (const draft of createdDrafts.current) {
        if (draft === r.data.jobId) continue;
        createdDrafts.current.delete(draft);
        void api(`/api/jobs/${draft}/cancel`, {
          body: {},
          idempotencyKey: newIdempotencyKey(),
        });
      }
      setQuote(r.data);
    })();
    return () => {
      state.cancelled = true;
    };
  }, [
    uploading,
    readyIds.join(","),
    referenceId,
    tier,
    delivery,
    jobType,
    companyId,
    phase.kind,
    repriceAt,
  ]);

  const run = useCallback(async (job: CreatedJob) => {
    setError(null);
    setStarting(true);
    const hold = await api(
      job.quote === null
        ? `/api/jobs/${job.jobId}/confirm`
        : `/api/jobs/${job.jobId}/accept-quote`,
      { body: {}, idempotencyKey: newIdempotencyKey() },
    );
    setStarting(false);
    if (!hold.ok) {
      setError(hold.message);
      return;
    }
    setPhase({ kind: "running", jobId: job.jobId, step: "reserved" });
    heartbeat.current = setInterval(
      () => void api(`/api/jobs/${job.jobId}/heartbeat`, { body: {} }),
      60_000,
    );
    poll.current = setInterval(() => {
      void api<{ state: string }>(`/api/jobs/${job.jobId}`).then((s) => {
        if (s.ok)
          setPhase((cur) =>
            cur.kind === "running" ? { ...cur, step: s.data.state } : cur,
          );
      });
    }, 1500);
    const r = await api<RunOutcome>(`/api/jobs/${job.jobId}/run`, { body: {} });
    stopTimers();
    if (!r.ok) {
      setPhase({
        kind: "failed",
        jobId: job.jobId,
        outcome: {
          status: "failed",
          message: r.message,
          capturedCredits: "0",
          outputId: null,
          fileName: null,
          checks: [],
          notices: [],
        },
      });
      return;
    }
    setPhase(
      r.data.status === "completed"
        ? { kind: "done", jobId: job.jobId, outcome: r.data }
        : { kind: "failed", jobId: job.jobId, outcome: r.data },
    );
  }, []);

  const busy = phase.kind === "running" || starting;
  const step: 1 | 2 | 3 = phase.kind === "files" ? 1 : phase.kind === "running" ? 2 : 3;
  const price = quote === null ? null : (quote.quote?.credits ?? quote.priceCredits);
  const shortfall =
    quote === null || price === null
      ? 0n
      : BigInt(price) - BigInt(quote.available) > 0n
        ? BigInt(price) - BigInt(quote.available)
        : 0n;

  return (
    <div className="flex flex-col gap-5">
      <Steps current={step} />

      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {phase.kind === "files" ? (
        <ProcessingNotice>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Panel
              title={
                mode === "setup" ? "Upload trial balances" : "Upload this month's files"
              }
              icon="upload"
              description={
                mode === "setup"
                  ? "Include every month you want in the MIS. Files are encrypted when they arrive and deleted after processing."
                  : "Include the new month. Files are encrypted when they arrive and deleted after processing."
              }
            >
              <FileDropZone
                title={
                  mode === "setup"
                    ? "Drag your trial balances here"
                    : "Drag this month's trial balance here"
                }
                hint="Any format from any accounting software: Excel, CSV, PDF, text or HTML exports. Extra sheets are fine."
                inputLabel="Choose files"
                disabled={busy}
                busy={uploading}
                onFiles={onFiles}
                testId="job-drop"
              />
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
                        <Th />
                      </>
                    }
                  >
                    {files.map((f) => (
                      <Tr key={f.key}>
                        <Td className="font-medium text-neutral-900">
                          {f.name}
                          {f.problem === null ? null : (
                            <span
                              className="mt-0.5 block text-[0.75rem] font-normal text-warning"
                              data-testid="job-file-problem"
                            >
                              {f.problem}
                            </span>
                          )}
                          {f.progress < 1 ? (
                            <span className="mt-1 block h-1 w-40 overflow-hidden rounded-full bg-neutral-100">
                              <span
                                className="block h-full rounded-full bg-accent-500 transition-[width]"
                                style={{
                                  width: `${(f.progress * 100).toFixed(0)}%`,
                                }}
                              />
                            </span>
                          ) : null}
                        </Td>
                        <Td numeric>
                          {Math.ceil(f.size / 1024).toLocaleString("en-IN")} KB
                        </Td>
                        <Td numeric>{f.sheets ?? "–"}</Td>
                        <Td numeric>
                          {f.rows === null ? "–" : formatCount(f.rows.toString())}
                        </Td>
                        <Td className="text-right">
                          <button
                            type="button"
                            aria-label={`Remove ${f.name}`}
                            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                            onClick={() => {
                              remove(f);
                            }}
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </Td>
                      </Tr>
                    ))}
                  </DataTable>
                </div>
              )}
              {mode === "setup" ? (
                <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-25 p-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[0.8125rem] font-medium text-neutral-800">
                      Your current MIS workbook (optional)
                    </span>
                    <span className="text-[0.75rem] text-neutral-500">
                      We recreate its layout. Only the layout is used; every figure comes
                      from your trial balances.
                    </span>
                  </div>
                  <div className="mt-3">
                    <FileDropZone
                      compact
                      multiple={false}
                      title="Drag your current MIS here"
                      hint="Any spreadsheet or PDF of it."
                      inputLabel="Choose reference MIS"
                      disabled={busy}
                      busy={(reference?.progress ?? 1) < 1}
                      onFiles={onReference}
                    />
                  </div>
                  {reference === null || reference.progress < 1 ? null : (
                    <p
                      className="mt-2 flex items-center gap-1.5 text-[0.8125rem] text-neutral-700"
                      data-testid="job-reference"
                    >
                      <Icon
                        name={reference.problem === null ? "check" : "alert"}
                        size={14}
                        className={
                          reference.problem === null ? "text-positive" : "text-warning"
                        }
                      />
                      {reference.name} ·{" "}
                      {Math.ceil(reference.size / 1024).toLocaleString("en-IN")} KB
                      {reference.problem === null
                        ? ` · ${(reference.sheets ?? 0).toString()} sheets`
                        : ` · ${reference.problem}`}
                    </p>
                  )}
                </div>
              ) : null}
            </Panel>

            {/*
              The SPEC §12 confirmation, beside the files. Everything the spec requires is
              here, and nothing is held or charged until the one button is pressed.
            */}
            <Panel
              title="Ready to run"
              icon="wallet"
              padding="none"
              className="lg:sticky lg:top-7"
            >
              {files.length === 0 ? (
                <p className="px-5 pb-5 text-[0.8125rem] text-neutral-500">
                  Add your files and the price appears here. You confirm it before
                  anything is charged.
                </p>
              ) : readyIds.length === 0 && !uploading ? (
                <p className="px-5 pb-5 text-[0.8125rem] text-neutral-500">
                  None of these files can be used. Add a trial balance export.
                </p>
              ) : quote === null ? (
                <p className="flex items-center gap-2 px-5 pb-5 text-[0.8125rem] text-neutral-500">
                  <Icon
                    name="loader"
                    size={14}
                    className="animate-spin [animation-duration:1.6s]"
                  />
                  {uploading
                    ? "Uploading your files…"
                    : quoting
                      ? "Working out the price…"
                      : "Reading your files…"}
                </p>
              ) : (
                <>
                  <dl
                    className="grid grid-cols-2 gap-y-2 px-5 pb-4 text-[0.8125rem]"
                    data-testid="job-price"
                  >
                    <dt className="text-neutral-500">Action</dt>
                    <dd className="text-right font-medium">
                      {ACTION_LABELS[quote.type]}
                    </dd>
                    <dt className="text-neutral-500">Intelligence tier</dt>
                    <dd className="text-right font-medium">{TIER_LABELS[tier]}</dd>
                    <dt className="text-neutral-500">Delivery</dt>
                    <dd className="text-right font-medium">
                      {DELIVERY_LABELS[delivery]}
                    </dd>
                    <dt className="border-t border-neutral-100 pt-2.5 font-semibold text-neutral-900">
                      {quote.quote === null ? "Price" : "Quote"}
                    </dt>
                    <dd className="num border-t border-neutral-100 pt-2.5 text-[1.25rem] leading-none font-semibold">
                      {formatCredits(price ?? "0")}
                    </dd>
                    <dt className="text-neutral-500">Available now</dt>
                    <dd className="num">{formatCredits(quote.available)}</dd>
                    <dt className="text-neutral-500">Available after</dt>
                    <dd className="num">
                      {formatCredits(
                        (BigInt(quote.available) - BigInt(price ?? "0")).toString(),
                      )}
                    </dd>
                  </dl>

                  <div className="flex flex-col gap-3 border-t border-neutral-100 bg-neutral-25 p-5">
                    {quote.restructure ? (
                      <Alert tone="warning" title="Structure has changed">
                        This month&rsquo;s files are laid out differently from last time,
                        so the restructure price applies.
                      </Alert>
                    ) : null}
                    {quote.quote === null ? null : (
                      <Alert tone="warning" title="A quote was needed">
                        This job needs more analysis than the standard price covers. The
                        quote holds until{" "}
                        {new Date(quote.quote.expiresAt).toLocaleString("en-IN")}.
                      </Alert>
                    )}
                    {shortfall > 0n ? (
                      <BuyCreditsInline
                        need={shortfall}
                        businessName={businessName}
                        onCredited={() => {
                          priced.current.clear();
                          setQuote(null);
                          setRepriceAt(Date.now());
                        }}
                      />
                    ) : (
                      <Button
                        onClick={() => void run(quote)}
                        size="lg"
                        className="w-full"
                        disabled={busy || uploading}
                      >
                        {starting
                          ? "Starting…"
                          : `${mode === "setup" ? "Run setup" : "Run refresh"} — ${formatCredits(price ?? "0")} credits`}
                      </Button>
                    )}
                    <p className="text-[0.75rem] text-neutral-500">
                      Credits are held when you press this and charged only when the
                      workbook is delivered.
                    </p>
                  </div>
                </>
              )}

              <div className="border-t border-neutral-100 px-5 py-3">
                <button
                  type="button"
                  aria-expanded={showOptions}
                  onClick={() => {
                    setShowOptions((v) => !v);
                  }}
                  className="flex w-full items-center justify-between text-[0.8125rem] font-medium text-neutral-600 hover:text-neutral-900"
                >
                  Options
                  <Icon
                    name="chevron-down"
                    size={15}
                    className={showOptions ? "rotate-180" : ""}
                  />
                </button>
                {showOptions ? (
                  <div className="mt-4 flex flex-col gap-4">
                    <SelectField
                      id="job-tier"
                      label="Intelligence tier"
                      value={tier}
                      hint="Professional suits most books. A higher tier reasons harder on unfamiliar ledgers; it never changes a figure."
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
                      hint="Instant runs now. Standard queues it and emails you when it is ready, for fewer credits."
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
                  </div>
                ) : null}
              </div>
            </Panel>
          </div>
        </ProcessingNotice>
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
              {STEP_LABELS[phase.step] ?? "Working"}…
            </p>
          </div>
          <p className="mt-2 text-[0.8125rem] text-neutral-500">
            This usually takes under a minute. You can keep this tab open to collect the
            workbook.
          </p>
        </Panel>
      ) : null}

      {phase.kind === "done" || phase.kind === "failed" ? (
        <Notices notices={phase.outcome.notices} />
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
                    {formatCredits(phase.outcome.capturedCredits)} credits charged
                  </span>
                  .{" "}
                  {warningsOf(phase.outcome.checks).length === 0
                    ? "Every figure was checked against its source."
                    : "Every figure traces to its source; a few things in the data are worth a look."}
                </p>
              </div>
            </div>
            {phase.outcome.outputId === null ? null : (
              <a
                className="inline-flex h-10 items-center gap-2 rounded-md bg-accent-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-accent-700"
                href={`/api/outputs/${phase.outcome.outputId}`}
                data-testid="job-download"
              >
                <Icon name="download" size={16} />
                Download {phase.outcome.fileName}
              </a>
            )}
          </div>
          {warningsOf(phase.outcome.checks).length === 0 ? null : (
            <div className="px-5 pt-4" data-testid="job-warnings">
              <Alert
                tone="warning"
                title={`${warningsOf(phase.outcome.checks).length.toString()} ${
                  warningsOf(phase.outcome.checks).length === 1 ? "thing" : "things"
                } to check in your data`}
              >
                <ul className="mt-1 flex flex-col gap-1.5">
                  {warningsOf(phase.outcome.checks).map((c) => (
                    <li key={c.id}>
                      {c.message}
                      {c.fix === "" ? null : (
                        <span className="block text-[0.75rem] opacity-80">{c.fix}</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[0.75rem]">
                  The workbook is complete and these are listed on its checks sheet too.
                </p>
              </Alert>
            </div>
          )}
          <ChecksTable checks={phase.outcome.checks} />
        </Panel>
      ) : null}

      {phase.kind === "failed" ? (
        <Panel title="The job could not be completed" icon="alert" padding="none">
          <div className="flex flex-col gap-3 px-5 pb-5">
            <Alert tone="error">
              {phase.outcome.message ?? "The job stopped unexpectedly."}
            </Alert>
            <p className="text-sm text-neutral-700" data-testid="job-failed">
              {phase.outcome.capturedCredits === "0"
                ? "No credits were charged."
                : `${formatCredits(phase.outcome.capturedCredits)} credits were charged for the diagnostic.`}
            </p>
          </div>
          <ChecksTable checks={phase.outcome.checks} />
        </Panel>
      ) : null}
    </div>
  );
}

const warningsOf = (checks: readonly Check[]) =>
  checks.filter((c) => c.status === "fail" && c.severity === "warning");

/** Anything the run assumed or left out, said plainly. */
function Notices({ notices }: { notices: readonly string[] }) {
  if (notices.length === 0) return null;
  return (
    <div data-testid="job-notices">
      <Alert tone="info">
        <ul className="flex flex-col gap-1">
          {notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Alert>
    </div>
  );
}

/** Where the run has got to. Each step is named, so the state is never a bare spinner. */
function Steps({ current }: { current: 1 | 2 | 3 }) {
  const labels = ["Load files", "Build", "Collect"] as const;
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

function ChecksTable({ checks }: { checks: readonly Check[] }) {
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
