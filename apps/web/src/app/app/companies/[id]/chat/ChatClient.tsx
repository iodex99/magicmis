"use client";

/**
 * Chat with the MIS (SPEC §27). The user picks the message type, which is the price; the send
 * button shows it. Deep questions need this company's files loaded in this browser: they are read
 * here, queried in a locked DuckDB, and only redacted, capped results go to the server. Every
 * figure in an answer is a placeholder resolved here, after the placeholder check runs again, and
 * opens its lineage: a metric's formula and inputs, or the query that produced a cell.
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
import { useCallback, useEffect, useMemo, useState } from "react";

import { LineagePanel } from "@/components/LineagePanel";
import { Alert, Button, Panel } from "@/components/ui";
import { formatCredits, TIER_LABELS } from "@/lib/actions";
import { api, newIdempotencyKey } from "@/lib/client-api";
import { clearPipeline, pipelineClient } from "@/lib/pipeline/client";
import type { JobSession } from "@/lib/server/companies";

type MessageType = "quick" | "deep" | "edit" | "investigate";
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

type Progress =
  | { status: "completed"; state: string; capturedCredits: string }
  | { status: "needs_query"; stepId: string; stepRef: string; sql: string }
  | { status: "failed"; reason: string };

interface ChatCaps {
  rowsPerRound: number;
  bytesPerRound: number;
  queryTimeoutMs: number;
}

const ACTION: Record<MessageType, "chat_quick" | "chat_deep" | "chat_edit"> = {
  quick: "chat_quick",
  deep: "chat_deep",
  investigate: "chat_deep",
  edit: "chat_edit",
};

const TYPE_LABELS: Record<Exclude<MessageType, "investigate">, string> = {
  quick: "Quick answer",
  deep: "Deep answer (queries your loaded files)",
  edit: "Edit dashboard or MIS layout",
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
            className="tabular-nums underline decoration-neutral-300 underline-offset-4 hover:decoration-accent-600"
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

export function ChatClient({
  companyId,
  money,
  prefill,
}: {
  companyId: string;
  money: NumberFormatOptions;
  prefill: { type: MessageType; text: string } | null;
}) {
  const [threads, setThreads] = useState<{ id: string; status: string; createdAt: string }[]>([]);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [type, setType] = useState<MessageType>(prefill?.type ?? "quick");
  const [tier, setTier] = useState<Tier>("professional");
  const [editTarget, setEditTarget] = useState<"dashboard" | "template">("dashboard");
  const [text, setText] = useState(prefill?.text ?? "");
  const [price, setPrice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ loaded: boolean; balances: number } | null>(null);
  const [caps, setCaps] = useState<ChatCaps | null>(null);
  const [names, setNames] = useState<Record<string, string | null>>({});
  const [lineage, setLineage] = useState<{ kind: "metric"; key: string; values: MetricValue[] } | { kind: "query"; query: AnswerQuery } | null>(null);
  const [applied, setApplied] = useState<Record<string, { target: string; blueprintVersion: number; undone: boolean }>>({});

  const format = useMemo(() => companyFormat(money), [money]);

  const loadThreads = useCallback(async () => {
    const r = await api<{ threads: { id: string; status: string; createdAt: string }[] }>(`/api/companies/${companyId}/chat`);
    if (r.ok) setThreads(r.data.threads);
  }, [companyId]);

  const openThread = useCallback(async (id: string) => {
    const r = await api<ThreadView>(`/api/chat/threads/${id}`);
    if (r.ok) setThread(r.data);
    else setError(r.message);
  }, []);

  useEffect(() => {
    void loadThreads();
    void api<{ limits: unknown; chat: ChatCaps }>("/api/ingest/config").then((r) => {
      if (r.ok) setCaps(r.data.chat);
    });
    return () => {
      void clearPipeline();
    };
  }, [loadThreads]);

  useEffect(() => {
    let cancelled = false;
    setPrice(null);
    void api<{ credits: string }>("/api/pricing/preview", {
      body: { actionKey: ACTION[type], tier, delivery: "instant" },
    }).then((r) => {
      if (!cancelled && r.ok) setPrice(r.data.credits);
    });
    return () => {
      cancelled = true;
    };
  }, [type, tier]);

  // Names for tokens in answers, only from files loaded in this session.
  useEffect(() => {
    if (thread === null || session?.loaded !== true) return;
    const tokens = new Set<string>();
    for (const m of thread.messages) {
      const blob = JSON.stringify([m.reply, m.queries]);
      for (const t of blob.matchAll(/\b[A-Z]+_[0-9a-f]{12}\b/gu)) tokens.add(t[0]);
    }
    void pipelineClient()
      .displayNames([...tokens])
      .then(setNames);
  }, [thread, session]);

  const loadFiles = async (list: FileList | null) => {
    if (list === null || list.length === 0) return;
    setError(null);
    setBusy("Reading files in your browser…");
    try {
      const [s, config] = await Promise.all([
        api<JobSession>(`/api/companies/${companyId}/session`),
        api<{ limits: Parameters<ReturnType<typeof pipelineClient>["start"]>[1] }>("/api/ingest/config"),
      ]);
      if (!s.ok || !config.ok) throw new Error(s.ok ? "Could not load limits." : s.message);
      const pipeline = pipelineClient();
      await pipeline.start(s.data, config.data.limits);
      const added = await pipeline.addFiles([...list]);
      if (added.refused !== null) throw new Error("These files could not be loaded.");
      const tables = await pipeline.chatStart();
      setSession({ loaded: true, balances: tables.balances });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The files could not be loaded.");
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (text.trim() === "") return;
    setError(null);
    setBusy("Sending…");
    try {
      const r = await api<{ messageId: string; threadId: string; progress: Progress }>("/api/chat/messages", {
        body: {
          companyId,
          threadId: thread?.status === "open" ? thread.threadId : null,
          type,
          tier,
          text,
          ...(type === "edit" ? { editTarget } : {}),
        },
        idempotencyKey: newIdempotencyKey(),
      });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      let progress = r.data.progress;
      let rounds = 0;
      while (progress.status === "needs_query") {
        rounds += 1;
        if (caps === null || session?.loaded !== true) throw new Error("Load this company's files to answer Deep questions.");
        setBusy(`Running query ${rounds.toString()} in your browser…`);
        const outcome = await pipelineClient().chatQuery(progress.sql, caps);
        const step: Awaited<ReturnType<typeof api<Progress>>> = await api<Progress>(
          `/api/chat/messages/${r.data.messageId}/steps/${progress.stepId}/result`,
          { body: outcome, idempotencyKey: newIdempotencyKey() },
        );
        if (!step.ok) throw new Error(step.message);
        progress = step.data;
      }
      if (progress.status === "failed") setError("This message could not be answered. No credits were charged.");
      setText("");
      await openThread(r.data.threadId);
      await loadThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The message could not be sent.");
    } finally {
      setBusy(null);
    }
  };

  const apply = async (m: MessageView) => {
    if (thread === null) return;
    const r = await api<{ target: string; blueprintVersion: number }>(`/api/chat/messages/${m.id}/apply`, {
      body: { threadId: thread.threadId },
      idempotencyKey: newIdempotencyKey(),
    });
    if (r.ok) setApplied((a) => ({ ...a, [m.id]: { ...r.data, undone: false } }));
    else setError(r.message);
  };

  const undo = async (m: MessageView) => {
    const done = applied[m.id];
    if (done === undefined) return;
    const r = await api(
      done.target === "dashboard" ? `/api/companies/${companyId}/dashboard` : `/api/companies/${companyId}/template`,
      { body: { action: "undo", baseVersion: done.blueprintVersion }, idempotencyKey: newIdempotencyKey() },
    );
    if (r.ok) setApplied((a) => ({ ...a, [m.id]: { ...done, undone: true } }));
    else setError(r.message);
  };

  const deepDisabled = (type === "deep" || type === "investigate") && session?.loaded !== true;

  return (
    <div className="flex gap-4">
      <aside className="w-56 shrink-0">
        <Panel title="Conversations">
          <div className="flex flex-col gap-2 text-sm">
            <Button
              variant="secondary"
              onClick={() => {
                setThread(null);
              }}
            >
              New conversation
            </Button>
            {threads.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`text-left underline ${thread?.threadId === t.id ? "font-semibold" : ""}`}
                onClick={() => void openThread(t.id)}
              >
                {new Date(t.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                {t.status === "capped" ? " (continued)" : ""}
              </button>
            ))}
          </div>
        </Panel>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Panel title={thread === null ? "New conversation" : "Conversation"}>
          <div className="flex flex-col gap-3 text-sm" data-testid="chat-messages">
            {thread === null || thread.messages.length === 0 ? (
              <p className="text-neutral-700">Ask about this company's MIS: figures, movements, ratios and what the ledgers show.</p>
            ) : (
              thread.messages.map((m) => {
                if (m.role === "user")
                  return (
                    <div key={m.id} className="rounded-md bg-neutral-50 p-3" data-testid="chat-user">
                      <p>{m.text}</p>
                      <p className="mt-1 text-xs text-neutral-600">
                        {m.type} ·{" "}
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
                    <div key={m.id} className="rounded-md border border-neutral-200 p-3" data-testid="chat-edit">
                      <p>{reply.summary}</p>
                      {reply.scope === "in_scope" ? (
                        <>
                          <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-2 text-xs" data-testid="chat-edit-preview">
                            {JSON.stringify(reply.operations, null, 2)}
                          </pre>
                          <div className="mt-2 flex gap-2">
                            {done === undefined ? (
                              <Button onClick={() => void apply(m)}>Apply change</Button>
                            ) : done.undone ? (
                              <span className="text-neutral-700">Undone.</span>
                            ) : (
                              <>
                                <span className="text-neutral-700">Applied to the {done.target}.</span>
                                <Button variant="secondary" onClick={() => void undo(m)}>
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
                  reply?.output === undefined
                    ? null
                    : renderAnswer(reply.output.paragraphs, m.values, m.queries, thread.allowlist, {
                        ...format,
                        name: (token) => names[token] ?? null,
                      });
                return (
                  <div key={m.id} className="rounded-md border border-neutral-200 p-3" data-testid="chat-answer">
                    {rendered === null ? null : !rendered.ok ? (
                      <Alert tone="error">This answer did not pass the figure check, so it is not shown.</Alert>
                    ) : (
                      rendered.paragraphs.map((p, i) => (
                        <p key={i} className="mb-2 leading-6">
                          <Segments
                            segments={p}
                            onMetric={(key) => {
                              setLineage({ kind: "metric", key, values: m.values });
                            }}
                            onQuery={(ref) => {
                              const q = m.queries.find((x) => x.ref === ref);
                              if (q !== undefined) setLineage({ kind: "query", query: q });
                            }}
                          />
                        </p>
                      ))
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Panel>

        <Panel title="Ask">
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col">
                <span className="text-neutral-700">Message type</span>
                <select
                  className="h-9 rounded-md border border-neutral-300 px-2"
                  value={type === "investigate" ? "deep" : type}
                  onChange={(e) => {
                    setType(e.target.value as MessageType);
                  }}
                  data-testid="chat-type"
                >
                  {(Object.keys(TYPE_LABELS) as (keyof typeof TYPE_LABELS)[]).map((k) => (
                    <option key={k} value={k}>
                      {TYPE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col">
                <span className="text-neutral-700">Intelligence tier</span>
                <select
                  className="h-9 rounded-md border border-neutral-300 px-2"
                  value={tier}
                  onChange={(e) => {
                    setTier(e.target.value as Tier);
                  }}
                >
                  {(Object.keys(TIER_LABELS) as Tier[]).map((t) => (
                    <option key={t} value={t}>
                      {TIER_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              {type === "edit" ? (
                <label className="flex flex-col">
                  <span className="text-neutral-700">Change</span>
                  <select
                    className="h-9 rounded-md border border-neutral-300 px-2"
                    value={editTarget}
                    onChange={(e) => {
                      setEditTarget(e.target.value as "dashboard" | "template");
                    }}
                  >
                    <option value="dashboard">Dashboard</option>
                    <option value="template">MIS layout</option>
                  </select>
                </label>
              ) : null}
            </div>
            {type === "deep" || type === "investigate" ? (
              <div className="rounded-md bg-neutral-50 p-3">
                {session?.loaded === true ? (
                  <p data-testid="chat-session">Files loaded in this browser ({session.balances} ledger lines). Queries run here; only redacted results are sent.</p>
                ) : (
                  <label className="flex flex-col gap-1">
                    <span>Deep answers query this company's files, which must be loaded in this browser. They are not uploaded.</span>
                    <input
                      type="file"
                      multiple
                      accept=".xlsx,.xlsm,.xls,.csv"
                      aria-label="Load files for Deep answers"
                      onChange={(e) => void loadFiles(e.target.files)}
                    />
                  </label>
                )}
              </div>
            ) : null}
            <textarea
              className="min-h-20 rounded-md border border-neutral-300 p-2"
              aria-label="Your question"
              maxLength={2000}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
            <p className="text-xs text-neutral-600">
              Every message is charged at its type's price, including questions outside this MIS, which are declined in one sentence.
            </p>
            <div className="flex items-center gap-3">
              <Button onClick={() => void send()} disabled={busy !== null || deepDisabled || text.trim() === ""} data-testid="chat-send">
                {price === null ? "Send" : `Send — ${formatCredits(price)} credits`}
              </Button>
              {busy === null ? null : <span className="text-neutral-700" role="status">{busy}</span>}
            </div>
            {error === null ? null : <Alert tone="error">{error}</Alert>}
          </div>
        </Panel>
      </div>

      {lineage === null ? null : (
        <div className="w-80 shrink-0">
          {lineage.kind === "metric" ? (
            <LineagePanel
              selected={lineage.key}
              values={lineage.values}
              label={format.label}
              display={(v) => (v.value === null ? "—" : formatValue(v.value, v.unit, money))}
              onSelect={(key) => {
                setLineage({ ...lineage, key });
              }}
              onClose={() => {
                setLineage(null);
              }}
            />
          ) : (
            <aside className="rounded-lg border border-neutral-200 bg-white p-4 text-sm" data-testid="query-lineage">
              <div className="mb-3 flex items-start justify-between gap-2">
                <h2 className="font-semibold text-neutral-900">From query {lineage.query.ref}</h2>
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
              <pre className="my-2 overflow-x-auto rounded bg-neutral-50 p-2 text-xs">{lineage.query.sql}</pre>
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
        </div>
      )}
    </div>
  );
}
