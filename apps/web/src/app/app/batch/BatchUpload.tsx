"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { BuyCreditsInline } from "@/components/BuyCreditsInline";
import { FileDropZone } from "@/components/FileDropZone";
import { Icon } from "@/components/Icon";
import { ProcessingNotice } from "@/components/ProcessingNotice";
import {
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
import { formatCredits, TIER_LABELS, TIER_NOTES } from "@/lib/actions";
import { matchFile, type BatchCompany } from "@/lib/batch-match";
import { api } from "@/lib/client-api";
import { startPaidJob } from "@/lib/paid-job";
import { uploadFile } from "@/lib/uploads";

type Tier = keyof typeof TIER_LABELS;

interface Dropped {
  readonly key: string;
  readonly file: File;
  companyId: string | null;
  /** Whether the company was matched from the name, rather than chosen. */
  matched: boolean;
}

/** A file a company could not take, and why, in the words its refusal gave (ADR 0091). */
interface Refusal {
  readonly name: string;
  readonly reason: string;
}

type Outcome =
  | { kind: "waiting" }
  | { kind: "working"; step: string }
  | { kind: "done"; credits: string }
  | { kind: "attention"; message: string; href: string; refused?: readonly Refusal[] }
  | { kind: "failed"; message: string; refused?: readonly Refusal[] };

interface RunResult {
  status: "completed" | "failed" | "needs_quote" | "needs_year";
  message: string | null;
  capturedCredits: string;
}

/** GET /api/jobs/:id, as much of it as waiting out a lost connection needs. */
interface JobStatus {
  state: string;
  running?: boolean;
  capturedCredits: string | null;
  failure: { code: string | null; detail: string | null } | null;
}

const SETTLED_BADLY = new Set(["failed_data", "failed_platform", "cancelled", "expired"]);
const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const TONE: Record<Outcome["kind"], BadgeTone> = {
  waiting: "muted",
  working: "neutral",
  done: "positive",
  attention: "warning",
  failed: "negative",
};

/**
 * The batch itself (ADR 0087). Every file is matched to a company by its name and shown for the
 * person to confirm; nothing uploads until each file has a company. Then each company in turn is
 * uploaded to, held for and run — a short wallet is topped up in place and the batch carries on,
 * and anything that needs an answer (a quote, the financial year) is left on that company's own
 * page, linked from here.
 */
export function BatchUpload({
  companies,
  businessName,
  prices = null,
}: {
  companies: readonly BatchCompany[];
  businessName: string;
  /** A refresh's standard price at each tier, read on the server; null says nothing (ADR 0091). */
  prices?: Readonly<Record<Tier, string>> | null;
}) {
  const [files, setFiles] = useState<Dropped[]>([]);
  const [tier, setTier] = useState<Tier>("professional");
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [short, setShort] = useState<{ need: bigint; from: number } | null>(null);
  /*
   * A batch that has run is finished with (ADR 0091). Pressing the same button again uploaded and
   * charged every company a second time, the ones already done included; now the button starts a
   * new batch instead, with nothing carried over.
   */
  const [finished, setFinished] = useState(false);
  const order = useRef<string[]>([]);
  // What each company's files became, kept across a top-up: carrying on after a short wallet
  // starts its refresh with the files already uploaded, never a second copy of each (ADR 0087).
  const uploaded = useRef<Map<string, string[]>>(new Map());

  const name = (id: string) => companies.find((c) => c.id === id)?.name ?? "";
  const unassigned = files.filter((f) => f.companyId === null).length;
  const groups = [
    ...new Set(files.flatMap((f) => (f.companyId === null ? [] : [f.companyId]))),
  ];
  const set = (id: string, outcome: Outcome) => {
    setOutcomes((o) => ({ ...o, [id]: outcome }));
  };

  // The batch runs from this page, one company after another: leaving stops the ones not yet
  // started, so the browser asks first.
  useEffect(() => {
    if (!running) return;
    const stay = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", stay);
    return () => {
      window.removeEventListener("beforeunload", stay);
    };
  }, [running]);

  /**
   * No answer from a run is not a failed run (ADR 0091): it carries on without the page and
   * settles on its own. Its status is followed until it says how it ended, for as long as a run
   * may take.
   */
  const waitOut = async (companyId: string, jobId: string): Promise<JobStatus | null> => {
    set(companyId, { kind: "working", step: "Still finishing" });
    for (let i = 0; i < 100; i += 1) {
      await sleep(4000);
      const s = await api<JobStatus>(`/api/jobs/${jobId}`);
      if (s.ok && s.data.running !== true) return s.data;
    }
    return null;
  };

  /** One company: upload its files, hold its refresh and run it. False stops the batch. */
  const runOne = async (companyId: string): Promise<boolean> => {
    const mine = files.filter((f) => f.companyId === companyId);
    const kept = uploaded.current.get(companyId);
    const uploadIds: string[] = kept ?? [];
    const missed: Refusal[] = [];
    if (kept === undefined) {
      for (const [i, f] of mine.entries()) {
        set(companyId, {
          kind: "working",
          step: `Uploading ${String(i + 1)} of ${String(mine.length)}`,
        });
        const r = await uploadFile(companyId, f.file, () => undefined);
        if (r.ok && r.file.refused === null) uploadIds.push(r.file.uploadId);
        else
          missed.push({
            name: f.file.name,
            reason: r.ok ? (r.file.refused ?? "It could not be read.") : r.message,
          });
      }
      uploaded.current.set(companyId, uploadIds);
    }
    if (uploadIds.length === 0) {
      set(companyId, {
        kind: "failed",
        message: "None of its files could be read, so nothing was run or charged.",
        refused: missed,
      });
      return true;
    }
    // A refresh on part of what the person confirmed would be charged and look complete, so a
    // company with a file missing stops before anything is held; the files that did arrive are
    // kept, and its own page says why the others did not (ADR 0087).
    if (missed.length > 0) {
      uploaded.current.delete(companyId);
      set(companyId, {
        kind: "attention",
        // All of its files, on its page: that page runs only what is added there, so adding the
        // missing one alone would build the month on part of its files (ADR 0087, ADR 0091).
        message: `${missed.length === 1 ? "A file" : `${missed.length.toString()} files`} could not be added, so nothing was run or charged. Add all of this company's files together on its page.`,
        href: `/app/companies/${companyId}/run`,
        refused: missed,
      });
      return true;
    }
    set(companyId, { kind: "working", step: "Updating its MIS" });
    const started = await startPaidJob({
      companyId,
      type: "monthly_refresh",
      tier,
      uploadIds,
      referenceUploadId: null,
    });
    if (started.kind === "short") {
      set(companyId, { kind: "waiting" });
      setShort({ need: started.need, from: order.current.indexOf(companyId) });
      return false;
    }
    if (started.kind === "error") {
      set(companyId, { kind: "failed", message: started.message });
      return true;
    }
    const runPage = `/app/companies/${companyId}/run?job=${started.jobId}`;
    if (started.kind === "quote") {
      set(companyId, {
        kind: "attention",
        message:
          "Needs more analysis than its standard price: accept the quote on its page.",
        href: runPage,
      });
      return true;
    }
    const beat = setInterval(
      () => void api(`/api/jobs/${started.jobId}/heartbeat`, { body: {} }),
      60_000,
    );
    const r = await api<RunResult>(`/api/jobs/${started.jobId}/run`, { body: {} });
    clearInterval(beat);
    const refused = !r.ok && r.status >= 400 && r.status < 500 && r.status !== 408;
    if (!r.ok && !refused) {
      const s = await waitOut(companyId, started.jobId);
      if (s === null)
        set(companyId, {
          kind: "attention",
          message:
            "Still working after we lost contact: we will email you when it is done.",
          href: `/app/jobs/${started.jobId}`,
        });
      else if (s.state === "completed")
        set(companyId, { kind: "done", credits: s.capturedCredits ?? "0" });
      else if (s.state === "reserved")
        set(companyId, {
          kind: "failed",
          message:
            "Its run did not start, and nothing was charged. Add its files on its page.",
        });
      else if (SETTLED_BADLY.has(s.state))
        set(companyId, {
          kind: "failed",
          message:
            s.failure?.code === "server_run" && s.failure.detail !== null
              ? s.failure.detail
              : "The run stopped before it finished.",
        });
      else
        set(companyId, {
          kind: "attention",
          message: "It needs an answer: open its page to carry on.",
          href: runPage,
        });
    } else if (!r.ok) set(companyId, { kind: "failed", message: r.message });
    else if (r.data.status === "completed")
      set(companyId, { kind: "done", credits: r.data.capturedCredits });
    else if (r.data.status === "failed")
      set(companyId, { kind: "failed", message: r.data.message ?? "The run stopped." });
    else
      set(companyId, {
        kind: "attention",
        message:
          r.data.status === "needs_year"
            ? "Its files run a different financial year: answer on its page."
            : "Paused for a quote: accept it on its page to carry on.",
        href: runPage,
      });
    return true;
  };

  const process = async (from = 0) => {
    setRunning(true);
    setShort(null);
    if (from === 0) {
      order.current = groups;
      uploaded.current = new Map();
      setOutcomes(Object.fromEntries(groups.map((g) => [g, { kind: "waiting" }])));
    }
    let stoppedShort = false;
    for (const companyId of order.current.slice(from)) {
      if (!(await runOne(companyId))) {
        stoppedShort = true;
        break;
      }
    }
    setRunning(false);
    if (!stoppedShort) setFinished(true);
  };

  const startAgain = () => {
    setFiles([]);
    setOutcomes({});
    setShort(null);
    setFinished(false);
    order.current = [];
    uploaded.current = new Map();
  };

  return (
    <ProcessingNotice>
      <div className="flex flex-col gap-5" data-testid="batch">
        <Panel title="Every company's files" icon="upload">
          <FileDropZone
            title="Drag this month's files for all your companies here"
            hint="Each is matched to a company by its name; check the matches below before anything is uploaded."
            inputLabel="Choose files for several companies"
            disabled={running || finished}
            onFiles={(list) => {
              setFiles((prev) => [
                ...prev,
                ...list
                  .filter(
                    (f) => !prev.some((p) => p.key === `${f.name}:${String(f.size)}`),
                  )
                  .map((f) => {
                    const match = matchFile(f.name, companies);
                    return {
                      key: `${f.name}:${String(f.size)}`,
                      file: f,
                      companyId: match?.companyId ?? null,
                      matched: match !== null,
                    };
                  }),
              ]);
            }}
            testId="batch-drop"
          />
          {files.length === 0 ? null : (
            <div className="mt-4">
              <DataTable
                testId="batch-files"
                head={
                  <>
                    <Th>File</Th>
                    <Th>Company</Th>
                    <Th />
                  </>
                }
              >
                {files.map((f) => (
                  <Tr key={f.key}>
                    <Td className="font-medium text-neutral-900">{f.file.name}</Td>
                    <Td>
                      <select
                        aria-label={`Company for ${f.file.name}`}
                        disabled={running || finished}
                        value={f.companyId ?? ""}
                        onChange={(e) => {
                          const id = e.target.value === "" ? null : e.target.value;
                          setFiles((list) =>
                            list.map((x) =>
                              x.key === f.key
                                ? { ...x, companyId: id, matched: false }
                                : x,
                            ),
                          );
                        }}
                        className={`h-9 rounded-md border bg-surface px-2 text-[0.8125rem] ${
                          f.companyId === null
                            ? "border-warning text-warning"
                            : "border-neutral-200 text-neutral-900"
                        }`}
                      >
                        <option value="">Choose a company</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {f.matched ? (
                        <span className="ml-2 text-[0.75rem] text-neutral-500">
                          matched by its name
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        disabled={running || finished}
                        aria-label={`Remove ${f.file.name}`}
                        className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                        onClick={() => {
                          setFiles((list) => list.filter((x) => x.key !== f.key));
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
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <SelectField
              id="batch-tier"
              label="Intelligence tier"
              value={tier}
              disabled={running || short !== null}
              onChange={(e) => {
                setTier(e.target.value as Tier);
              }}
            >
              {(Object.keys(TIER_LABELS) as Tier[]).map((k) => (
                <option key={k} value={k}>
                  {TIER_LABELS[k]}
                  {prices === null ? "" : ` — ${formatCredits(prices[k])} credits each`}
                </option>
              ))}
            </SelectField>
            {finished ? (
              <Button
                size="lg"
                variant="secondary"
                icon="plus"
                onClick={startAgain}
                data-testid="batch-again"
              >
                Start another batch
              </Button>
            ) : (
              <Button
                size="lg"
                icon="refresh"
                disabled={
                  running || short !== null || files.length === 0 || unassigned > 0
                }
                onClick={() => void process()}
                data-testid="batch-run"
              >
                {running
                  ? "Working…"
                  : short !== null
                    ? "Add credits below to carry on"
                    : unassigned > 0
                      ? `Choose a company for ${String(unassigned)} ${unassigned === 1 ? "file" : "files"}`
                      : `Process ${String(groups.length)} ${groups.length === 1 ? "company" : "companies"}`}
              </Button>
            )}
          </div>
          <p className="mt-2 text-[0.75rem] text-neutral-500">
            {TIER_NOTES[tier]} Each company&rsquo;s refresh is its own action, held and
            charged at its own standard price
            {prices === null
              ? ""
              : ` (${formatCredits(prices[tier])} credits at ${TIER_LABELS[tier]})`}
            , exactly as if its file were added on its own page. Keep this page open until
            every company is done: the batch moves from one to the next from here.
          </p>
        </Panel>

        {short === null ? null : (
          <BuyCreditsInline
            need={short.need}
            businessName={businessName}
            onCredited={() => void process(short.from)}
          />
        )}

        {Object.keys(outcomes).length === 0 ? null : (
          <Panel title="Companies" icon="building" padding="none">
            <ul className="divide-y divide-neutral-100" data-testid="batch-outcomes">
              {order.current.map((id) => {
                const o = outcomes[id] ?? { kind: "waiting" };
                return (
                  <li
                    key={id}
                    className="flex flex-wrap items-center gap-3 px-5 py-3"
                    data-testid="batch-outcome"
                  >
                    <span className="flex-1 text-[0.875rem] font-medium text-neutral-900">
                      {name(id)}
                    </span>
                    <Badge tone={TONE[o.kind]} dot>
                      {o.kind === "waiting"
                        ? "Waiting"
                        : o.kind === "working"
                          ? o.step
                          : o.kind === "done"
                            ? `Done · ${formatCredits(o.credits)} credits`
                            : o.kind === "attention"
                              ? "Needs you"
                              : "Not done"}
                    </Badge>
                    {o.kind === "attention" ? (
                      <Link
                        href={o.href}
                        className="text-[0.8125rem] font-medium text-accent-700 hover:underline"
                      >
                        {o.message}
                      </Link>
                    ) : o.kind === "failed" ? (
                      <span className="text-[0.8125rem] text-negative">
                        {o.message}
                        {/contact support/iu.test(o.message) ? (
                          <>
                            {" "}
                            <Link href="/contact" className="font-medium underline">
                              Open the contact page
                            </Link>
                          </>
                        ) : null}
                      </span>
                    ) : o.kind === "done" ? (
                      <Link
                        href={`/app/companies/${id}`}
                        className="text-[0.8125rem] font-medium text-accent-700 hover:underline"
                      >
                        Open the dashboard
                      </Link>
                    ) : null}
                    {(o.kind === "attention" || o.kind === "failed") &&
                    o.refused !== undefined &&
                    o.refused.length > 0 ? (
                      <ul
                        className="w-full pl-0.5 text-[0.75rem] text-neutral-600"
                        data-testid="batch-refused"
                      >
                        {o.refused.map((x) => (
                          <li key={x.name} className="mt-1">
                            <span className="font-medium text-neutral-800">
                              {x.name}:
                            </span>{" "}
                            {x.reason}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </div>
    </ProcessingNotice>
  );
}
