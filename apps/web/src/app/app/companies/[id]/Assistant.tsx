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
  isPaiseColumn,
  parseMetricKey,
  renderAnswer,
  type AnswerQuery,
  type AnswerSegment,
} from "@magicmis/render-dashboard";
import { detectIntent } from "@magicmis/chat/intent";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import { Drawer } from "@/components/Drawer";
import { Icon, type IconName } from "@/components/Icon";
import { LineagePanel } from "@/components/LineagePanel";
import { Alert, Button, MistakesNote } from "@/components/ui";
import { formatCredits, TIER_LABELS, TIER_NOTES, TIER_TAGS } from "@/lib/actions";
import { api, newIdempotencyKey } from "@/lib/client-api";
import { istLabelled } from "@/lib/job-display";
import { acceptQuote, startPaidJob, type StartResult } from "@/lib/paid-job";
import { CHAT_THREAD_COOKIE, remember } from "@/lib/prefs";

import { BuyCreditsInline } from "@/components/BuyCreditsInline";

import { BoardActionsView } from "./BoardActionsView";
import { CommentaryView } from "./CommentaryView";

type MessageType = "quick" | "deep" | "edit" | "investigate";
type Mode = "quick" | "deep" | "edit" | "commentary";
type Tier = keyof typeof TIER_LABELS;
/** The two documents the assistant writes about a month (ADR 0062). */
type WriteUp = "commentary" | "board_actions";

interface Reply {
  kind: "answer" | "edit";
  output?: { scope: string; paragraphs: { text: string }[] };
  scope?: string;
  summary?: string;
  target?: "dashboard" | "template";
  baseVersion?: number;
  operations?: unknown[];
  /** Set when the server applied the change as it was proposed (ADR 0046). */
  appliedVersion?: number | null;
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
  /** Which of the two write-ups this is (ADR 0062). Absent on rows stored before it existed. */
  kind?: WriteUp;
}

type Progress =
  | { status: "completed"; state: string; capturedCredits: string }
  | { status: "needs_query"; stepId: string; stepRef: string; sql: string }
  /** A retry that reached a message another request is still answering. */
  | { status: "running"; reason: string }
  | { status: "failed"; reason: string };

/** A user message the server has held but not yet answered or failed. */
const UNANSWERED = new Set(["pending", "running", "needs_query"]);

/**
 * How each write-up is named in a sentence. One is a document and the other a list, so the verb
 * agrees with each: "The commentary are still being written" is what one shared string said.
 */
const WRITE_UP_WORDS: Record<
  WriteUp,
  { title: string; noun: string; needs: string; is: string; it: string; verb: string }
> = {
  commentary: {
    title: "Commentary",
    noun: "The commentary",
    needs: "needs",
    is: "is",
    it: "It",
    verb: "write it",
  },
  board_actions: {
    title: "Where to act",
    noun: "The suggestions",
    needs: "need",
    is: "are",
    it: "They",
    verb: "write them",
  },
};

const MODES: readonly { key: Mode; label: string; icon: IconName; hint: string }[] = [
  { key: "quick", label: "Ask", icon: "chat", hint: "Ask about a figure or a movement" },
  {
    key: "deep",
    label: "Dig deeper",
    icon: "search",
    hint: "Which accounts, customers, suppliers or months drove it",
  },
  {
    key: "edit",
    label: "Build",
    icon: "sliders",
    hint: "Add boxes, comparisons, charts and formulas; rename, move or remove them",
  },
  {
    key: "commentary",
    label: "Commentary",
    icon: "document",
    hint: "A written review of a month",
  },
];

/** A shortfall from the server's 402, or one credit if it did not say: enough to offer a pack. */
const shortfallOf = (text: string | undefined): bigint =>
  text !== undefined && /^[0-9]+$/u.test(text) && text !== "0" ? BigInt(text) : 1n;

const TYPE_WORDS: Record<MessageType, string> = {
  quick: "Ask",
  deep: "Dig deeper",
  investigate: "Investigate",
  edit: "Build",
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

/**
 * Arrow keys move the choice in a radio group, as they do in a native one, and only the checked
 * option is a Tab stop (ADR 0091). Without it the two groups here were a row of separate buttons
 * to a keyboard, with nothing to say they were one choice.
 */
function radioKeys<T>(options: readonly T[], current: T, choose: (next: T) => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    e.preventDefault();
    const index = (options.indexOf(current) + step + options.length) % options.length;
    const next = options[index];
    if (next === undefined) return;
    choose(next);
    e.currentTarget.querySelectorAll<HTMLElement>("[role='radio']")[index]?.focus();
  };
}

/** ⌘ K on a Mac, Ctrl K elsewhere, as the workspace's launcher says it; Ctrl K until hydrated. */
const noSubscription = () => () => undefined;
const shortcutOf = () =>
  /Mac|iPhone|iPad/u.test(navigator.userAgent) ? "⌘ K" : "Ctrl K";

/** "Gross profit" reads as "gross profit" mid-sentence; "EBITDA" stays as it is written. */
const midSentence = (label: string): string =>
  /^\p{Lu}\p{Ll}/u.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;

/** A query column as words: `closing_paise` is "Closing", `ledger_name` is "Ledger name". */
const columnWords = (column: string): string => {
  const words = column
    .replace(/_paise$/u, "")
    .replace(/_/gu, " ")
    .trim();
  return words === "" ? column : words.charAt(0).toUpperCase() + words.slice(1);
};

export function Assistant({
  companyId,
  companyName,
  money,
  currencySymbol,
  periods,
  commentaries,
  resumeThreadId,
  prefill,
  runAction,
  focusNonce,
  onCollapse,
  onLayoutChanged,
  dashboardVersion,
  businessName,
}: {
  companyId: string;
  companyName: string;
  money: NumberFormatOptions;
  /** The company's reporting currency symbol (ADR 0030). */
  currencySymbol: string;
  /** Months with figures, newest first. */
  periods: readonly string[];
  commentaries: readonly CommentaryRow[];
  /**
   * The conversation to reopen on arrival (ADR 0091): the one this browser was last in, or the
   * company's newest; null to start empty. Every visit used to open on a blank panel, with the
   * last answer — and anything still being answered — reachable only through History.
   */
  resumeThreadId: string | null;
  /** "Where to act" pressed on the board, for that month; `nonce` makes a repeat count. */
  runAction: { period: string; nonce: number } | null;
  /** A question handed over by the dashboard's Investigate; `nonce` makes a repeat count. */
  prefill: { type: MessageType; text: string; nonce: number } | null;
  /** Bumped each time the chat is opened, so the cursor lands in the question box. */
  focusNonce: number;
  /** Put the chat away; the workspace keeps a launcher on screen (ADR 0044). */
  onCollapse: () => void;
  /** Shown on the payment sheet when a message is short of credits. */
  businessName: string;
  /** The version of the dashboard on screen beside the chat; null until it has loaded. */
  dashboardVersion: number | null;
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
  // One box (ADR 0046): in Ask, a message that reads as a change to the dashboard is sent as
  // one. The customer is told before they send, and can ask it as a question instead.
  const [askAnyway, setAskAnyway] = useState(false);
  const [text, setText] = useState("");
  const [month, setMonth] = useState(periods[0] ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether the error offers "Try again": a message that failed, or never got an answer back.
  const [retryable, setRetryable] = useState(false);
  // Short of credits, and for what: the copy differs, because only a message is still in the box.
  const [short, setShort] = useState<{ need: bigint; what: WriteUp | "message" } | null>(
    null,
  );
  // A quote carries what it is for (ADR 0091). Without it, accepting one for Where to act
  // posted to the commentary endpoint, which refused it with the credits still held.
  const [quote, setQuote] = useState<{
    jobId: string;
    credits: string;
    expiresAt: string | null;
    period: string;
    kind: WriteUp;
  } | null>(null);
  const [history, setHistory] = useState(false);
  const [names, setNames] = useState<Record<string, string | null>>({});
  /** Tokens already asked for, so a reload of the thread does not open the files again. */
  const namesAsked = useRef(new Set<string>());
  /** Commentaries shown in this conversation: written here, or opened from history. */
  const [shown, setShown] = useState<CommentaryRow[]>([]);
  /** Write-ups made in this visit, so History lists them before the page is reloaded. */
  const [written, setWritten] = useState<CommentaryRow[]>([]);
  /** Opening the last conversation on arrival; the empty state waits for it. */
  const [restoring, setRestoring] = useState(resumeThreadId !== null);
  /** Set once the customer opens, starts or sends anything: a late restore must not undo it. */
  const chose = useRef(false);
  /** The open conversation was full, and the server carried on in a new one. */
  const [continued, setContinued] = useState(false);
  /** Where to act pressed on the board while something else was being answered. */
  const [queued, setQueued] = useState<string | null>(null);
  /**
   * The key of a message whose fate is not known yet — the connection dropped, or the server
   * was still answering it — kept while the same message is sent again, so a retry is the same
   * message and one charge (SPEC §4). A new key would hold the credits a second time.
   */
  const pendingSend = useRef<{ key: string; signature: string } | null>(null);
  const [lineage, setLineage] = useState<
    | { kind: "metric"; key: string; values: MetricValue[] }
    | { kind: "query"; query: AnswerQuery }
    | null
  >(null);
  const [applied, setApplied] = useState<
    Record<string, { target: string; blueprintVersion: number; undone: boolean }>
  >({});
  const [copied, setCopied] = useState<string | null>(null);
  // An answer kept on the board (ADR 0087): pinning, pinned, or why it could not be.
  const [pins, setPins] = useState<Record<string, "pinning" | "pinned" | "failed">>({});
  const shortcut = useSyncExternalStore(noSubscription, shortcutOf, () => "Ctrl K");

  /**
   * Keeps an answer's figures on the board as a box of their own: each one this month against
   * last month, every figure still opening its lineage. It is the board's own "add a box" — no
   * model, no charge, a new version Undo takes back — so it is offered only where the answer
   * cites the engine's figures, never a Deep query's cells.
   */
  const pin = async (messageId: string, metricIds: readonly string[]) => {
    if (dashboardVersion === null || metricIds.length === 0) return;
    setPins((x) => ({ ...x, [messageId]: "pinning" }));
    const names = metricIds.slice(0, 3).map((id) => format.label(id));
    const title = (
      metricIds.length > 3 ? `${names.join(", ")} and more` : names.join(", ")
    ).slice(0, 80);
    const widgetId = `pin_${messageId.replace(/[^a-z0-9]/gu, "").slice(0, 12)}`;
    const widget = {
      id: widgetId,
      kind: "comparison",
      title,
      metrics: metricIds.slice(0, 8),
      dimension: null,
      periods: { kind: "current" },
      layout: { x: 0, y: 99, w: 6, h: 3 },
      compare: "previous_month",
    };
    const r = await api(`/api/companies/${companyId}/dashboard`, {
      body: {
        action: "apply",
        baseVersion: dashboardVersion,
        operations: [{ op: "add", path: "/widgets/-", value: widget }],
      },
      idempotencyKey: newIdempotencyKey(),
    });
    if (r.ok) {
      setPins((x) => ({ ...x, [messageId]: "pinned" }));
      onLayoutChanged();
      return;
    }
    // Pinned on an earlier visit: the board refuses a second box with the same id, and "try
    // again" could never succeed (ADR 0091). If it is there, it is on the board.
    const board = await api<{
      dashboard: { spec: { widgets: { id: string }[] } } | null;
    }>(`/api/companies/${companyId}/dashboard`);
    const there =
      board.ok &&
      board.data.dashboard?.spec.widgets.some((w) => w.id === widgetId) === true;
    setPins((x) => ({ ...x, [messageId]: there ? "pinned" : "failed" }));
  };
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

  /** `quiet` for a reload nobody asked for, which should not put an error in the conversation. */
  const openThread = useCallback(async (id: string, quiet = false) => {
    const r = await api<ThreadView>(`/api/chat/threads/${id}`);
    if (r.ok) setThread(r.data);
    else if (!quiet) setError(r.message);
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // Back to the conversation that was on screen last time (ADR 0091), unless the customer has
  // already started on something else while it loaded — what they chose wins.
  useEffect(() => {
    if (resumeThreadId === null) return;
    let live = true;
    void api<ThreadView>(`/api/chat/threads/${resumeThreadId}`).then((r) => {
      if (!live) return;
      if (r.ok && !chose.current) setThread(r.data);
      // Gone, or not this account's: start empty, and stop asking for it on every visit.
      if (!r.ok && r.status === 404) remember(CHAT_THREAD_COOKIE, `${companyId}.new`);
      setRestoring(false);
    });
    return () => {
      live = false;
    };
  }, [resumeThreadId, companyId]);

  // Remember the conversation on screen, so a reload or the next visit comes back to it. A
  // cookie the page reads, like the chat's open or closed state (ADR 0044).
  const threadId = thread?.threadId ?? null;
  useEffect(() => {
    if (threadId !== null) remember(CHAT_THREAD_COOKIE, `${companyId}.${threadId}`);
  }, [threadId, companyId]);

  // A message still being answered — the page was reloaded during a Deep answer, or a retry
  // reached one that was already running — is looked at again until it lands. Two minutes is
  // the longest a message can run (`maxDuration`); after that the sweeper settles it.
  const unanswered =
    thread?.messages.some((m) => m.role === "user" && UNANSWERED.has(m.state)) ?? false;
  const polls = useRef(0);
  useEffect(() => {
    polls.current = 0;
  }, [threadId]);
  useEffect(() => {
    if (!unanswered || busy !== null || threadId === null || polls.current >= 30) return;
    const later = setTimeout(() => {
      polls.current += 1;
      void openThread(threadId, true);
    }, 5000);
    return () => {
      clearTimeout(later);
    };
  }, [unanswered, busy, threadId, thread, openThread]);

  // An Investigate press on the dashboard lands here as a ready-to-send deeper question.
  useEffect(() => {
    if (prefill === null) return;
    setMode(prefill.type === "investigate" ? "deep" : prefill.type);
    setInvestigating(prefill.type === "investigate");
    setText(prefill.text);
    input.current?.focus();
  }, [prefill]);

  // Opening the chat is a request to type in it.
  useEffect(() => {
    if (focusNonce > 0) input.current?.focus();
  }, [focusNonce]);

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

  // Keep the newest item in view — from its first line when it is taller than the panel, so a
  // long answer is read from the top rather than opened on its last paragraph (ADR 0091).
  const itemCount =
    (thread?.messages.length ?? 0) + shown.length + (asking === null ? 0 : 1);
  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const last = [...el.querySelectorAll<HTMLElement>("[data-item]")].at(-1);
    if (busy === null && last !== undefined && last.offsetHeight > el.clientHeight) {
      el.scrollTop +=
        last.getBoundingClientRect().top - el.getBoundingClientRect().top - 16;
    } else el.scrollTop = el.scrollHeight;
  }, [itemCount, busy]);

  // Names for tokens in answers, from this company's most recent upload while it is kept. Only
  // tokens not yet asked about: each lookup opens the kept files, and every opening is on the
  // customer's record (ADR 0047), so reloading a thread must not add a line to it each time.
  useEffect(() => {
    if (thread === null) return;
    const tokens = new Set<string>();
    for (const m of thread.messages) {
      const blob = JSON.stringify([m.reply, m.queries]);
      for (const t of blob.matchAll(/\b[A-Z]+_[0-9a-f]{12}\b/gu))
        if (!namesAsked.current.has(t[0])) tokens.add(t[0]);
    }
    if (tokens.size === 0) return;
    const asked = [...tokens].slice(0, 500);
    for (const t of asked) namesAsked.current.add(t);
    void api<{ names: Record<string, string | null> }>(
      `/api/companies/${companyId}/chat/names`,
      { body: { tokens: asked } },
    ).then((r) => {
      if (r.ok) setNames((known) => ({ ...known, ...r.data.names }));
      // Not answered (the rate limit, a dropped connection): free to ask again next time.
      else for (const t of asked) namesAsked.current.delete(t);
    });
  }, [thread, companyId]);

  const reset = () => {
    setError(null);
    setRetryable(false);
    setShort(null);
  };

  const building = mode === "quick" && !askAnyway && detectIntent(text) === "dashboard";

  const send = async () => {
    if (text.trim() === "" || busy !== null) return;
    chose.current = true;
    reset();
    setAsking(text.trim());
    const type: MessageType =
      investigating && mode === "deep"
        ? "investigate"
        : mode === "commentary"
          ? "quick"
          : building
            ? "edit"
            : mode;
    const target = building ? "dashboard" : editTarget;
    const sentTo = thread?.status === "open" ? thread.threadId : null;
    const body = {
      companyId,
      threadId: sentTo,
      type,
      tier,
      text,
      ...(type === "edit" ? { editTarget: target } : {}),
    };
    // The same message sent again after an unknown outcome keeps its key, so the server
    // answers it once and replays that answer, rather than holding its price a second time.
    const signature = JSON.stringify(body);
    if (pendingSend.current?.signature !== signature)
      pendingSend.current = { key: newIdempotencyKey(), signature };
    const key = pendingSend.current.key;
    setBusy(
      type === "quick" || type === "edit" ? "Thinking…" : "Looking through the figures…",
    );
    try {
      const r = await api<{ messageId: string; threadId: string; progress: Progress }>(
        "/api/chat/messages",
        { body, idempotencyKey: key },
      );
      if (!r.ok) {
        // No answer at all — the connection, a server fault, or the first attempt still
        // running — leaves the message's fate unknown, so its key is kept for the retry.
        const unknown = r.status === 0 || r.status >= 500 || r.error === "in_progress";
        if (!unknown) pendingSend.current = null;
        // The server says how far short: enough to offer the smallest pack that covers it.
        if (r.status === 402)
          setShort({ need: shortfallOf(r.fields["shortfall"]), what: "message" });
        else if (r.error === "in_progress")
          setError(
            "This message is still being answered. Try again in a moment to see the answer; it will not be charged twice.",
          );
        else
          setError(
            unknown
              ? `${r.message} Your message is still in the box, and sending it again will not charge it twice.`
              : r.message,
          );
        setRetryable(unknown);
        return;
      }
      pendingSend.current = null;
      const progress = r.data.progress;
      // Deep questions run their queries on the server and come back answered (ADR 0032). One
      // that did not stays in the box with a way to send it again: nothing was charged for it,
      // and having to type it out a second time was the only way back (ADR 0091).
      if (progress.status === "failed") {
        setError(
          type === "edit"
            ? "This change could not be made, and no credits were charged. It is still in the box: naming the box and the figure usually helps, for example “add a chart of revenue for the last six months”."
            : "This message could not be answered, and no credits were charged. It is still in the box to try again.",
        );
        setRetryable(true);
      } else {
        // Answered, or still being answered by an earlier attempt, which the thread will show.
        setText("");
        setInvestigating(false);
        setAskAnyway(false);
      }
      // The open conversation was full: the server carried on in a new one, seeded with a
      // summary of the old, and the earlier messages are in History (SPEC §27).
      if (sentTo !== null && r.data.threadId !== sentTo) setContinued(true);
      await openThread(r.data.threadId);
      // A dashboard change is applied as it is proposed: the dashboard beside this loads it.
      if (progress.status === "completed" && type === "edit" && target === "dashboard")
        onLayoutChanged();
      await loadThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The message could not be sent.");
    } finally {
      setBusy(null);
      setAsking(null);
    }
  };

  const afterHold = async (result: StartResult, period: string, kind: WriteUp) => {
    if (result.kind === "quote") {
      setQuote({ ...result, period, kind });
      return;
    }
    setQuote(null);
    if (result.kind === "short") {
      setShort({ need: result.need, what: kind });
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    const path = kind === "commentary" ? "commentary" : "board-actions";
    const words = WRITE_UP_WORDS[kind];
    const r = await api<{ state: string }>(`/api/jobs/${result.jobId}/${path}`, {
      body: { period },
      idempotencyKey: newIdempotencyKey(),
    });
    if (!r.ok) {
      setError(r.message);
      return;
    }
    const row = {
      id: result.jobId,
      state: r.data.state,
      period,
      createdAt: new Date().toISOString(),
      kind,
    };
    // In History straight away, whatever came of it, rather than after the next reload.
    if (r.data.state !== "failed") setWritten((list) => [row, ...list]);
    if (r.data.state === "completed") setShown((list) => [...list, row]);
    else if (r.data.state === "failed")
      setError(`${words.noun} could not be written. No credits were charged.`);
    else
      setError(
        `${words.noun} ${words.is} still being written. ${words.it} will be in History when done.`,
      );
  };

  /**
   * "Where to act" (ADR 0062): what the board should do about the month, as its own priced
   * action. Commentary describes; this prescribes, and the two are never mixed in one document.
   */
  const suggestActions = async (forPeriod?: string) => {
    const period = forPeriod ?? month;
    if (period === "" || busy !== null) return;
    reset();
    setMonth(period);
    // The tier is said, because the board's button runs at whatever the chat is set to.
    setBusy(
      `Reading ${format.period(period)} for what to act on, at ${TIER_LABELS[tier]}…`,
    );
    try {
      await afterHold(
        await startPaidJob({
          companyId,
          type: "board_actions",
          tier,
          size: ZERO_SIZE,
          fingerprints: {},
        }),
        period,
        "board_actions",
      );
    } finally {
      setBusy(null);
    }
  };
  // The board's button drives the same call. The nonce is what makes a second press count and
  // what stops a re-render from running it again: the effect's other dependencies change while
  // the job is in flight, and this is the one that says whether it is a new request.
  //
  // Pressed while an answer is on its way, it waits its turn and says so (ADR 0091): it used to
  // spend the press and do nothing, with the chat opened on a conversation that never changed.
  const lastAction = useRef(0);
  useEffect(() => {
    if (runAction === null || runAction.nonce === lastAction.current) return;
    lastAction.current = runAction.nonce;
    if (busy === null) void suggestActions(runAction.period);
    else setQueued(runAction.period);
  }, [runAction]);
  useEffect(() => {
    if (queued === null || busy !== null) return;
    setQueued(null);
    void suggestActions(queued);
  }, [queued, busy]);

  const writeCommentary = async () => {
    if (month === "" || busy !== null) return;
    reset();
    setBusy(
      `Writing the commentary for ${format.period(month)}, at ${TIER_LABELS[tier]}…`,
    );
    try {
      await afterHold(
        await startPaidJob({
          companyId,
          type: "commentary",
          tier,
          size: ZERO_SIZE,
          fingerprints: {},
        }),
        month,
        "commentary",
      );
    } finally {
      setBusy(null);
    }
  };

  // Every write-up this company has, newest first: the page's list and what was written here.
  const writeUps = useMemo(() => {
    const byId = new Map<string, CommentaryRow>();
    for (const c of [...written, ...commentaries]) if (!byId.has(c.id)) byId.set(c.id, c);
    return [...byId.values()];
  }, [written, commentaries]);

  /**
   * The finished write-up of this kind for a month, if there is one: offered before the button
   * that would pay for another (ADR 0091), since the same month written twice was easy to buy
   * by accident. Pressing the button again is still allowed — the books may have been refreshed.
   */
  const writtenFor = (kind: WriteUp, period: string) =>
    writeUps.find(
      (c) =>
        (c.kind ?? "commentary") === kind &&
        c.period === period &&
        c.state === "completed",
    );

  const openWriteUp = (c: CommentaryRow) => {
    setShown((list) => (list.some((x) => x.id === c.id) ? list : [...list, c]));
  };

  // History closes on Escape like every other layer here (ADR 0091); an open lineage drawer
  // over it takes the key first.
  useEffect(() => {
    if (!history || lineage !== null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setHistory(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [history, lineage]);

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

  /**
   * Whether a layout change is on the dashboard, and as which version: what this session did
   * to it (applied by hand, or undone), else what the saved reply says the server did when it
   * answered (ADR 0046). One place, because the first version let the bubble read the reply and
   * Undo read only the session, so after a reload Undo was shown and did nothing.
   */
  const appliedOf = (m: MessageView) => {
    const here = applied[m.id];
    if (here !== undefined) return here;
    const reply = m.reply;
    return reply?.kind === "edit" &&
      typeof reply.appliedVersion === "number" &&
      reply.target !== undefined
      ? { target: reply.target, blueprintVersion: reply.appliedVersion, undone: false }
      : undefined;
  };

  const undo = async (m: MessageView) => {
    const done = appliedOf(m);
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
      out.push(`What drove ${midSentence(format.label(base))}?`);
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
        setText("Which expenses grew the most, and which accounts drove it?");
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
      className="relative flex h-[calc(100vh-7rem)] max-h-[calc(100vh-2rem)] min-h-[min(34rem,calc(100vh-2rem))] flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-surface shadow-sm"
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
            Every number computed, never written
          </p>
        </div>
        <button
          type="button"
          aria-expanded={history}
          aria-label="History"
          title="History"
          className={`rounded-md p-1.5 ${
            history
              ? "bg-accent-50 text-accent-800"
              : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          }`}
          onClick={() => {
            setHistory((h) => !h);
          }}
        >
          <Icon name="clock" size={16} />
        </button>
        <button
          type="button"
          aria-label="New conversation"
          title="New conversation"
          className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          onClick={() => {
            chose.current = true;
            setThread(null);
            setShown([]);
            setHistory(false);
            setContinued(false);
            reset();
            // A reload comes back to the fresh start, not to the conversation just left.
            remember(CHAT_THREAD_COOKIE, `${companyId}.new`);
          }}
        >
          <Icon name="plus" size={16} />
        </button>
        <button
          type="button"
          aria-label="Hide chat"
          title={`Hide chat (${shortcut})`}
          className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          onClick={onCollapse}
          data-testid="chat-collapse"
        >
          <Icon name="chevron-right" size={16} />
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
                      chose.current = true;
                      setShown([]);
                      setHistory(false);
                      setContinued(false);
                      void openThread(t.id);
                    }}
                  >
                    {when(t.createdAt)}
                    {/* Newest first, so the conversation it carried on in is the one above. */}
                    {t.status === "capped" ? " · full, continued above" : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="eyebrow mb-2">Commentary and where to act</p>
          {writeUps.length === 0 ? (
            <p className="text-[0.8125rem] text-neutral-500">None yet.</p>
          ) : (
            <ul className="flex flex-col gap-0.5" data-testid="commentary-jobs">
              {writeUps.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={c.state !== "completed"}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[0.8125rem] text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400 disabled:hover:bg-transparent"
                    onClick={() => {
                      openWriteUp(c);
                      setHistory(false);
                    }}
                  >
                    <span className="font-medium">
                      {WRITE_UP_WORDS[c.kind ?? "commentary"].title} ·{" "}
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

      {/* A log, so a screen reader hears each answer as it arrives (ADR 0091). Busy while the
          last conversation is being opened, so a whole thread is not read out on arrival. */}
      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        aria-busy={restoring}
        className="scroll-slim flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 text-sm"
        data-testid="chat-messages"
      >
        {continued ? (
          <p
            className="flex items-center gap-2 text-[0.75rem] text-neutral-500"
            data-testid="chat-continued"
          >
            <span className="h-px flex-1 bg-neutral-200" aria-hidden="true" />
            Earlier messages are in History. A summary of them carries on here.
            <span className="h-px flex-1 bg-neutral-200" aria-hidden="true" />
          </p>
        ) : null}
        {timeline.length === 0 && restoring ? (
          <p className="my-auto text-center text-[0.8125rem] text-neutral-500">
            Opening your last conversation…
          </p>
        ) : timeline.length === 0 ? (
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
                  data-item
                  className="message-in rounded-xl border border-neutral-200 bg-surface p-4 break-words shadow-sm"
                >
                  <p className="eyebrow mb-2 flex items-center gap-1.5">
                    <Icon
                      name={c.kind === "board_actions" ? "target" : "document"}
                      size={12}
                    />
                    {WRITE_UP_WORDS[c.kind ?? "commentary"].title} ·{" "}
                    {c.period === null ? "—" : format.period(c.period)}
                  </p>
                  {c.kind === "board_actions" ? (
                    <BoardActionsView jobId={c.id} />
                  ) : (
                    <CommentaryView
                      jobId={c.id}
                      companyName={companyName}
                      periodLabel={c.period === null ? "" : format.period(c.period)}
                    />
                  )}
                </div>
              );
            }
            const m = item.message;
            if (m.role === "user")
              return (
                <div
                  key={m.id}
                  data-item
                  className="message-in ml-auto max-w-[88%] rounded-2xl rounded-br-sm bg-accent-600 px-3.5 py-2.5 break-words text-white"
                  data-testid="chat-user"
                >
                  <p className="leading-relaxed">{m.text}</p>
                  <p className="mt-1 text-[0.6875rem] text-white/80">
                    {TYPE_WORDS[m.type ?? "quick"]} ·{" "}
                    {m.state === "failed_platform"
                      ? "not answered, not charged"
                      : m.state === "declined_out_of_scope"
                        ? `outside this MIS · ${formatCredits(m.creditsCharged)} credits`
                        : UNANSWERED.has(m.state)
                          ? "being answered…"
                          : `${formatCredits(m.creditsCharged)} credits`}
                    {/* Back in the box with its kind, to send again or reword first: nothing
                        was charged for it, so retyping it was the only cost (ADR 0091). */}
                    {m.state === "failed_platform" && m.text !== null ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="font-medium text-white underline underline-offset-2"
                          onClick={() => {
                            const kind = m.type ?? "quick";
                            setMode(kind === "investigate" ? "deep" : kind);
                            setInvestigating(kind === "investigate");
                            setAskAnyway(false);
                            setText(m.text ?? "");
                            input.current?.focus();
                          }}
                          data-testid="chat-resend"
                        >
                          Edit and resend
                        </button>
                      </>
                    ) : null}
                  </p>
                </div>
              );
            const reply = m.reply;
            if (reply?.kind === "edit") {
              const done = appliedOf(m);
              // Undo is offered only while this change is still the one on screen. Once the
              // dashboard has moved past it (undone, or changed again) the reply says so: an
              // Undo here could only fail, and "Done" would no longer be true of the board.
              const moved =
                done !== undefined &&
                !done.undone &&
                done.target === "dashboard" &&
                dashboardVersion !== null &&
                dashboardVersion > done.blueprintVersion;
              // Until the board beside it has loaded, whether a change is still on it is not
              // known: an old change would claim "Done" and offer an Undo for a moment.
              const unknown =
                done !== undefined &&
                !done.undone &&
                done.target === "dashboard" &&
                dashboardVersion === null;
              return (
                <div
                  key={m.id}
                  data-item
                  className="message-in max-w-[94%] rounded-2xl rounded-bl-sm border border-neutral-200 bg-neutral-25 p-3.5 break-words"
                  data-testid="chat-edit"
                >
                  <p className="leading-relaxed text-neutral-800">{reply.summary}</p>
                  {/* No operations means the board already shows what was asked: the summary
                      says so, and there is nothing to apply, preview or undo. */}
                  {reply.scope === "in_scope" && (reply.operations?.length ?? 0) > 0 ? (
                    <>
                      <details className="mt-2 text-[0.75rem] text-neutral-500">
                        <summary className="cursor-pointer select-none">
                          The exact change
                        </summary>
                        {/* The neutral ramp turns over in dark mode, so this stays a quiet
                            panel there; the dark `neutral-900` it had became a white block. */}
                        <pre
                          className="scroll-slim mt-1.5 overflow-x-auto rounded-lg bg-neutral-100 p-3 text-[0.6875rem] text-neutral-800"
                          data-testid="chat-edit-preview"
                        >
                          {JSON.stringify(reply.operations, null, 2)}
                        </pre>
                      </details>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        {unknown ? null : done === undefined ? (
                          <>
                            {/* Say what Apply does, and for a dashboard change why it is
                                waiting at all: the server applies those as it answers. */}
                            <span className="text-neutral-600">
                              {reply.target === "template"
                                ? "Apply puts this into the MIS workbook layout, from the next workbook on."
                                : reply.appliedVersion === null
                                  ? "Not applied: the dashboard changed while this was being answered."
                                  : "Apply puts this on the dashboard."}
                            </span>
                            <Button size="sm" onClick={() => void apply(m)}>
                              Apply change
                            </Button>
                          </>
                        ) : done.undone ? (
                          <span className="text-neutral-700">Undone.</span>
                        ) : moved ? (
                          <span
                            className="text-neutral-500"
                            data-testid="chat-edit-moved"
                          >
                            Applied earlier. The dashboard has changed since.
                          </span>
                        ) : (
                          <>
                            {/* What was just changed is this company's own, and stays (ADR 0045). */}
                            <span
                              className="text-neutral-700"
                              data-testid="chat-edit-applied"
                            >
                              {done.target === "dashboard"
                                ? "Done. It is on the dashboard."
                                : "Applied to the MIS, from the next workbook on."}{" "}
                              <span className="text-neutral-500">
                                Kept for {companyName} only, until you change it.
                              </span>
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
                data-item
                className="message-in max-w-[94%] rounded-2xl rounded-bl-sm border border-neutral-200 bg-neutral-25 p-3.5 break-words"
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
                      {(() => {
                        // The engine's figures the answer cites, once each by metric.
                        const metricIds = [
                          ...new Set(
                            rendered.paragraphs.flatMap((para) =>
                              para.flatMap((seg) =>
                                seg.kind === "value" && seg.metricKey !== null
                                  ? // The figure, without its month, split or comparison.
                                    [
                                      parseMetricKey(seg.metricKey).metricId.split(
                                        ".",
                                      )[0] ?? "",
                                    ]
                                  : [],
                              ),
                            ),
                          ),
                        ].filter((id) => id !== "");
                        if (metricIds.length === 0 || dashboardVersion === null)
                          return null;
                        const state = pins[m.id];
                        return (
                          <button
                            type="button"
                            disabled={state === "pinning" || state === "pinned"}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.6875rem] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:hover:bg-transparent"
                            onClick={() => void pin(m.id, metricIds)}
                            data-testid="chat-pin"
                          >
                            <Icon name="plus" size={11} />
                            {state === "pinned"
                              ? "On the board"
                              : state === "failed"
                                ? "Could not pin; try again"
                                : "Pin to board"}
                          </button>
                        );
                      })()}
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
            className="message-in ml-auto max-w-[88%] rounded-2xl rounded-br-sm bg-accent-600 px-3.5 py-2.5 break-words text-white opacity-80"
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
              <span className="tabular-nums text-neutral-500">{waited.toString()}s</span>
            )}
          </div>
        )}
        {queued === null ? null : (
          <p className="text-[0.8125rem] text-neutral-600" role="status">
            Where to act for {format.period(queued)} starts as soon as this answer is
            done.
          </p>
        )}
        {quote === null ? null : (
          <Alert tone="warning" title="This one needs a quote">
            <p>
              {WRITE_UP_WORDS[quote.kind].noun} for {format.period(quote.period)}{" "}
              {WRITE_UP_WORDS[quote.kind].needs} more analysis than the standard price
              covers:{" "}
              <strong className="tabular-nums">{formatCredits(quote.credits)}</strong>{" "}
              credits. The offer stands until{" "}
              {quote.expiresAt === null ? "soon" : istLabelled(new Date(quote.expiresAt))}
              .
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  const q = quote;
                  setBusy(
                    q.kind === "commentary"
                      ? `Writing the commentary for ${format.period(q.period)}…`
                      : `Reading ${format.period(q.period)} for what to act on…`,
                  );
                  void acceptQuote(q.jobId, q.credits)
                    .then(async (r) => {
                      await afterHold(r, q.period, q.kind);
                      // Short of the quote: it stays, to accept once topped up (ADR 0049).
                      if (r.kind === "short") setQuote(q);
                    })
                    .finally(() => {
                      setBusy(null);
                    });
                }}
              >
                Accept and {WRITE_UP_WORDS[quote.kind].verb}
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
        {/* Out of credits mid-conversation: nothing was charged, the message is still in the
            box, and the top-up happens here rather than on another page (ADR 0049). */}
        {short === null ? null : (
          <div data-testid="chat-short">
            <p className="mb-2 text-[0.8125rem] text-neutral-600">
              {short.what === "message"
                ? "That message needs a few more credits. Nothing was charged, and your message is still in the box to send."
                : `${WRITE_UP_WORDS[short.what].noun} ${WRITE_UP_WORDS[short.what].needs} a few more credits. Nothing was charged. Add credits here, then ${
                    quote !== null
                      ? "accept the quote above"
                      : `press ${short.what === "commentary" ? "Write the commentary" : "Where to act"} again`
                  }.`}
            </p>
            <BuyCreditsInline
              need={short.need}
              businessName={businessName}
              onCredited={() => {
                setShort(null);
              }}
            />
          </div>
        )}
        {error === null ? null : (
          <Alert tone="error">
            {error}
            {retryable ? (
              <span className="mt-2 block">
                <Button
                  size="sm"
                  variant="secondary"
                  icon="refresh"
                  disabled={busy !== null || text.trim() === ""}
                  onClick={() => void send()}
                  data-testid="chat-retry"
                >
                  Try again
                </Button>
              </span>
            ) : null}
          </Alert>
        )}
      </div>

      <div className="border-t border-neutral-100 bg-neutral-25 p-3">
        <div
          className="mb-2 flex flex-wrap gap-1"
          role="radiogroup"
          aria-label="What you want"
          data-testid="chat-type"
          onKeyDown={radioKeys(
            MODES.map((m) => m.key),
            mode,
            (next) => {
              setMode(next);
              setInvestigating(false);
            },
          )}
        >
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              tabIndex={mode === m.key ? 0 : -1}
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
                {(["commentary", "board_actions"] as const).map((kind) => {
                  const done = writtenFor(kind, month);
                  return done === undefined ? null : (
                    <p
                      key={kind}
                      className="flex items-center justify-between gap-2 text-[0.75rem] text-neutral-600"
                      data-testid={`written-${kind}`}
                    >
                      <span>
                        {WRITE_UP_WORDS[kind].title} for {format.period(month)} was
                        written on {when(done.createdAt)}.
                      </span>
                      <button
                        type="button"
                        className="shrink-0 font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
                        onClick={() => {
                          openWriteUp(done);
                        }}
                      >
                        Open it
                      </button>
                    </p>
                  );
                })}
                <Button
                  onClick={() => void writeCommentary()}
                  disabled={busy !== null}
                  icon="document"
                  data-testid="commentary-write"
                >
                  Write the commentary
                </Button>
                <Button
                  onClick={() => void suggestActions()}
                  disabled={busy !== null}
                  icon="target"
                  data-testid="board-actions-write"
                >
                  Where to act
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
                  ? "For example: add a box comparing revenue and profit with last year"
                  : mode === "deep"
                    ? "For example: which customers drove the rise in receivables?"
                    : `Ask about ${companyName}, or say what to put on the dashboard`
              }
              maxLength={2000}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (e.target.value.trim() === "") setAskAnyway(false);
              }}
              onKeyDown={(e) => {
                // Enter while an input method is composing picks a word; it does not send
                // (ADR 0091) — commentary is written in languages typed that way.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
              ) : building ? (
                <span
                  className="flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-neutral-600"
                  data-testid="chat-building"
                >
                  <Icon name="chart" size={12} className="shrink-0 text-accent-600" />
                  <span className="truncate">This will update the dashboard.</span>
                  <button
                    type="button"
                    className="shrink-0 font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
                    onClick={() => {
                      setAskAnyway(true);
                    }}
                  >
                    Ask it instead
                  </button>
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
            onKeyDown={radioKeys(Object.keys(TIER_LABELS) as Tier[], tier, setTier)}
          >
            {(Object.keys(TIER_LABELS) as Tier[]).map((t) => {
              const on = t === tier;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
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
          {/* What a message costs is one quiet link away, as on the Wallet (ADR 0050); the
              chooser itself shows no credits (ADR 0041). */}
          <p className="mt-1.5 text-[0.6875rem] text-neutral-500">
            Every message uses credits, including questions outside this MIS.{" "}
            <Link
              href="/wallet/prices"
              className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
              data-testid="chat-prices"
            >
              See prices
            </Link>
          </p>
          <MistakesNote className="mt-0.5">
            Check anything important against your books.
          </MistakesNote>
        </div>
      </div>

      {/* Both panels end in a Close of their own, so the drawer draws none. */}
      <Drawer
        open={lineage !== null}
        label="Lineage"
        onClose={() => {
          setLineage(null);
        }}
        closeButton={false}
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
            <p className="mb-3 text-neutral-700">{lineage.query.purpose}</p>
            {/* The result first, read the way the answer reads it (ADR 0091): money as money in
                the company's own currency and scale, names in place of tokens, and headings in
                words. It used to print minor units under the query's own column names. */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 text-neutral-600">
                    {lineage.query.result.columns.map((c) => (
                      <th
                        key={c}
                        scope="col"
                        title={c}
                        className={`py-1.5 pr-3 font-medium ${
                          isPaiseColumn(c) ? "text-right" : "text-left"
                        }`}
                      >
                        {columnWords(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineage.query.result.rows.map((r, i) => (
                    <tr key={i} className="border-b border-neutral-100 last:border-0">
                      {r.map((c, j) => {
                        const column = lineage.query.result.columns[j] ?? "";
                        const asMoney = /^-?\d+$/u.test(c) && isPaiseColumn(column);
                        return (
                          <td
                            key={j}
                            className={`py-1.5 pr-3 break-words text-neutral-800 ${
                              asMoney ? "text-right tabular-nums" : ""
                            }`}
                          >
                            {asMoney ? format.money(c) : (names[c] ?? c)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="mt-3 text-[0.75rem] text-neutral-600">
              <summary className="cursor-pointer select-none">
                How it was worked out
              </summary>
              <p className="mt-1.5">Tables: {lineage.query.tables.join(", ")}</p>
              <pre className="scroll-slim mt-1.5 overflow-x-auto rounded-lg bg-neutral-100 p-3 text-[0.6875rem] whitespace-pre-wrap text-neutral-800">
                {lineage.query.sql}
              </pre>
            </details>
          </aside>
        )}
      </Drawer>
    </aside>
  );
}
