"use client";

/**
 * The workspace assistant (SPEC §25, §27; ADR 0033): chat and commentary in one conversation beside
 * the dashboard, so the figures being discussed are always in view.
 *
 * The customer picks what they want — a quick answer, a deeper look that queries the company's
 * figures on the server, a layout change, or the month's written commentary — and presses send.
 * There is no price step: credits are held and charged by the server for what was asked. Every
 * figure in an answer is a placeholder resolved here after the placeholder check runs again, and
 * opens its lineage.
 */

import type { NumberFormatOptions } from "@magicmis/core/format";
import type { MetricValue } from "@magicmis/engine";
import {
  companyFormat,
  formatValue,
  renderAnswer,
  type AnswerQuery,
  type AnswerSegment,
} from "@magicmis/render-dashboard";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Drawer } from "@/components/Drawer";
import { Icon, type IconName } from "@/components/Icon";
import { LineagePanel } from "@/components/LineagePanel";
import { Alert, Button } from "@/components/ui";
import { formatCredits, TIER_LABELS, TIER_NOTES, TIER_TAGS } from "@/lib/actions";
import { api, newIdempotencyKey } from "@/lib/client-api";
import { acceptQuote, startPaidJob, type StartResult } from "@/lib/paid-job";

import { CommentaryView } from "./CommentaryView";

type MessageType = "quick" | "deep" | "edit" | "investigate";
type Mode = "quick" | "deep" | "edit" | "commentary";
type Tier = keyof typeof TIER_LABELS;

interface Reply {
  kind: "answer" | "edit";
  output?: { scope: string; paragraphs: { text: string }[] };
  scope?: string;
  summary?: string;
  target?: "dashboard" | "template";
  baseVersion?: number;
  operations?: unknown[];
}

interface MessageView {
  id: string;
  role: "user" | "assistant";
  type: MessageType | null;
  state: string;
  createdAt: string;
  creditsCharged: string;
  text: string | null;
  reply: Reply | null;
  values: MetricValue[];
  queries: AnswerQuery[];
}

interface ThreadView {
  threadId: string;
  status: string;
  messages: MessageView[];
  allowlist: string[];
}

export interface CommentaryRow {
  id: string;
  state: string;
  period: string | null;
  createdAt: string;
}

type Progress =
  | { status: "completed"; state: string; capturedCredits: string }
  | { status: "needs_query"; stepId: string; stepRef: string; sql: string }
  | { status: "failed"; reason: string };

const MODES: readonly { key: Mode; label: string; icon: IconName; hint: string }[] = [
  { key: "quick", label: "Ask", icon: "chat", hint: "Ask about a figure or a movement" },
  {
    key: "deep",
    label: "Dig deeper",
    icon: "search",
    hint: "Which ledgers, parties or months drove it",
  },
  {
    key: "edit",
    label: "Change layout",
    icon: "sliders",
    hint: "Rename, reorder or remove cards",
  },
  {
    key: "commentary",
    label: "Commentary",
    icon: "document",
    hint: "A written review of a month",
  },
];

const TYPE_WORDS: Record<MessageType, string> = {
  quick: "Ask",
  deep: "Dig deeper",
  investigate: "Investigate",
  edit: "Change layout",
};

const ZERO_SIZE = {
  files: 0,
  sheets: 0,
  columns: 0,
  rows: 0,
  distinctLedgerValues: 0,
  referenceMisSheets: 0,
};

function Segments({
  segments,
  onMetric,
  onQuery,
}: {
  segments: readonly AnswerSegment[];
  onMetric: (key: string) => void;
  onQuery: (ref: string) => void;
}) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === "text" ? (
          <span key={i}>{s.text}</span>
        ) : s.metricKey === null && s.queryRef === null ? (
          <span key={i} title={s.hint ?? undefined}>
            {s.display}
          </span>
        ) : (
          <button
            key={i}
            type="button"
            className="font-medium tabular-nums underline decoration-accent-300 underline-offset-4 hover:decoration-accent-600"
            data-lineage={s.metricKey ?? s.queryRef ?? ""}
            onClick={() => {
              if (s.metricKey !== null) onMetric(s.metricKey);
              else if (s.queryRef !== null) onQuery(s.queryRef);
            }}
          >
            {s.display}
          </button>
        ),
      )}
    </>
  );
}

/** A rendered answer as plain text, for copying into a mail or a board pack. */
const plainText = (paragraphs: readonly (readonly AnswerSegment[])[]): string =>
  paragraphs
    .map((p) => p.map((seg) => (seg.kind === "text" ? seg.text : seg.display)).join(""))
    .join("\n\n");

/** A paragraph the model wrote as a bullet, so it can be shown as one. */
const BULLET = /^\s*(?:[-•*]|\d+[.)])\s+/u;

const bulletOf = (
  paragraph: readonly AnswerSegment[],
): readonly AnswerSegment[] | null => {
  const first = paragraph[0];
  if (first === undefined || first.kind !== "text" || !BULLET.test(first.text))
    return null;
  return [{ ...first, text: first.text.replace(BULLET, "") }, ...paragraph.slice(1)];
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function Assistant({
  companyId,
  companyName,
  money,
  currencySymbol,
  periods,
  commentaries,
  prefill,
  onLayoutChanged,
}: {
  companyId: string;
  companyName: string;
  money: NumberFormatOptions;
  /** The company's reporting currency symbol (ADR 0030). */
  currencySymbol: string;
  /** Months with figures, newest first. */
  periods: readonly string[];
  commentaries: readonly CommentaryRow[];
  /** A question handed over by the dashboard's Investigate; `nonce` makes a repeat count. */
  prefill: { type: MessageType; text: string; nonce: number } | null;
  /** A layout change applied or undone here, so the dashboard beside it can reload. */
  onLayoutChanged: () => void;
}) {
  const [threads, setThreads] = useState<
    { id: string; status: string; createdAt: string }[]
  >([]);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [mode, setMode] = useState<Mode>("quick");
  const [investigating, setInvestigating] = useState(false);
  const [tier, setTier] = useState<Tier>("professional");
  const [editTarget, setEditTarget] = useState<"dashboard" | "template">("dashboard");
  const [text, setText] = useState("");
  const [month, setMonth] = useState(periods[0] ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [short, setShort] = useState(false);
  const [quote, setQuote] = useState<{
    jobId: string;
    credits: string;
    expiresAt: string;
    period: string;
  } | null>(null);
  const [history, setHistory] = useState(false);
  const [names, setNames] = useState<Record<string, string | null>>({});
  /** Commentaries shown in this conversation: written here, or opened from history. */
  const [shown, setShown] = useState<CommentaryRow[]>([]);
  const [lineage, setLineage] = useState<
    | { kind: "metric"; key: string; values: MetricValue[] }
    | { kind: "query"; query: AnswerQuery }
    | null
  >(null);
  const [applied, setApplied] = useState<
    Record<string, { target: string; blueprintVersion: number; undone: boolean }>
  >({});
  const [copied, setCopied] = useState<string | null>(null);
  /** The question just asked, shown before the server has anything to say about it. */
  const [asking, setAsking] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const format = useMemo(
    () => companyFormat(money, currencySymbol),
    [money, currencySymbol],
  );

  const loadThreads = useCallback(async () => {
    const r = await api<{ threads: { id: string; status: string; createdAt: string }[] }>(
      `/api/companies/${companyId}/chat`,
    );
    if (r.ok) setThreads(r.data.threads);
  }, [companyId]);

  const openThread = useCallback(async (id: string) => {
    const r = await api<ThreadView>(`/api/chat/threads/${id}`);
    if (r.ok) setThread(r.data);
    else setError(r.message);
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // An Investigate press on the dashboard lands here as a ready-to-send deeper question.
  useEffect(() => {
    if (prefill === null) return;
    setMode(prefill.type === "investigate" ? "deep" : prefill.type);
    setInvestigating(prefill.type === "investigate");
    setText(prefill.text);
    input.current?.focus();
  }, [prefill]);

  // A deep answer can take most of a minute. A counter is the honest way to say so: it is the
  // one thing about the wait that is actually known.
  useEffect(() => {
    if (busy === null) {
      setWaited(0);
      return;
    }
    const tick = setInterval(() => {
      setWaited((n) => n + 1);
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, [busy]);

  // Keep the newest item in view.
  const itemCount =
    (thread?.messages.length ?? 0) + shown.length + (asking === null ? 0 : 1);
  useEffect(() => {
    const el = scroller.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [itemCount, busy]);

  // Names for tokens in answers, from this company's most recent upload while it is kept.
  useEffect(() => {
    if (thread === null) return;
    const tokens = new Set<string>();
    for (const m of thread.messages) {
      const blob = JSON.stringify([m.reply, m.queries]);
      for (const t of blob.matchAll(/\b[A-Z]+_[0-9a-f]{12}\b/gu)) tokens.add(t[0]);
    }
    if (tokens.size === 0) return;
    void api<{ names: Record<string, string | null> }>(
      `/api/companies/${companyId}/chat/names`,
      { body: { tokens: [...tokens].slice(0, 500) } },
    ).then((r) => {
      if (r.ok) setNames(r.data.names);
    });
  }, [thread, companyId]);

  const reset = () => {
    setError(null);
    setShort(false);
  };

  const send = async () => {
    if (text.trim() === "" || busy !== null) return;
    reset();
    setAsking(text.trim());
    const type: MessageType =
      investigating && mode === "deep"
        ? "investigate"
        : mode === "commentary"
          ? "quick"
          : mode;
    setBusy(
      type === "quick" || type === "edit" ? "Thinking…" : "Looking through the figures…",
    );
    try {
      const r = await api<{ messageId: string; threadId: string; progress: Progress }>(
        "/api/chat/messages",
        {
          body: {
            companyId,
            threadId: thread?.status === "open" ? thread.threadId : null,
            type,
            tier,
            text,
            ...(type === "edit" ? { editTarget } : {}),
          },
          idempotencyKey: newIdempotencyKey(),
        },
      );
      if (!r.ok) {
        if (r.status === 402) setShort(true);
        else setError(r.message);
        return;
      }
      // Deep questions run their queries on the server and come back answered (ADR 0032).
      if (r.data.progress.status !== "completed")
        setError("This message could not be answered. No credits were charged.");
      setText("");
      setInvestigating(false);
      await openThread(r.data.threadId);
      await loadThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The message could not be sent.");
    } finally {
      setBusy(null);
      setAsking(null);
    }
  };

  const afterHold = async (result: StartResult, period: string) => {
    if (result.kind === "quote") {
      setQuote({ ...result, period });
      return;
    }
    setQuote(null);
    if (result.kind === "short") {
      setShort(true);
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    const r = await api<{ state: string }>(`/api/jobs/${result.jobId}/commentary`, {
      body: { period },
      idempotencyKey: newIdempotencyKey(),
    });
    if (!r.ok) setError(r.message);
    else if (r.data.state === "completed")
      setShown((list) => [
        ...list,
        {
          id: result.jobId,
          state: "completed",
          period,
          createdAt: new Date().toISOString(),
        },
      ]);
    else if (r.data.state === "failed")
      setError("The commentary could not be written. No credits were charged.");
    else setError("The commentary is still being written. It will appear in History.");
  };

  const writeCommentary = async () => {
    if (month === "" || busy !== null) return;
    reset();
    setBusy(`Writing the commentary for ${format.period(month)}…`);
    try {
      await afterHold(
        await startPaidJob({
          companyId,
          type: "commentary",
          tier,
          delivery: "instant",
          size: ZERO_SIZE,
          fingerprints: {},
        }),
        month,
      );
    } finally {
      setBusy(null);
    }
  };

  const apply = async (m: MessageView) => {
    if (thread === null) return;
    const r = await api<{ target: string; blueprintVersion: number }>(
      `/api/chat/messages/${m.id}/apply`,
      { body: { threadId: thread.threadId }, idempotencyKey: newIdempotencyKey() },
    );
    if (r.ok) {
      setApplied((a) => ({ ...a, [m.id]: { ...r.data, undone: false } }));
      onLayoutChanged();
    } else setError(r.message);
  };

  const undo = async (m: MessageView) => {
    const done = applied[m.id];
    if (done === undefined) return;
    const r = await api(
      done.target === "dashboard"
        ? `/api/companies/${companyId}/dashboard`
        : `/api/companies/${companyId}/template`,
      {
        body: { action: "undo", baseVersion: done.blueprintVersion },
        idempotencyKey: newIdempotencyKey(),
      },
    );
    if (r.ok) {
      setApplied((a) => ({ ...a, [m.id]: { ...done, undone: true } }));
      onLayoutChanged();
    } else setError(r.message);
  };

  /**
   * Where to go next, taken from the figures the answer actually used: a question about one of
   * them is the one a reader asks, and it saves typing the metric's name correctly.
   */
  const followUps = (m: MessageView): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of m.values) {
      const base = v.metricId.split(".")[0] ?? v.metricId;
      if (seen.has(base)) continue;
      seen.add(base);
      out.push(`What drove ${format.label(base).toLowerCase()}?`);
      if (out.length === 2) break;
    }
    return out;
  };

  const latest = periods[0] ?? null;
  const suggestions: readonly { label: string; run: () => void }[] = [
    ...(latest === null
      ? []
      : [
          {
            label: `Write the commentary for ${format.period(latest)}`,
            run: () => {
              setMode("commentary");
              setMonth(latest);
            },
          },
        ]),
    {
      label: "How did revenue move this month?",
      run: () => {
        setMode("quick");
        setText("How did revenue move this month?");
      },
    },
    {
      label: "Which expenses grew the most, and why?",
      run: () => {
        setMode("deep");
        setText("Which expenses grew the most, and which ledgers drove it?");
      },
    },
    {
      label: "What does working capital look like?",
      run: () => {
        setMode("quick");
        setText("What does working capital look like this month?");
      },
    },
  ];

  const timeline = [
    ...(thread?.messages ?? []).map((m) => ({ at: m.createdAt, message: m })),
    ...shown.map((c) => ({ at: c.createdAt, commentary: c })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <aside
      className="relative flex h-[calc(100vh-7rem)] min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-surface shadow-sm"
      data-testid="assistant"
      aria-label="Assistant"
    >
      <header className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-600 text-white">
          <Icon name="chat" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[0.875rem] font-semibold text-neutral-900">
            Chat with the MIS
          </h2>
          <p className="truncate text-[0.75rem] text-neutral-500">
            Every number computed from the books, never written by AI
          </p>
        </div>
        <button
          type="button"
          aria-expanded={history}
          className={`rounded-md px-2 py-1.5 text-[0.75rem] font-medium ${
            history
              ? "bg-accent-50 text-accent-800"
              : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          }`}
          onClick={() => {
            setHistory((h) => !h);
          }}
        >
          <Icon name="clock" size={14} className="mr-1 inline" />
          History
        </button>
        <button
          type="button"
          aria-label="New conversation"
          title="New conversation"
          className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          onClick={() => {
            setThread(null);
            setShown([]);
            setHistory(false);
            reset();
          }}
        >
          <Icon name="plus" size={16} />
        </button>
      </header>

      {history ? (
        <div
          className="scroll-slim absolute inset-x-0 top-[3.6rem] bottom-0 z-10 overflow-y-auto bg-surface p-4"
          data-testid="assistant-history"
        >
          <p className="eyebrow mb-2">Conversations</p>
          {threads.length === 0 ? (
            <p className="mb-4 text-[0.8125rem] text-neutral-500">None yet.</p>
          ) : (
            <ul className="mb-4 flex flex-col gap-0.5">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg px-2.5 py-2 text-left text-[0.8125rem] ${
                      thread?.threadId === t.id
                        ? "bg-accent-50 font-semibold text-accent-800"
                        : "text-neutral-700 hover:bg-neutral-50"
                    }`}
                    onClick={() => {
                      setShown([]);
                      setHistory(false);
                      void openThread(t.id);
                    }}
                  >
                    {when(t.createdAt)}
                    {t.status === "capped" ? " (continued)" : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="eyebrow mb-2">Commentary</p>
          {commentaries.length === 0 ? (
            <p className="text-[0.8125rem] text-neutral-500">None yet.</p>
          ) : (
            <ul className="flex flex-col gap-0.5" data-testid="commentary-jobs">
              {commentaries.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={c.state !== "completed"}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[0.8125rem] text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400 disabled:hover:bg-transparent"
                    onClick={() => {
                      setShown((list) =>
                        list.some((x) => x.id === c.id) ? list : [...list, c],
                      );
                      setHistory(false);
                    }}
                  >
                    <span className="font-medium">
                      {c.period === null ? "—" : format.period(c.period)}
                    </span>
                    <span className="text-[0.75rem] text-neutral-500">
                      {c.state === "completed" ? when(c.createdAt) : "In progress"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div
        ref={scroller}
        className="scroll-slim flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 text-sm"
        data-testid="chat-messages"
      >
        {timeline.length === 0 ? (
          <div className="my-auto flex flex-col items-start gap-3">
            <p className="display text-[1.125rem] font-semibold text-neutral-900">
              What would you like to know?
            </p>
            <p className="text-[0.8125rem] leading-relaxed text-neutral-500">
              Ask about any figure on the dashboard, dig into what drove it, or have the
              month written up. Every number in an answer is computed from the books and
              links to its source.
            </p>
            <div className="mt-1 flex flex-col gap-2 self-stretch">
              {suggestions.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className="press group flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-25 px-3 py-2.5 text-left text-[0.8125rem] text-neutral-700 hover:border-accent-200 hover:bg-accent-50 hover:text-accent-800"
                  onClick={() => {
                    s.run();
                    input.current?.focus();
                  }}
                >
                  {s.label}
                  <Icon
                    name="arrow-right"
                    size={13}
                    className="shrink-0 transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              ))}
            </div>
          </div>
        ) : (
          timeline.map((item) => {
            if ("commentary" in item) {
              const c = item.commentary;
              return (
                <div
                  key={c.id}
                  className="message-in rounded-xl border border-neutral-200 bg-surface p-4 shadow-sm"
                >
                  <p className="eyebrow mb-2 flex items-center gap-1.5">
                    <Icon name="document" size={12} />
                    Commentary · {c.period === null ? "—" : format.period(c.period)}
                  </p>
                  <CommentaryView
                    jobId={c.id}
                    companyName={companyName}
                    periodLabel={c.period === null ? "" : format.period(c.period)}
                  />
                </div>
              );
            }
            const m = item.message;
            if (m.role === "user")
              return (
                <div
                  key={m.id}
                  className="message-in ml-auto max-w-[88%] rounded-2xl rounded-br-sm bg-accent-600 px-3.5 py-2.5 text-white"
                  data-testid="chat-user"
                >
                  <p className="leading-relaxed">{m.text}</p>
                  <p className="mt-1 text-[0.6875rem] text-accent-100">
                    {TYPE_WORDS[m.type ?? "quick"]} ·{" "}
                    {m.state === "failed_platform"
                      ? "not answered, not charged"
                      : m.state === "declined_out_of_scope"
                        ? `outside this MIS · ${formatCredits(m.creditsCharged)} credits`
                        : `${formatCredits(m.creditsCharged)} credits`}
                  </p>
                </div>
              );
            const reply = m.reply;
            if (reply?.kind === "edit") {
              const done = applied[m.id];
              return (
                <div
                  key={m.id}
                  className="message-in max-w-[94%] rounded-2xl rounded-bl-sm border border-neutral-200 bg-neutral-25 p-3.5"
                  data-testid="chat-edit"
                >
                  <p className="leading-relaxed text-neutral-800">{reply.summary}</p>
                  {reply.scope === "in_scope" ? (
                    <>
                      <details className="mt-2 text-[0.75rem] text-neutral-500">
                        <summary className="cursor-pointer select-none">
                          The exact change
                        </summary>
                        <pre
                          className="scroll-slim mt-1.5 overflow-x-auto rounded-lg bg-neutral-900 p-3 text-[0.6875rem] text-neutral-100"
                          data-testid="chat-edit-preview"
                        >
                          {JSON.stringify(reply.operations, null, 2)}
                        </pre>
                      </details>
                      <div className="mt-2.5 flex items-center gap-2">
                        {done === undefined ? (
                          <Button size="sm" onClick={() => void apply(m)}>
                            Apply change
                          </Button>
                        ) : done.undone ? (
                          <span className="text-neutral-700">Undone.</span>
                        ) : (
                          <>
                            <span className="text-neutral-700">
                              Applied to the {done.target}.
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void undo(m)}
                            >
                              Undo
                            </Button>
                          </>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              );
            }
            const rendered =
              reply?.output === undefined || thread === null
                ? null
                : renderAnswer(
                    reply.output.paragraphs,
                    m.values,
                    m.queries,
                    thread.allowlist,
                    { ...format, name: (token) => names[token] ?? null },
                  );
            return (
              <div
                key={m.id}
                className="message-in max-w-[94%] rounded-2xl rounded-bl-sm border border-neutral-200 bg-neutral-25 p-3.5"
                data-testid="chat-answer"
              >
                {rendered === null ? null : !rendered.ok ? (
                  <Alert tone="error">
                    This answer did not pass the figure check, so it is not shown.
                  </Alert>
                ) : (
                  <>
                    {rendered.paragraphs.map((p, i) => {
                      const onMetric = (key: string) => {
                        setLineage({ kind: "metric", key, values: m.values });
                      };
                      const onQuery = (ref: string) => {
                        const q = m.queries.find((x) => x.ref === ref);
                        if (q !== undefined) setLineage({ kind: "query", query: q });
                      };
                      const bullet = bulletOf(p);
                      return bullet === null ? (
                        <p
                          key={i}
                          className="mb-2 leading-relaxed text-neutral-800 last:mb-0"
                        >
                          <Segments segments={p} onMetric={onMetric} onQuery={onQuery} />
                        </p>
                      ) : (
                        <p
                          key={i}
                          className="mb-1.5 flex gap-2 leading-relaxed text-neutral-800 last:mb-0"
                        >
                          <span aria-hidden="true" className="text-neutral-400">
                            •
                          </span>
                          <span>
                            <Segments
                              segments={bullet}
                              onMetric={onMetric}
                              onQuery={onQuery}
                            />
                          </span>
                        </p>
                      );
                    })}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-neutral-200/70 pt-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.6875rem] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(plainText(rendered.paragraphs))
                            .then(() => {
                              setCopied(m.id);
                            });
                        }}
                      >
                        <Icon name="document" size={11} />
                        {copied === m.id ? "Copied" : "Copy"}
                      </button>
                      {followUps(m).map((q) => (
                        <button
                          key={q}
                          type="button"
                          className="rounded-full px-2 py-1 text-[0.6875rem] font-medium text-accent-700 hover:bg-accent-50"
                          onClick={() => {
                            setMode("deep");
                            setText(q);
                            input.current?.focus();
                          }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
        {asking === null ? null : (
          <div
            className="message-in ml-auto max-w-[88%] rounded-2xl rounded-br-sm bg-accent-600 px-3.5 py-2.5 text-white opacity-80"
            data-testid="chat-asking"
          >
            <p className="leading-relaxed">{asking}</p>
          </div>
        )}
        {busy === null ? null : (
          <div
            className="message-in flex w-fit items-center gap-2 rounded-2xl rounded-bl-sm bg-neutral-100 px-3.5 py-2.5 text-[0.8125rem] text-neutral-600"
            role="status"
          >
            <span
              className="typing flex items-center gap-1 text-accent-600"
              aria-hidden="true"
            >
              <span />
              <span />
              <span />
            </span>
            {busy}
            {waited < 3 ? null : (
              <span className="tabular-nums text-neutral-400">{waited.toString()}s</span>
            )}
          </div>
        )}
        {quote === null ? null : (
          <Alert tone="warning" title="This one needs a quote">
            <p>
              The commentary for {format.period(quote.period)} needs more analysis than
              the standard price covers:{" "}
              <strong className="tabular-nums">{formatCredits(quote.credits)}</strong>{" "}
              credits. The offer stands until{" "}
              {new Date(quote.expiresAt).toLocaleString("en-IN")}.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  const q = quote;
                  setBusy(`Writing the commentary for ${format.period(q.period)}…`);
                  void acceptQuote(q.jobId, q.credits)
                    .then((r) => afterHold(r, q.period))
                    .finally(() => {
                      setBusy(null);
                    });
                }}
              >
                Accept and write it
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setQuote(null);
                }}
              >
                Not now
              </Button>
            </div>
          </Alert>
        )}
        {short ? (
          <Alert tone="warning" title="Not enough credits">
            Top up and send it again. Nothing was charged.{" "}
            <Link href="/wallet" className="font-medium underline">
              Add credits
            </Link>
          </Alert>
        ) : null}
        {error === null ? null : <Alert tone="error">{error}</Alert>}
      </div>

      <div className="border-t border-neutral-100 bg-neutral-25 p-3">
        <div
          className="mb-2 flex flex-wrap gap-1"
          role="radiogroup"
          aria-label="What you want"
          data-testid="chat-type"
        >
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              title={m.hint}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.75rem] font-medium transition-colors ${
                mode === m.key
                  ? "bg-accent-600 text-white"
                  : "bg-surface text-neutral-600 ring-1 ring-neutral-200 hover:text-neutral-900"
              }`}
              onClick={() => {
                setMode(m.key);
                setInvestigating(false);
              }}
            >
              <Icon name={m.icon} size={12} />
              {m.label}
            </button>
          ))}
        </div>

        {mode === "commentary" ? (
          <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-surface p-3">
            {periods.length === 0 ? (
              <p className="text-[0.8125rem] text-neutral-500">
                Commentary needs a month of figures. Upload the trial balances first.
              </p>
            ) : (
              <>
                <label className="flex items-center justify-between gap-3 text-[0.8125rem] text-neutral-600">
                  <span>Month to write up</span>
                  <select
                    className="h-8 rounded-md border border-neutral-200 bg-surface px-2 text-[0.8125rem] text-neutral-900"
                    value={month}
                    onChange={(e) => {
                      setMonth(e.target.value);
                    }}
                    data-testid="commentary-month"
                  >
                    {periods.map((p) => (
                      <option key={p} value={p}>
                        {format.period(p)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  onClick={() => void writeCommentary()}
                  disabled={busy !== null}
                  icon="document"
                  data-testid="commentary-write"
                >
                  Write the commentary
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-surface focus-within:border-accent-300 focus-within:ring-2 focus-within:ring-accent-100">
            <textarea
              ref={input}
              className="block max-h-40 min-h-[4.5rem] w-full resize-none rounded-xl bg-transparent px-3 pt-2.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
              aria-label="Your question"
              placeholder={
                mode === "edit"
                  ? "For example: rename the revenue card to Sales"
                  : mode === "deep"
                    ? "For example: which parties drove the rise in debtors?"
                    : `Ask anything about ${companyName}`
              }
              maxLength={2000}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              {mode === "edit" ? (
                <select
                  aria-label="What to change"
                  className="h-7 rounded-md border border-neutral-200 bg-surface px-1.5 text-[0.75rem] text-neutral-700"
                  value={editTarget}
                  onChange={(e) => {
                    setEditTarget(e.target.value as "dashboard" | "template");
                  }}
                >
                  <option value="dashboard">Dashboard</option>
                  <option value="template">MIS workbook layout</option>
                </select>
              ) : mode === "deep" ? (
                <span
                  className="truncate text-[0.6875rem] text-neutral-500"
                  data-testid="chat-session"
                >
                  Queries this company&rsquo;s figures on our servers
                </span>
              ) : (
                <span />
              )}
              <button
                type="button"
                aria-label="Send"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-600 text-white transition-colors hover:bg-accent-700 disabled:bg-neutral-200 disabled:text-neutral-400"
                onClick={() => void send()}
                disabled={busy !== null || text.trim() === ""}
                data-testid="chat-send"
              >
                <Icon name="arrow-up" size={16} />
              </button>
            </div>
          </div>
        )}

        <div
          className="mt-3 rounded-xl border border-line bg-raised p-2.5"
          data-testid="tier-chooser"
        >
          <span className="eyebrow">How hard it thinks</span>
          <div
            role="radiogroup"
            aria-label="Intelligence tier"
            className="mt-2 grid grid-cols-3 gap-1.5"
          >
            {(Object.keys(TIER_LABELS) as Tier[]).map((t) => {
              const on = t === tier;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-testid={`tier-${t}`}
                  className={`press rounded-lg border px-2 py-1.5 text-left transition-colors ${
                    on
                      ? "border-accent-300 bg-accent-50 text-accent-900"
                      : "border-transparent text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                  }`}
                  onClick={() => {
                    setTier(t);
                  }}
                >
                  <span className="block text-[0.75rem] font-medium">
                    {TIER_LABELS[t]}
                  </span>
                  <span
                    className={`block text-[0.6875rem] ${
                      on ? "text-accent-700" : "text-neutral-500"
                    }`}
                  >
                    {TIER_TAGS[t]}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[0.75rem] leading-snug text-neutral-500">
            {TIER_NOTES[tier]}
          </p>
          <p className="mt-1.5 text-[0.6875rem] text-neutral-400">
            Every message uses credits, including questions outside this MIS.
          </p>
        </div>
      </div>

      <Drawer
        open={lineage !== null}
        label="Lineage"
        onClose={() => {
          setLineage(null);
        }}
      >
        {lineage === null ? null : lineage.kind === "metric" ? (
          <LineagePanel
            selected={lineage.key}
            values={lineage.values}
            label={format.label}
            display={(v) =>
              v.value === null ? "—" : formatValue(v.value, v.unit, money, currencySymbol)
            }
            onSelect={(key) => {
              setLineage({ ...lineage, key });
            }}
            onClose={() => {
              setLineage(null);
            }}
          />
        ) : (
          <aside
            className="rounded-xl border border-neutral-200/80 bg-surface p-4 text-sm shadow-sm"
            data-testid="query-lineage"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 className="font-semibold text-neutral-900">
                From query {lineage.query.ref}
              </h2>
              <Button
                variant="secondary"
                onClick={() => {
                  setLineage(null);
                }}
              >
                Close
              </Button>
            </div>
            <p className="mb-2 text-neutral-700">{lineage.query.purpose}</p>
            <p className="text-neutral-600">Tables: {lineage.query.tables.join(", ")}</p>
            <pre className="scroll-slim my-2 overflow-x-auto rounded-lg bg-neutral-900 p-3 text-[0.75rem] text-neutral-100">
              {lineage.query.sql}
            </pre>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    {lineage.query.result.columns.map((c) => (
                      <th key={c} className="text-left">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineage.query.result.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j}>{names[c] ?? c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>
        )}
      </Drawer>
    </aside>
  );
}
