"use client";

/**
 * Setup and refresh (SPEC §23), run on the server (ADR 0032).
 *
 * Three moments for the customer: add files, build, collect the workbook. Files upload in the
 * background as soon as they are dropped; one button holds the credits and starts the run, with no
 * price step in between (ADR 0033); and the server does everything else — recognition, mapping
 * with Claude, computation, checks and rendering — without stopping to ask. Only an estimate over
 * the AI cost cap stops to ask for a quote to be accepted (locked decision 6). What it had to assume or
 * could not match is said on the result, and data problems arrive as warnings on a delivered
 * workbook (ADR 0031). Before payment the page shows only file names, sizes, sheet counts and row
 * counts (SPEC §2.3).
 *
 * ADR 0091: the button carries its standard price and each tier says what it costs, so the press
 * is made knowing the number (still no step in between). A run already working — after a reload,
 * a second visit, or a dropped connection — is followed rather than replaced, and a run waiting on
 * its owner is answered here, so nothing is ever held or charged twice for the same files. Every
 * stop has a way back: a short wallet and a fresh quote can be left, a failed run tried again with
 * its files still listed.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { BuyCreditsInline } from "@/components/BuyCreditsInline";
import { ExportHelp } from "@/components/ExportHelp";
import { FileDropZone } from "@/components/FileDropZone";
import { Icon, type IconName } from "@/components/Icon";
import { PaidJobButton } from "@/components/PaidJobButton";
import { ProcessingNotice } from "@/components/ProcessingNotice";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  DataTable,
  Panel,
  Progress,
  SelectField,
  Td,
  Th,
  Tr,
  type BadgeTone,
} from "@/components/ui";
import { formatCount, formatCredits, TIER_LABELS, TIER_NOTES } from "@/lib/actions";
import { checkLines, type CheckSummary } from "@/lib/check-words";
import { api, newIdempotencyKey } from "@/lib/client-api";
import { fileSize, istLabelled, MONTHS_TO_ADD } from "@/lib/job-display";
import {
  acceptQuote,
  startPaidJob,
  type QuoteResult,
  type StartResult,
} from "@/lib/paid-job";
import { removeUpload, uploadFile } from "@/lib/uploads";

import type { RunAction, RunPrices } from "./run-context";

type Tier = keyof typeof TIER_LABELS;

interface Check {
  id: string;
  status: string;
  severity: string;
  message: string;
  fix: string;
}

interface RunOutcome {
  status: "completed" | "failed" | "needs_quote" | "needs_year";
  message: string | null;
  capturedCredits: string;
  outputId: string | null;
  fileName: string | null;
  checks: Check[];
  notices: string[];
  quoteCredits?: string;
  /** What happened to the dashboard after the run (ADR 0047). */
  dashboard?:
    | { status: "updated"; capturedCredits: string; first: boolean }
    | { status: "short" | "failed" };
  /** The month each year starts in, 1 to 12, when the run stopped to ask (ADR 0086). */
  year?: YearQuestion;
}

interface YearQuestion {
  files: number;
  company: number;
}

/** GET /api/jobs/:id, as much of it as following a run needs. */
interface JobStatus {
  state: string;
  /** A server run holds the job now (ADR 0091). */
  running?: boolean;
  capturedCredits: string | null;
  outputId: string | null;
  failure: { class: string; code: string | null; detail: string | null } | null;
  quote: { credits: string; expiresAt: string | null } | null;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const monthName = (m: number) => MONTHS[m - 1] ?? "";

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
  /** The upload itself failed (not the file): it can be retried as it is (ADR 0091). */
  failed: boolean;
}

/** Whether the file a failure was about is the likely cause, which decides the help offered. */
type Fault = "data" | "platform" | null;

type Phase =
  | { kind: "files" }
  /**
   * `live`: this page started the run and is waiting for its answer. `following`: the run was
   * already working when the page opened, so the page follows it by its status. `lost`: the
   * answer never arrived — a dropped connection or a gateway timeout — and the run, which does
   * not need the page, is followed by its status until it settles (ADR 0091).
   */
  | {
      kind: "running";
      jobId: string;
      step: string;
      contact: "live" | "following" | "lost";
    }
  | { kind: "year"; jobId: string; question: YearQuestion; notices: string[] }
  | { kind: "done"; jobId: string; outcome: RunOutcome }
  | {
      kind: "failed";
      jobId: string;
      outcome: RunOutcome;
      fault: Fault;
      /** The run never started, so pressing again runs the same job on the same hold. */
      rerun: boolean;
    };

const STEP_LABELS: Record<string, string> = {
  reserved: "Starting",
  quote_accepted: "Carrying on",
  preflight: "Opening your files",
  profiling: "Reading your files",
  classifying: "Recognising the reports",
  mapping: "Matching ledgers to MIS lines",
  awaiting_review: "Carrying on",
  computing: "Computing the figures",
  validating: "Checking every figure",
  rendering: "Building your workbook",
  completed: "Finishing",
};

const SETTLED_BADLY = new Set(["failed_data", "failed_platform", "cancelled", "expired"]);

const fileKey = (f: File) =>
  `${f.name}:${f.size.toString()}:${f.lastModified.toString()}`;

/** What a run that ended without delivering says, from its status rather than its answer. */
function failureOf(s: JobStatus): { message: string; fault: Fault } {
  const fault: Fault =
    s.failure?.class === "data_fault"
      ? "data"
      : s.failure?.class === "platform_fault"
        ? "platform"
        : null;
  if (s.failure?.code === "server_run" && s.failure.detail !== null)
    return { message: s.failure.detail, fault };
  if (s.state === "cancelled") return { message: "This run was cancelled.", fault };
  if (s.state === "expired")
    return { message: "This run was closed before it finished.", fault };
  return {
    message:
      fault === "data"
        ? "It stopped because of a problem in the uploaded files."
        : "It stopped because of a problem on our side.",
    fault,
  };
}

const outcomeOf = (
  status: RunOutcome["status"],
  message: string | null,
  s: JobStatus | null,
): RunOutcome => ({
  status,
  message,
  capturedCredits: s?.capturedCredits ?? "0",
  outputId: s?.outputId ?? null,
  fileName: null,
  checks: [],
  notices: [],
});

/** Stops a quote nobody accepted from waiting on the screen's next visit (ADR 0091). */
const cancelQuote = (quote: QuoteResult) => {
  // Only a quote raised before anything ran: cancelling a run paused part-way captures the
  // cancel-after-AI fee and throws its checkpoint away (ADR 0053), so that one is left to answer.
  if (quote.resumed === true) return;
  void api(`/api/jobs/${quote.jobId}/cancel`, {
    body: {},
    idempotencyKey: newIdempotencyKey(),
  });
};

export function JobRunner({
  companyId,
  mode,
  businessName,
  availableCredits,
  pendingQuote = null,
  pendingYear = null,
  liveRun = null,
  prices = null,
  blocked = null,
  conventions,
}: {
  companyId: string;
  mode: "setup" | "refresh";
  /** Shown on the payment sheet when a run is short of credits. */
  businessName: string;
  /** The wallet as the page loaded. Only used to say, gently and early, that it is empty. */
  availableCredits: string;
  /**
   * A run that paused for a quote, opened from the email about it or found on the company
   * (ADR 0086, ADR 0091). The quote is shown as it would have been on the screen that started
   * the run, and accepting it carries the run on from where it stopped.
   */
  pendingQuote?: {
    jobId: string;
    credits: string;
    expiresAt: string | null;
    resumed: boolean;
  } | null;
  /** A run waiting on the year question, from its email or found on the company (ADR 0086). */
  pendingYear?: { jobId: string; question: YearQuestion } | null;
  /** A run working on the server as the page opened: followed, never started again (ADR 0091). */
  liveRun?: { jobId: string; state: string } | null;
  /** The standard price of each choice, read on the server; null says no price (ADR 0091). */
  prices?: RunPrices | null;
  /** Why the button cannot be pressed yet, from outside the runner: unsaved conventions. */
  blocked?: string | null;
  /**
   * The company's conventions as they stand, sent back whole when the owner changes only the
   * year: the conventions are written by their own settings call and by nothing else.
   */
  conventions: { currency: string; numberFormat: string; dateOrder: string };
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [reference, setReference] = useState<FileEntry | null>(null);
  const [tier, setTier] = useState<Tier>("professional");
  // A file is processed when it is added (ADR 0050): there is no "queue it for later" to choose.
  const [phase, setPhase] = useState<Phase>(
    liveRun !== null
      ? {
          kind: "running",
          jobId: liveRun.jobId,
          step: liveRun.state,
          contact: "following",
        }
      : pendingYear === null
        ? { kind: "files" }
        : { kind: "year", ...pendingYear, notices: [] },
  );
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState<Exclude<StartResult, { kind: "held" }> | null>(
    pendingQuote === null || liveRun !== null ? null : { kind: "quote", ...pendingQuote },
  );
  const [starting, setStarting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  /** The file whose delete is being confirmed: a kept file is gone for good (ADR 0047). */
  const [confirming, setConfirming] = useState<string | null>(null);
  const router = useRouter();
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  // The browser's own files, kept for a retry, and a way to stop each upload in flight.
  const sources = useRef(new Map<string, File>());
  const uploads = useRef(new Map<string, AbortController>());
  const root = useRef<HTMLDivElement>(null);

  // Read through a function so each check is a fresh read of the ref, not a narrowed constant.
  const stopTimers = () => {
    if (heartbeat.current !== null) clearInterval(heartbeat.current);
    if (poll.current !== null) clearInterval(poll.current);
    heartbeat.current = null;
    poll.current = null;
  };
  useEffect(() => stopTimers, []);

  /*
   * Each step's heading takes the focus when the step arrives (ADR 0091). Pressing the button
   * removed the focused control from the page, so a keyboard was dropped at the top of the
   * document and a screen reader heard nothing when the run finished.
   */
  const shown = useRef(phase.kind);
  useEffect(() => {
    if (shown.current === phase.kind) return;
    shown.current = phase.kind;
    root.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus();
  }, [phase.kind]);

  const patch = (key: string, change: Partial<FileEntry>) => {
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...change } : f)));
  };

  /** Upload one file into its row: progress, then counts, a refusal, or a failure to retry. */
  const send = async (key: string, f: File) => {
    const control = new AbortController();
    uploads.current.set(key, control);
    const r = await uploadFile(
      companyId,
      f,
      (fraction) => {
        patch(key, { progress: fraction });
      },
      control.signal,
    );
    uploads.current.delete(key);
    if (!r.ok) {
      // Removed while uploading: the row is already gone and the upload deleted.
      if (r.cancelled === true) return;
      patch(key, { problem: r.message, progress: 1, failed: true });
      return;
    }
    patch(key, {
      progress: 1,
      uploadId: r.file.refused === null ? r.file.uploadId : null,
      sheets: r.file.sheets,
      rows: r.file.rows,
      problem: r.file.refused,
      failed: false,
    });
  };

  const onFiles = async (list: File[]) => {
    setError(null);
    // A file already read is not added twice; one that failed or was refused is replaced by the
    // new copy, rather than the drop being silently ignored (ADR 0091).
    const fresh = list.filter(
      (f) => !files.some((e) => e.key === fileKey(f) && e.problem === null),
    );
    const replaced = new Set(fresh.map(fileKey));
    for (const f of fresh) sources.current.set(fileKey(f), f);
    setFiles((prev) => [
      ...prev.filter((e) => !replaced.has(e.key)),
      ...fresh.map((f) => ({
        key: fileKey(f),
        name: f.name,
        size: f.size,
        progress: 0,
        uploadId: null,
        sheets: null,
        rows: null,
        problem: null,
        failed: false,
      })),
    ]);
    // Uploads run one after another so a large batch does not saturate the connection.
    for (const f of fresh) await send(fileKey(f), f);
  };

  const retry = (entry: FileEntry) => {
    const f = sources.current.get(entry.key);
    if (f === undefined) return;
    patch(entry.key, { problem: null, failed: false, progress: 0 });
    void send(entry.key, f);
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
      failed: false,
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
        : { ...entry, progress: 1, problem: r.message, failed: true },
    );
  };

  /**
   * Take a file off the list. One still uploading is stopped and whatever arrived is deleted; one
   * that arrived is a kept file, deleted for good, so that is asked first (ADR 0091).
   */
  const remove = (entry: FileEntry) => {
    const inFlight = uploads.current.get(entry.key);
    if (inFlight !== undefined) {
      inFlight.abort();
      uploads.current.delete(entry.key);
    } else if (entry.uploadId !== null && confirming !== entry.key) {
      setConfirming(entry.key);
      return;
    } else if (entry.uploadId !== null) {
      // A delete the server refused leaves the file kept; the row still goes from this run.
      removeUpload(entry.uploadId).catch(() => undefined);
    }
    setConfirming(null);
    sources.current.delete(entry.key);
    setFiles((list) => list.filter((f) => f.key !== entry.key));
  };

  const uploading = files.some((f) => f.progress < 1) || (reference?.progress ?? 1) < 1;
  const readyIds = files.flatMap((f) => (f.uploadId === null ? [] : [f.uploadId]));
  const referenceId = reference?.uploadId ?? null;
  const jobType: RunAction =
    mode === "refresh"
      ? "monthly_refresh"
      : referenceId === null
        ? "company_setup"
        : "reference_mis_recreate";
  const priceAt = (t: Tier): string | null => prices?.run[jobType]?.[t] ?? null;
  const price = priceAt(tier);
  const firstDashboard = prices?.firstDashboard ?? mode === "setup";

  // Leaving while a file uploads abandons it; the run itself does not need the page (below).
  useEffect(() => {
    if (!uploading) return;
    const stay = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", stay);
    return () => {
      window.removeEventListener("beforeunload", stay);
    };
  }, [uploading]);

  /** Settle the screen from a run's status, once it says something the screen can act on. */
  const settleFrom = useCallback(
    (jobId: string, s: JobStatus) => {
      if (s.running === true) {
        setPhase((cur) =>
          cur.kind === "running" && cur.jobId === jobId ? { ...cur, step: s.state } : cur,
        );
        return;
      }
      if (s.state === "completed") {
        setPhase({ kind: "done", jobId, outcome: outcomeOf("completed", null, s) });
        return;
      }
      if (SETTLED_BADLY.has(s.state)) {
        const { message, fault } = failureOf(s);
        setPhase({
          kind: "failed",
          jobId,
          outcome: outcomeOf("failed", message, s),
          fault,
          rerun: false,
        });
        return;
      }
      if (s.state === "needs_quote" && s.quote !== null) {
        setStopped({
          kind: "quote",
          jobId,
          credits: s.quote.credits,
          expiresAt: s.quote.expiresAt,
          resumed: true,
        });
        setPhase({ kind: "files" });
        return;
      }
      // Stopped on the year question: the page that asks it reads the question from the run.
      if (s.state === "awaiting_review") {
        window.location.assign(`/app/companies/${companyId}/run?job=${jobId}`);
        return;
      }
      // Held but never started — its request was refused before it ran. The same job can be run.
      if (s.state === "reserved") {
        setPhase({
          kind: "failed",
          jobId,
          outcome: outcomeOf(
            "failed",
            "The run did not start. Nothing has been charged.",
            s,
          ),
          fault: null,
          rerun: true,
        });
        return;
      }
      // Anything else is a run part-way with nobody holding it. It is not called a failure from
      // here: it is settled on the server, and the email says how.
      setPhase((cur) =>
        cur.kind === "running" && cur.jobId === jobId
          ? { ...cur, step: s.state, contact: "lost" }
          : cur,
      );
    },
    [companyId],
  );

  // A run this page is not waiting on an answer from is followed by its status.
  const following =
    phase.kind === "running" && phase.contact !== "live" ? phase.jobId : null;
  useEffect(() => {
    if (following === null) return;
    let gone = false;
    const look = async () => {
      const s = await api<JobStatus>(`/api/jobs/${following}`);
      if (!gone && s.ok) settleFrom(following, s.data);
    };
    void look();
    // As often as the live label polls, and for the same reason (ADR 0054).
    const timer = setInterval(() => void look(), 4000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [following, settleFrom]);

  /**
   * Run a job whose credits are held, and show what it came to. Also how a run waiting on the
   * year question carries on (ADR 0086): the same job, the same hold, nothing charged twice.
   */
  const runHeld = useCallback(
    async (jobId: string, body: { keepYear?: boolean } = {}) => {
      const job = { jobId };
      setPhase({ kind: "running", jobId: job.jobId, step: "reserved", contact: "live" });
      heartbeat.current = setInterval(
        () => void api(`/api/jobs/${job.jobId}/heartbeat`, { body: {} }),
        60_000,
      );
      poll.current = setInterval(() => {
        void api<{ state: string }>(`/api/jobs/${job.jobId}`).then((s) => {
          if (s.ok)
            setPhase((cur) =>
              cur.kind === "running" && cur.jobId === job.jobId
                ? { ...cur, step: s.data.state }
                : cur,
            );
        });
        // Four seconds, not one and a half (ADR 0054). This only moves a progress label, and it
        // runs for the whole length of a run that may take minutes: at 1.5 s a five-minute run
        // spent two hundred function invocations on it, each able to wake a cold instance and
        // open its own pool. The label is no less useful for arriving a moment later.
      }, 4000);
      const r = await api<RunOutcome>(`/api/jobs/${job.jobId}/run`, { body });
      stopTimers();
      if (!r.ok) {
        /*
         * No answer is not a failed run (ADR 0091). The run is one request of up to five minutes
         * and it does not need this page: a dropped connection or a gateway timeout leaves it
         * working, and it captures its credits and emails when it delivers. Saying "No credits
         * were charged" here invited a second run beside it. Only a refusal is an answer; a
         * second press of a run already working is followed, like any other.
         */
        const refused = r.status >= 400 && r.status < 500 && r.status !== 408;
        if (!refused || r.status === 409) {
          setPhase((cur) =>
            cur.kind === "running" && cur.jobId === job.jobId
              ? { ...cur, contact: r.status === 409 ? "following" : "lost" }
              : { kind: "running", jobId: job.jobId, step: "reserved", contact: "lost" },
          );
          return;
        }
        const s = await api<JobStatus>(`/api/jobs/${job.jobId}`);
        const status = s.ok ? s.data : null;
        setPhase({
          kind: "failed",
          jobId: job.jobId,
          outcome: outcomeOf("failed", r.message, status),
          fault: null,
          rerun: status?.state === "reserved" && status.running !== true,
        });
        return;
      }
      if (r.data.status === "needs_quote" && r.data.quoteCredits !== undefined) {
        // Part-way through, the work turned out to need more analysis than the standard price
        // covers (locked decision 6). Nothing was charged and nothing is lost: accepting the
        // quote resumes from the stage it stopped at, and a short wallet is topped up in place.
        setStopped({
          kind: "quote",
          jobId: job.jobId,
          credits: r.data.quoteCredits,
          expiresAt: null,
          resumed: true,
        });
        setPhase({ kind: "files" });
        return;
      }
      if (r.data.status === "needs_year" && r.data.year !== undefined) {
        setPhase({
          kind: "year",
          jobId: job.jobId,
          question: r.data.year,
          notices: r.data.notices,
        });
        return;
      }
      if (r.data.status === "completed") {
        setPhase({ kind: "done", jobId: job.jobId, outcome: r.data });
        return;
      }
      setPhase({
        kind: "failed",
        jobId: job.jobId,
        outcome: r.data,
        fault: null,
        rerun: false,
      });
      // Whether the files were the cause decides the help offered; the status knows.
      void api<JobStatus>(`/api/jobs/${job.jobId}`).then((s) => {
        if (!s.ok) return;
        const { fault } = failureOf(s.data);
        setPhase((cur) =>
          cur.kind === "failed" && cur.jobId === job.jobId ? { ...cur, fault } : cur,
        );
      });
    },
    [],
  );

  const follow = useCallback(
    async (started: StartResult) => {
      if (started.kind !== "held") {
        setStopped(started);
        return;
      }
      setStopped(null);
      await runHeld(started.jobId);
    },
    [runHeld],
  );

  const start = async () => {
    setError(null);
    setStarting(true);
    let started: StartResult;
    try {
      started = await startPaidJob({
        companyId,
        type: jobType,
        tier,
        uploadIds: readyIds,
        referenceUploadId: referenceId,
      });
    } finally {
      setStarting(false);
    }
    await follow(started);
  };

  /**
   * A different tier is a different price, so whatever the old one stopped on no longer applies
   * (ADR 0091): a short wallet or a quote raised up front is cleared and the button comes back.
   * A run that paused part-way keeps the tier it started on, and its quote is still the answer.
   */
  const changeTier = (next: Tier) => {
    setTier(next);
    if (stopped === null) return;
    const quote =
      stopped.kind === "quote"
        ? stopped
        : stopped.kind === "short"
          ? (stopped.quote ?? null)
          : null;
    if (quote?.resumed === true) {
      setStopped(quote);
      return;
    }
    if (quote !== null) cancelQuote(quote);
    setStopped(null);
  };

  const busy = phase.kind === "running" || starting;
  const ready = readyIds.length > 0 && !uploading;
  const pausedQuote = stopped?.kind === "quote" && stopped.resumed === true;
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const sentBytes = files.reduce((n, f) => n + f.size * f.progress, 0);
  const arrived = files.filter((f) => f.progress >= 1).length;

  return (
    <div className="flex flex-col gap-5" ref={root}>
      {error === null ? null : (
        <Alert tone="error">
          <WithSupport text={error} />
        </Alert>
      )}

      {phase.kind === "files" ? (
        <ProcessingNotice>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Panel
              title={mode === "setup" ? "Add your files" : "Add a file"}
              icon="upload"
              description={
                mode === "setup"
                  ? `${MONTHS_TO_ADD} Each file is encrypted under this company's own key as it arrives, and kept for you until you delete it.`
                  : "One file or many: a new month, or more detail for one you have. Each is encrypted under this company's own key as it arrives, and kept for you until you delete it."
              }
            >
              <FileDropZone
                title={mode === "setup" ? "Drag your files here" : "Drag a file here"}
                hint="Raw data in any format from any accounting software: Excel, CSV, PDF, text or HTML. Extra sheets are fine."
                inputLabel="Choose files"
                disabled={busy}
                busy={uploading}
                onFiles={onFiles}
                testId="job-drop"
              />
              {/* What to export, where the question comes up (ADR 0087). */}
              <div className="mt-3">
                <ExportHelp />
              </div>
              {uploading && files.length > 1 ? (
                <div
                  className="mt-4 flex flex-col gap-1.5"
                  data-testid="job-upload-total"
                >
                  <p className="text-[0.8125rem] text-neutral-600">
                    Uploading {arrived.toString()} of {files.length.toString()} files ·{" "}
                    {fileSize(totalBytes)}. Leaving this page now stops the uploads.
                  </p>
                  <Progress
                    value={Math.floor(sentBytes)}
                    max={totalBytes}
                    label="All files uploading"
                  />
                </div>
              ) : null}
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
                              <WithSupport text={f.problem} />
                            </span>
                          )}
                          {f.progress < 1 ? (
                            <span className="mt-1 flex w-48 items-center gap-2">
                              <Progress
                                value={Math.floor(f.progress * 100)}
                                label={`Uploading ${f.name}`}
                              />
                              <span className="num text-[0.6875rem] font-normal text-neutral-500">
                                {Math.floor(f.progress * 100).toString()}%
                              </span>
                            </span>
                          ) : null}
                        </Td>
                        <Td numeric>{fileSize(f.size)}</Td>
                        <Td numeric>{f.sheets ?? "–"}</Td>
                        <Td numeric>
                          {f.rows === null ? "–" : formatCount(f.rows.toString())}
                        </Td>
                        <Td className="text-right whitespace-nowrap">
                          {confirming === f.key ? (
                            <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-normal text-neutral-600">
                              Delete it for good?
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => {
                                  remove(f);
                                }}
                              >
                                Delete
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setConfirming(null);
                                }}
                              >
                                Keep
                              </Button>
                            </span>
                          ) : (
                            <>
                              {f.failed ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon="refresh"
                                  disabled={busy}
                                  onClick={() => {
                                    retry(f);
                                  }}
                                >
                                  Retry
                                </Button>
                              ) : null}
                              <button
                                type="button"
                                aria-label={`Remove ${f.name}`}
                                className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                                onClick={() => {
                                  remove(f);
                                }}
                              >
                                <Icon name="close" size={14} />
                              </button>
                            </>
                          )}
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
                      {reference.name} · {fileSize(reference.size)}
                      {reference.problem === null
                        ? ` · ${(reference.sheets ?? 0).toString()} sheets`
                        : ` · ${reference.problem}`}
                    </p>
                  )}
                </div>
              ) : null}
            </Panel>

            {/*
              One button holds the credits and starts the run (ADR 0033). Nothing is held or
              charged before it is pressed, and an unused hold is released.
            */}
            <Panel padding="none" className="lg:sticky lg:top-7">
              <div className="px-5 pt-5">
                <StepHeading icon="play">
                  {mode === "setup" ? "Build the MIS" : "Update the MIS"}
                </StepHeading>
              </div>
              <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
                <p className="text-[0.8125rem] leading-relaxed text-neutral-500">
                  {files.length === 0
                    ? "Add your files. We read every sheet, match every ledger and check every figure — nothing to map by hand."
                    : readyIds.length === 0 && !uploading
                      ? "None of these files can be used. Add a trial balance exported from the accounting software; Which file do I export? says how."
                      : uploading
                        ? "Uploading your files…"
                        : `${readyIds.length.toString()} ${readyIds.length === 1 ? "file" : "files"} ready.`}
                </p>
                {stopped?.kind === "quote" ? (
                  <Alert
                    tone="warning"
                    title={
                      stopped.resumed === true
                        ? "Paused: this one needs a little more"
                        : "This run needs a quote"
                    }
                  >
                    {stopped.resumed === true
                      ? "Your files took more analysis than the standard price covers, so the run paused rather than overspend. Nothing has been charged, and nothing is lost: it carries on from where it stopped for "
                      : "It needs more analysis than the standard price covers: "}
                    <strong className="tabular-nums" data-testid="job-quote">
                      {formatCredits(stopped.credits)}
                    </strong>{" "}
                    credits
                    {stopped.expiresAt === null
                      ? "."
                      : `, held until ${istLabelled(new Date(stopped.expiresAt))}.`}
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setStarting(true);
                          const quote = stopped;
                          void acceptQuote(quote.jobId, quote.credits)
                            .then(async (result) => {
                              if (result.kind === "short")
                                setStopped({ ...result, quote });
                              else await follow(result);
                            })
                            .finally(() => {
                              setStarting(false);
                            });
                        }}
                      >
                        {stopped.resumed === true
                          ? "Accept and carry on"
                          : "Accept and run"}
                      </Button>
                      {stopped.resumed === true ? null : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => {
                            cancelQuote(stopped);
                            setStopped(null);
                          }}
                        >
                          Not now
                        </Button>
                      )}
                    </div>
                  </Alert>
                ) : stopped?.kind === "short" ? (
                  <div className="flex flex-col gap-2">
                    <BuyCreditsInline
                      need={stopped.need}
                      businessName={businessName}
                      onCredited={() => {
                        // Back to the quote that was waiting, if there was one; else the button.
                        setStopped(stopped.quote ?? null);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="arrow-left"
                      onClick={() => {
                        setStopped(stopped.quote ?? null);
                      }}
                    >
                      {stopped.quote === undefined ? "Back" : "Back to the quote"}
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={() => void start()}
                    size="lg"
                    className="w-full"
                    icon={mode === "setup" ? "play" : "refresh"}
                    disabled={busy || !ready || blocked !== null}
                    data-testid="job-run"
                  >
                    {starting
                      ? "Starting…"
                      : `${mode === "setup" ? "Build my MIS" : "Update the MIS"}${
                          price === null ? "" : ` · ${formatCredits(price)} credits`
                        }`}
                  </Button>
                )}
                {blocked === null || stopped !== null ? null : (
                  <p
                    className="text-[0.75rem] font-medium text-warning"
                    data-testid="job-blocked"
                  >
                    {blocked}
                  </p>
                )}
                {stopped?.kind === "error" ? (
                  <Alert tone="error">
                    <WithSupport text={stopped.message} />
                  </Alert>
                ) : null}
                {/* Said early and quietly, not as a wall: files can be added either way, and
                    the top-up is offered in place when the button is pressed. */}
                {availableCredits === "0" && stopped === null ? (
                  <p
                    className="flex items-start gap-1.5 rounded-lg bg-accent-50/70 px-3 py-2 text-[0.75rem] leading-relaxed text-neutral-700"
                    data-testid="job-empty-wallet"
                  >
                    <Icon
                      name="wallet"
                      size={13}
                      className="mt-0.5 shrink-0 text-accent-600"
                    />
                    <span>
                      Your wallet is empty. Add your files as usual: when you press the
                      button you can add credits right here, and nothing is lost.
                    </span>
                  </p>
                ) : null}
                {/* The price at the moment of choice (ADR 0091): what the button holds, and
                    what follows it. Still no step between the press and the run (ADR 0033). */}
                <p
                  className="text-[0.75rem] leading-relaxed text-neutral-500"
                  data-testid="job-price"
                >
                  {price === null || prices === null
                    ? "One press reads the files, builds the workbook and puts the figures on the dashboard. Credits are charged only for what is delivered."
                    : `Standard price at ${TIER_LABELS[tier]}: ${formatCredits(price)} credits, held when you press and charged only for what is delivered. The dashboard ${firstDashboard ? "it builds" : "update"} follows as its own action, ${formatCredits(prices.dashboard[tier])} credits.${
                        mode === "refresh" &&
                        prices.run.refresh_with_restructure !== undefined
                          ? ` A file laid out differently from last time is priced as a restructure, ${formatCredits(prices.run.refresh_with_restructure[tier])} credits.`
                          : ""
                      }`}
                </p>
              </div>

              <div className="border-t border-neutral-100 px-5 py-3">
                <button
                  type="button"
                  aria-expanded={showOptions}
                  aria-controls="job-tier-options"
                  onClick={() => {
                    setShowOptions((v) => !v);
                  }}
                  className="flex w-full items-center justify-between text-[0.8125rem] font-medium text-neutral-600 hover:text-neutral-900"
                >
                  <span>
                    Intelligence tier:{" "}
                    <span className="text-neutral-900">{TIER_LABELS[tier]}</span>
                  </span>
                  <Icon
                    name="chevron-down"
                    size={15}
                    className={showOptions ? "rotate-180" : ""}
                  />
                </button>
                {showOptions ? (
                  <div className="mt-4 flex flex-col gap-4" id="job-tier-options">
                    <SelectField
                      id="job-tier"
                      label="Intelligence tier"
                      value={tier}
                      disabled={pausedQuote}
                      hint={
                        pausedQuote
                          ? "This paused run keeps the tier it started on."
                          : `${TIER_NOTES[tier]} A tier never changes a figure.`
                      }
                      onChange={(e) => {
                        changeTier(e.target.value as Tier);
                      }}
                    >
                      {(Object.keys(TIER_LABELS) as Tier[]).map((k) => {
                        const p = priceAt(k);
                        return (
                          <option key={k} value={k}>
                            {TIER_LABELS[k]}
                            {p === null ? "" : ` — ${formatCredits(p)} credits`}
                          </option>
                        );
                      })}
                    </SelectField>
                  </div>
                ) : null}
              </div>
            </Panel>
          </div>
        </ProcessingNotice>
      ) : null}

      {phase.kind === "year" ? (
        <YearQuestionPanel
          question={phase.question}
          notices={phase.notices}
          onUseFiles={async () => {
            setError(null);
            // The owner's own change to the company, through its settings call (ADR 0035).
            const r = await api(`/api/companies/${companyId}`, {
              method: "PATCH",
              body: { ...conventions, fyStartMonth: phase.question.files },
              idempotencyKey: newIdempotencyKey(),
            });
            if (!r.ok) {
              setError(r.message);
              return;
            }
            await runHeld(phase.jobId);
          }}
          onKeep={async () => {
            setError(null);
            await runHeld(phase.jobId, { keepYear: true });
          }}
        />
      ) : null}

      {phase.kind === "running" ? (
        <Panel>
          <StepHeading icon="loader">
            {phase.contact === "lost" ? "Still working" : "Working"}
          </StepHeading>
          <div className="mt-4 flex items-center gap-3">
            <Icon
              name="loader"
              size={18}
              className="animate-spin text-accent-600 [animation-duration:1.6s]"
            />
            <p className="text-sm text-neutral-700" role="status" data-testid="job-step">
              {STEP_LABELS[phase.step] ?? "Working"}…
            </p>
          </div>
          {phase.contact === "lost" ? (
            <div className="mt-3" data-testid="job-lost">
              <Alert tone="warning" title="We lost contact with this run">
                It is still finishing on our side, and we will email you when it is done.
                This page keeps checking and shows the result here.{" "}
                <Link href={`/app/jobs/${phase.jobId}`} className="font-medium underline">
                  See where it is
                </Link>
              </Alert>
            </div>
          ) : null}
          {phase.contact === "following" ? (
            <p className="mt-2 text-[0.8125rem] text-neutral-600">
              This run was already working when the page opened, so the page follows it
              rather than starting another.
            </p>
          ) : null}
          {/* The run is one request the server carries to the end without the page (ADR 0032),
              and settling it emails and posts to the Inbox — so leaving is safe (ADR 0091). */}
          <p className="mt-2 text-[0.8125rem] text-neutral-500">
            You can leave this page: the run carries on without it, and we email you when
            it is done — it will be in your Inbox too. Most runs take a minute or two; a
            year of files can take up to five.
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
                <StepHeading large>
                  {phase.outcome.dashboard?.status === "updated"
                    ? "Done. It is on the dashboard."
                    : "Your MIS is ready"}
                </StepHeading>
                <p className="mt-0.5 text-[0.8125rem] text-neutral-500">
                  <span data-testid="job-done">
                    {formatCredits(phase.outcome.capturedCredits)} credits charged
                  </span>
                  .{" "}
                  {warningsOf(phase.outcome.checks).length === 0
                    ? "Every figure was checked against its source."
                    : "Every figure traces to its source; a few things in the data are worth a look."}
                </p>
                {phase.outcome.dashboard === undefined ? null : (
                  <DashboardAfterRun
                    companyId={companyId}
                    update={phase.outcome.dashboard}
                    first={firstDashboard}
                    price={prices?.dashboard[tier] ?? null}
                  />
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {phase.outcome.outputId === null ? null : (
                <a
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-neutral-200 bg-surface px-4 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50"
                  href={`/api/outputs/${phase.outcome.outputId}`}
                  data-testid="job-download"
                >
                  <Icon name="download" size={16} />
                  Download {phase.outcome.fileName ?? "the workbook"}
                </a>
              )}
              {/* The board is where the work goes on (ADR 0047): it is the primary way out. */}
              <Button
                iconAfter="arrow-right"
                onClick={() => {
                  router.push(`/app/companies/${companyId}`);
                  router.refresh();
                }}
                data-testid="job-open-workspace"
              >
                Open the dashboard
              </Button>
            </div>
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
          <CheckWords checks={phase.outcome.checks} showLook={false} />
        </Panel>
      ) : null}

      {phase.kind === "failed" ? (
        <Panel padding="none">
          <div className="px-5 pt-5">
            <StepHeading icon="alert">This run could not be finished</StepHeading>
          </div>
          <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
            <Alert tone="error">
              <WithSupport
                text={phase.outcome.message ?? "The run stopped unexpectedly."}
              />
            </Alert>
            <p className="text-sm text-neutral-700" data-testid="job-failed">
              {phase.outcome.capturedCredits === "0"
                ? phase.rerun
                  ? "Nothing has been charged, and trying again uses the credits already held for it."
                  : "No credits were charged."
                : `${formatCredits(phase.outcome.capturedCredits)} credits were charged for the analysis it had done.`}
            </p>
            {phase.fault === "data" ? <ExportHelp /> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                icon="refresh"
                data-testid="job-try-again"
                onClick={() => {
                  setStopped(null);
                  if (phase.rerun) void runHeld(phase.jobId);
                  else setPhase({ kind: "files" });
                }}
              >
                {phase.rerun || files.length === 0
                  ? "Try again"
                  : "Try again with these files"}
              </Button>
              {mode === "setup" && firstDashboard ? (
                <ButtonLink href="/app" variant="secondary">
                  Back to companies
                </ButtonLink>
              ) : (
                <ButtonLink href={`/app/companies/${companyId}`} variant="secondary">
                  Back to the dashboard
                </ButtonLink>
              )}
            </div>
          </div>
          <CheckWords checks={phase.outcome.checks} showLook />
        </Panel>
      ) : null}
    </div>
  );
}

/** A step's heading, which takes the focus when its step arrives (ADR 0091). */
function StepHeading({
  icon,
  large = false,
  children,
}: {
  icon?: IconName;
  large?: boolean;
  children: ReactNode;
}) {
  return (
    <h2
      tabIndex={-1}
      data-step-heading
      className={`flex items-center gap-2 font-semibold text-neutral-900 outline-none ${
        large ? "text-[1.0625rem]" : "text-[0.9375rem]"
      }`}
    >
      {icon === undefined ? null : (
        <Icon name={icon} size={16} className="text-neutral-400" />
      )}
      {children}
    </h2>
  );
}

/** A message that sends the customer to support says where support is (ADR 0091). */
function WithSupport({ text }: { text: string }) {
  return (
    <>
      {text}
      {/contact support/iu.test(text) ? (
        <>
          {" "}
          <Link href="/contact" className="font-medium underline">
            Open the contact page
          </Link>
        </>
      ) : null}
    </>
  );
}

/**
 * What became of the dashboard after the run (ADR 0047), worded by whether there was one yet
 * (ADR 0091): "press Refresh" sent a company with no board to a button it did not have. A short
 * wallet is topped up here, in place (ADR 0049), and the dashboard built or updated from here too.
 */
function DashboardAfterRun({
  companyId,
  update,
  first,
  price,
}: {
  companyId: string;
  update: NonNullable<RunOutcome["dashboard"]>;
  first: boolean;
  price: string | null;
}) {
  const [delivered, setDelivered] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (update.status === "updated")
    return (
      <p className="mt-0.5 text-[0.8125rem] text-neutral-500" data-testid="job-dashboard">
        {`The dashboard was ${update.first ? "built" : "updated"}: ${formatCredits(update.capturedCredits)} credits.`}
      </p>
    );
  const verb = first ? "built" : "updated";
  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="job-dashboard">
      <p className="text-[0.8125rem] text-neutral-600">
        {delivered
          ? `The dashboard was ${verb}.`
          : update.status === "short"
            ? `The dashboard was not ${verb}: there were not enough credits left for it. The workbook is yours either way; add credits and it is ${verb} from here.`
            : `The dashboard could not be ${verb} just now. The workbook is yours either way; try the dashboard again from here.`}
      </p>
      {problem === null ? null : <Alert tone="error">{problem}</Alert>}
      {delivered ? null : (
        <div className="max-w-xs">
          <PaidJobButton
            companyId={companyId}
            type={first ? "dashboard_addon" : "dashboard_refresh"}
            label={`${first ? "Build" : "Update"} the dashboard${
              price === null ? "" : ` · ${formatCredits(price)} credits`
            }`}
            busyLabel={first ? "Building…" : "Updating…"}
            icon="chart"
            onHeld={async (jobId) => {
              const r = await api(`/api/jobs/${jobId}/deliver-dashboard`, {
                body: {},
                idempotencyKey: newIdempotencyKey(),
              });
              if (r.ok) setDelivered(true);
              else setProblem(r.message);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The one question a run asks (ADR 0086). The files and the company disagree about when the year
 * starts, and building on the wrong one reads the first month of each year as the whole year, so
 * the run stops before computing, with the credits held, and either answer carries it on.
 */
function YearQuestionPanel({
  question,
  notices,
  onUseFiles,
  onKeep,
}: {
  question: YearQuestion;
  notices: readonly string[];
  onUseFiles: () => Promise<void>;
  onKeep: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const files = monthName(question.files);
  const company = monthName(question.company);
  const act = (f: () => Promise<void>) => () => {
    setBusy(true);
    void f().finally(() => {
      setBusy(false);
    });
  };
  return (
    <Panel>
      <StepHeading icon="calendar">One question before the MIS is built</StepHeading>
      <div className="mt-4 flex flex-col gap-4" data-testid="job-year">
        <p className="max-w-2xl text-sm leading-relaxed text-neutral-700">
          These files run a financial year that starts in <strong>{files}</strong>, but
          this company is set to start its year in <strong>{company}</strong>. Built on
          the wrong one, the year-to-date figures restart in the wrong month. Which is
          right?
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={act(onUseFiles)} data-testid="job-year-files">
            Use {files}, and change the company&rsquo;s year
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={act(onKeep)}
            data-testid="job-year-keep"
          >
            Keep the year starting in {company}
          </Button>
        </div>
        <p className="text-[0.75rem] leading-relaxed text-neutral-500">
          Nothing has been computed yet and answering does not charge again: the credits
          held for this run carry it on. The company&rsquo;s year can be changed later
          under Reporting conventions too.
        </p>
        <Notices notices={notices} />
      </div>
    </Panel>
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

/** The engine's statuses as `checkLines` reads them; a warning is something to look at. */
const SUMMARY_STATUS: Record<string, CheckSummary["status"]> = {
  pass: "pass",
  fail: "fail",
  warn: "fail",
  not_applicable: "not_applicable",
};

/**
 * The checks in plain words (ADR 0087's sentences, ADR 0091), with the engine's own list folded
 * under them: "V7 fail" told a customer nothing, and SPEC §32 keeps raw identifiers out of the UI
 * except where someone has asked for the detail.
 */
function CheckWords({
  checks,
  showLook,
}: {
  checks: readonly Check[];
  /** Whether to list what failed, which a delivered run already says as warnings above. */
  showLook: boolean;
}) {
  if (checks.length === 0) return null;
  const { passed, look } = checkLines(
    checks.flatMap((c) => {
      const status = SUMMARY_STATUS[c.status];
      return status === undefined
        ? []
        : [
            {
              id: c.id,
              status,
              severity: c.severity === "blocking" ? "blocking" : "warning",
            } satisfies CheckSummary,
          ];
    }),
  );
  return (
    <div className="px-5 py-4" data-testid="job-check-words">
      <p className="eyebrow">What was checked</p>
      <ul className="mt-2 grid gap-1.5 text-[0.8125rem] text-neutral-700 md:grid-cols-2">
        {showLook
          ? look.map((l) => (
              <li key={l.id} className="flex items-start gap-2">
                <Icon name="alert" size={13} className="mt-0.5 shrink-0 text-warning" />
                {l.text}
              </li>
            ))
          : null}
        {passed.map((text) => (
          <li key={text} className="flex items-start gap-2">
            <Icon name="check" size={13} className="mt-0.5 shrink-0 text-positive" />
            {text}
          </li>
        ))}
      </ul>
      <details className="mt-3">
        <summary className="cursor-pointer text-[0.8125rem] font-medium text-accent-700 hover:underline">
          See all checks
        </summary>
        <div className="mt-2">
          <ChecksTable checks={checks} />
        </div>
      </details>
    </div>
  );
}

const CHECK_TONE: Record<string, BadgeTone> = {
  pass: "positive",
  fail: "negative",
  warn: "warning",
  not_applicable: "muted",
};

const checkResult = (c: Check): string =>
  c.status === "pass"
    ? "Passed"
    : c.status === "not_applicable"
      ? "Not applicable"
      : c.status === "warn" || c.severity === "warning"
        ? "To look at"
        : "Failed";

function ChecksTable({ checks }: { checks: readonly Check[] }) {
  return (
    <DataTable
      testId="job-checks"
      className="pb-2"
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
            <Badge
              tone={
                c.status === "fail" && c.severity === "warning"
                  ? "warning"
                  : (CHECK_TONE[c.status] ?? "neutral")
              }
              dot
            >
              {checkResult(c)}
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
