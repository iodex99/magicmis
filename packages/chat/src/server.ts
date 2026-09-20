/**
 * Chat with the MIS, server side (SPEC §27).
 *
 * - A message is priced by its type and tier, and its credits are held before any AI call. Quick
 *   and Edit capture the fixed price on answer; Deep captures on answer. Out-of-scope declines are
 *   answered in one sentence and charged at the type's price. Platform failures release.
 * - Quick: deterministic retriever over the stored metric store + thread history → `chatQuick`.
 * - Edit: the current dashboard or template → `chatEditSpec` → a validated patch proposal; applying
 *   it is a separate confirmation with undo.
 * - Deep: `chatDeepStep` rounds. A `run_query` call is guarded here; a rejected query costs a round
 *   and goes back to the model; an accepted one is sent to the browser, which guards it again,
 *   runs it, redacts and caps the result and posts it back. The round cap is counted from stored
 *   steps, so the browser cannot extend it.
 * - Threads cap at `chat.thread_message_cap` messages; the next message starts a new thread seeded
 *   with a summary whose cost is recorded against that message.
 *
 * Message text, answers, SQL and query results are sealed under the company key.
 */

import { createHash } from "node:crypto";

import {
  chatAiContext,
  chatDeepStep,
  chatEditSpec,
  chatQuick,
  summariseThread,
  editOperations,
  AiStageError,
  RoutingError,
  RuntimeCapExceeded,
  type AiTransport,
  type ChatAnswerOutput,
  type StepOutcome,
} from "@magicmis/ai";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import type { KeyWrapper } from "@magicmis/crypto";
import { currencySymbol } from "@magicmis/core/reporting-conventions";
import {
  ANSWER_PLACEHOLDER,
  visibleValues,
  type MetricValue,
  type ReportingContext,
} from "@magicmis/engine";
import {
  latestBlueprint,
  latestSnapshot,
  openForCompany,
  sealForCompany,
} from "@magicmis/engine/server";
import {
  applyDashboardPatch,
  DashboardError,
  hiddenPeriods,
  readStoredDashboard,
  readStoredTemplate,
} from "@magicmis/jobs";
import { assertNoRawIdentifiers } from "@magicmis/redact";
import { METRIC_CATALOG } from "@magicmis/templates";
import {
  captureReservation,
  priceFor,
  releaseReservation,
  reserveCredits,
  type ActionKey,
} from "@magicmis/wallet";
import type { Pool } from "pg";
import { z } from "zod";

import { guardSql, loadGuard, SESSION_TABLES } from "@magicmis/sql-guard";
import { retrieveFacts } from "./retriever";

export type MessageType = "quick" | "deep" | "edit" | "investigate";
export type ChatTier = "efficient" | "professional" | "expert";

/**
 * The company’s own currency and grouping, for the figures handed to the model (ADR 0034).
 * A company row that could not be read falls back to the Indian conventions the price book
 * and the seed configuration assume.
 */
const reportingOf = (
  company:
    { currency: string; number_format: ReportingContext["numberFormat"] } | undefined,
): ReportingContext => ({
  currencySymbol: currencySymbol(company?.currency ?? "INR"),
  numberFormat: company?.number_format ?? "lakhs_crores",
});

const ACTION: Record<MessageType, ActionKey> = {
  quick: "chat_quick",
  deep: "chat_deep",
  investigate: "chat_deep",
  edit: "chat_edit",
};

export class ChatError extends Error {
  constructor(
    readonly code:
      | "company_not_found"
      | "company_inactive"
      | "insufficient_credits"
      | "not_found"
      | "invalid_state"
      | "question_too_long"
      | "result_invalid"
      | "no_data",
    message: string,
    readonly detail: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export type ChatProgress =
  | {
      readonly status: "completed";
      readonly state: "completed" | "declined_out_of_scope";
      readonly capturedCredits: bigint;
    }
  | {
      readonly status: "needs_query";
      readonly stepId: string;
      readonly stepRef: string;
      readonly sql: string;
    }
  | { readonly status: "failed"; readonly reason: string };

interface Scope {
  readonly accountId: string;
  readonly companyId: string;
}

const seal = async (
  pool: Pool,
  wrapper: KeyWrapper,
  scope: Scope,
  purpose: string,
  id: string,
  value: unknown,
) =>
  sealForCompany(pool, wrapper, {
    ...scope,
    purpose,
    id,
    plaintext: Buffer.from(JSON.stringify(value), "utf8"),
  });

const open = async <T>(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: Scope,
  purpose: string,
  id: string,
  sealed: Uint8Array | null,
): Promise<T | null> =>
  sealed === null
    ? null
    : (JSON.parse(
        (await openForCompany(pool, wrapper, { ...scope, purpose, id, sealed })).toString(
          "utf8",
        ),
      ) as T);

/**
 * Metric values across the company's stored months, newest snapshot first — **less the months
 * the customer has taken off the dashboard** (ADR 0047). The chat sits beside the board and every
 * box on it leads here; an answer that quoted a month, or a change on a month, the customer
 * unticked would contradict the board it is read against. The same rule as the dashboard.
 */
export async function companyMetricValues(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: Scope,
): Promise<MetricValue[]> {
  const periods = await pool.query<{ period: string }>(
    `select distinct period from public.snapshots where company_id = $1 and account_id = $2 order by period desc limit 24`,
    [scope.companyId, scope.accountId],
  );
  const seen = new Set<string>();
  const values: MetricValue[] = [];
  for (const { period } of periods.rows) {
    const snapshot = await latestSnapshot(pool, wrapper, { ...scope, period });
    for (const v of (snapshot?.metricStore.values ?? []) as unknown as MetricValue[]) {
      const key = `${v.metricId}@${v.period}|${JSON.stringify(v.dims)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(v);
    }
  }
  const [hidden, company] = await Promise.all([
    hiddenPeriods(pool, scope),
    pool.query<{ fy_start_month: number }>(
      `select fy_start_month from public.companies where id = $1 and account_id = $2`,
      [scope.companyId, scope.accountId],
    ),
  ]);
  return visibleValues(values, hidden, company.rows[0]?.fy_start_month ?? 4);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

async function openThread(
  pool: Pool,
  scope: Scope,
  threadId: string | null,
  cap: number,
): Promise<string> {
  return withTransaction(pool, async (tx) => {
    if (threadId !== null) {
      const t = await tx.query<{ id: string; status: string; message_count: number }>(
        `select id, status, message_count from public.chat_threads where id = $1 and account_id = $2 and company_id = $3 for update`,
        [threadId, scope.accountId, scope.companyId],
      );
      const thread = t.rows[0];
      if (thread === undefined)
        throw new ChatError("not_found", "Conversation not found.");
      if (thread.status === "open" && thread.message_count < cap) return thread.id;
      if (thread.status === "open")
        await tx.query(`update public.chat_threads set status = 'capped' where id = $1`, [
          thread.id,
        ]);
      const next = await tx.query<{ id: string }>(
        `insert into public.chat_threads (account_id, company_id, continues_thread_id) values ($1, $2, $3) returning id`,
        [scope.accountId, scope.companyId, thread.id],
      );
      return next.rows[0]?.id ?? "";
    }
    const created = await tx.query<{ id: string }>(
      `insert into public.chat_threads (account_id, company_id) values ($1, $2) returning id`,
      [scope.accountId, scope.companyId],
    );
    return created.rows[0]?.id ?? "";
  });
}

/**
 * Prices and holds a message. Nothing reaches the model until `processMessage`. The web layer
 * wraps this in Idempotency-Key handling.
 */
export async function sendMessage(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    threadId: string | null;
    type: MessageType;
    tier: ChatTier;
    text: string;
    editTarget?: "dashboard" | "template";
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ messageId: string; threadId: string; priceCredits: bigint }> {
  const now = input.now ?? new Date();
  const company = await pool.query<{
    lifecycle_state: string;
    first_setup_at: Date | null;
  }>(
    `select lifecycle_state, first_setup_at from public.companies where id = $1 and account_id = $2 and deleted_at is null`,
    [input.companyId, input.accountId],
  );
  const c = company.rows[0];
  if (c === undefined) throw new ChatError("company_not_found", "Company not found.");
  if (c.lifecycle_state !== "active")
    throw new ChatError(
      "company_inactive",
      "Chat is available once the company's memory fee is paid.",
    );
  if (c.first_setup_at === null)
    throw new ChatError("no_data", "Set up this company before chatting about its MIS.");
  const maxChars = await readConfig(
    pool,
    "chat.max_question_chars",
    z.number().int().positive(),
  );
  const text = input.text.trim();
  if (text.length === 0 || text.length > maxChars)
    throw new ChatError(
      "question_too_long",
      `Questions can be up to ${maxChars.toString()} characters.`,
    );

  const cap = await readConfig(
    pool,
    "chat.thread_message_cap",
    z.number().int().positive(),
  );
  const threadId = await openThread(pool, input, input.threadId, cap);
  const price = await priceFor(pool, {
    actionKey: ACTION[input.type],
    tier: input.tier,
    delivery: "instant",
    at: now,
  });
  const scope = { accountId: input.accountId, companyId: input.companyId };

  /*
   * One message per key, however many times the request is retried (ADR 0053, migration 0051).
   *
   * A fresh row on every call meant a retry inserted a second message and was then handed the
   * first message's hold back as a duplicate — so both ran the model and the thread showed two
   * answers for one charge, with two lots of vendor spend against a single price cap. `jobs`
   * has always been keyed this way, which is why the same retry was harmless there.
   */
  const inserted = await pool.query<{ id: string }>(
    `insert into public.chat_messages (thread_id, account_id, role, message_type, content, tier, price_credits, state, created_at, idempotency_key)
     values ($1, $2, 'user', $3, '\\x', $4, $5, 'pending', $6, $7)
     on conflict (account_id, idempotency_key) where idempotency_key is not null do nothing
     returning id`,
    [
      threadId,
      input.accountId,
      input.type,
      input.tier,
      price.credits.toString(),
      now,
      input.idempotencyKey,
    ],
  );
  const existing =
    inserted.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        `select id from public.chat_messages where account_id = $1 and idempotency_key = $2`,
        [input.accountId, input.idempotencyKey],
      )
    ).rows[0]?.id;
  const messageId = existing ?? "";
  const reservation = await reserveCredits(pool, {
    accountId: input.accountId,
    amount: price.credits,
    kind: "chat",
    subject: { chatMessageId: messageId },
    idempotencyKey: `chat:${input.idempotencyKey}`,
    now,
  });
  if (!reservation.ok) {
    await pool.query(`delete from public.chat_messages where id = $1`, [messageId]);
    throw new ChatError(
      "insufficient_credits",
      "Not enough credits for this message. Buy credits and try again.",
      {
        available: reservation.available.toString(),
        shortfall: reservation.shortfall.toString(),
      },
    );
  }
  const content = await seal(pool, wrapper, scope, "chat.message", messageId, {
    text,
    ...(input.editTarget === undefined ? {} : { target: input.editTarget }),
  });
  await pool.query(
    `update public.chat_messages set content = $2, reservation_id = $3 where id = $1`,
    [messageId, content, reservation.reservationId],
  );
  await pool.query(
    `update public.chat_threads set message_count = message_count + 1 where id = $1`,
    [threadId],
  );
  return { messageId, threadId, priceCredits: price.credits };
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

interface MessageRow {
  id: string;
  thread_id: string;
  account_id: string;
  company_id: string;
  message_type: MessageType;
  state: string;
  content: Buffer;
  reservation_id: string | null;
  price_credits: string;
  created_at: Date;
}

async function loadMessage(
  pool: Pool,
  accountId: string,
  messageId: string,
): Promise<MessageRow> {
  const r = await pool.query<MessageRow>(
    `select m.id, m.thread_id, m.account_id, t.company_id, m.message_type, m.state, m.content, m.reservation_id,
            m.price_credits::text as price_credits, m.created_at
     from public.chat_messages m join public.chat_threads t on t.id = m.thread_id
     where m.id = $1 and m.account_id = $2 and m.role = 'user'`,
    [messageId, accountId],
  );
  const row = r.rows[0];
  if (row === undefined) throw new ChatError("not_found", "Message not found.");
  return row;
}

interface Env {
  readonly pool: Pool;
  readonly wrapper: KeyWrapper;
  readonly transport: AiTransport;
  readonly now: Date;
}

interface StoredAnswer {
  readonly kind: "answer";
  readonly output: ChatAnswerOutput;
}
interface StoredEdit {
  readonly kind: "edit";
  readonly scope: "in_scope" | "out_of_scope";
  readonly summary: string;
  readonly target: "dashboard" | "template";
  readonly baseVersion: number;
  readonly operations: unknown[];
  /**
   * The blueprint version this change became when it was applied as it was proposed (ADR 0046),
   * or null when it is still only a proposal: a change to the MIS template, which waits for the
   * customer to confirm, or a dashboard change that lost a race and can be applied by hand.
   * Absent on replies stored before ADR 0046.
   */
  readonly appliedVersion?: number | null;
}
type StoredReply = StoredAnswer | StoredEdit;

/** Earlier turns of the thread, oldest first, for context. */
async function history(
  env: Env,
  msg: MessageRow,
): Promise<{ role: "user" | "assistant"; text: string }[]> {
  const scope = { accountId: msg.account_id, companyId: msg.company_id };
  const rows = await env.pool.query<{
    id: string;
    role: "user" | "assistant";
    content: Buffer;
    state: string;
  }>(
    `select id, role, content, state from public.chat_messages
     where thread_id = $1 and id <> $2 and created_at <= $3 and state not in ('pending', 'running', 'needs_query', 'failed_platform', 'failed_data')
     order by created_at, role desc`,
    [msg.thread_id, msg.id, msg.created_at],
  );
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const r of rows.rows.slice(-40)) {
    if (r.role === "user") {
      const c = await open<{ text: string }>(
        env.pool,
        env.wrapper,
        scope,
        "chat.message",
        r.id,
        r.content,
      );
      out.push({ role: "user", text: c?.text ?? "" });
    } else {
      const reply = await open<StoredReply>(
        env.pool,
        env.wrapper,
        scope,
        "chat.reply",
        r.id,
        r.content,
      );
      out.push({
        role: "assistant",
        text:
          reply === null
            ? ""
            : reply.kind === "answer"
              ? reply.output.paragraphs.map((p) => p.text).join("\n")
              : `Proposed change: ${reply.summary}`,
      });
    }
  }
  return out;
}

/** The thread's seeded summary, generated at its first message and charged within that message. */
async function threadSummary(env: Env, msg: MessageRow): Promise<string | null> {
  const scope = { accountId: msg.account_id, companyId: msg.company_id };
  const t = await env.pool.query<{
    seeded_summary: Buffer | null;
    continues_thread_id: string | null;
  }>(
    `select seeded_summary, continues_thread_id from public.chat_threads where id = $1`,
    [msg.thread_id],
  );
  const thread = t.rows[0];
  if (thread === undefined || thread.continues_thread_id === null) return null;
  const existing = await open<{ summary: string }>(
    env.pool,
    env.wrapper,
    scope,
    "chat.summary",
    msg.thread_id,
    thread.seeded_summary,
  );
  if (existing !== null) return existing.summary;

  const previous = await env.pool.query<{ id: string; created_at: Date }>(
    `select id, created_at from public.chat_messages where thread_id = $1 and role = 'user' order by created_at desc limit 1`,
    [thread.continues_thread_id],
  );
  const last = previous.rows[0];
  if (last === undefined) return null;
  const prevMsg = await loadMessage(env.pool, msg.account_id, last.id);
  const turns = [
    ...(await history(env, {
      ...prevMsg,
      id: "00000000-0000-0000-0000-000000000000",
      created_at: new Date(8.64e15),
    })),
  ];
  if (turns.length === 0) return null;
  const ctx = await chatAiContext(env.pool, env.transport, msg.id);
  const prevSummary = await threadSummary(env, prevMsg);
  const r = await summariseThread(ctx, {
    previousSummary: prevSummary,
    history: turns.slice(-60),
  });
  const sealed = await seal(env.pool, env.wrapper, scope, "chat.summary", msg.thread_id, {
    summary: r.output.summary,
  });
  await env.pool.query(
    `update public.chat_threads set seeded_summary = $2 where id = $1`,
    [msg.thread_id, sealed],
  );
  return r.output.summary;
}

/** Metric store IDs referred to by placeholders, with their values, for rendering and lineage. */
function referencedValues(
  texts: readonly string[],
  store: readonly MetricValue[],
): MetricValue[] {
  const keys = new Set<string>();
  for (const m of texts.join("\n").matchAll(ANSWER_PLACEHOLDER)) {
    const kind = m[1] ?? "";
    const body = m[2] ?? "";
    if (kind === "m") keys.add(body);
    if (kind === "mv") {
      const [idPeriod = "", form = "abs"] = body.split(":");
      const [id = "", period = ""] = idPeriod.split("@");
      keys.add(`${id}_${form}@${period}`);
    }
  }
  return store.filter(
    (v) => Object.keys(v.dims).length === 0 && keys.has(`${v.metricId}@${v.period}`),
  );
}

async function finish(
  env: Env,
  msg: MessageRow,
  reply: StoredReply,
  resolved: { values: MetricValue[]; queries: unknown[] },
  roundsUsed: number,
): Promise<ChatProgress> {
  const scope = { accountId: msg.account_id, companyId: msg.company_id };
  const outOfScope =
    reply.kind === "answer"
      ? reply.output.scope === "out_of_scope"
      : reply.scope === "out_of_scope";
  const inserted = await env.pool.query<{ id: string }>(
    `insert into public.chat_messages (thread_id, account_id, role, content, reply_to, state, created_at)
     values ($1, $2, 'assistant', '\\x', $3, 'completed', $4) returning id`,
    [msg.thread_id, msg.account_id, msg.id, env.now],
  );
  const replyId = inserted.rows[0]?.id ?? "";
  await env.pool.query(
    `update public.chat_messages set content = $2, rendered_answer_template = $3, resolved_values = $4 where id = $1`,
    [
      replyId,
      await seal(env.pool, env.wrapper, scope, "chat.reply", replyId, reply),
      await seal(
        env.pool,
        env.wrapper,
        scope,
        "chat.template",
        replyId,
        reply.kind === "answer" ? reply.output : null,
      ),
      await seal(env.pool, env.wrapper, scope, "chat.values", replyId, resolved),
    ],
  );
  // The price is charged for an answer or a decline alike (SPEC §27).
  const captured =
    msg.reservation_id === null
      ? 0n
      : (
          await captureReservation(env.pool, {
            reservationId: msg.reservation_id,
            amount: BigInt(msg.price_credits),
            idempotencyKey: `chat:${msg.id}:capture`,
            now: env.now,
          })
        ).captured;
  const state = outOfScope ? "declined_out_of_scope" : "completed";
  await env.pool.query(
    `update public.chat_messages set state = $2, credits_charged = $3, rounds_used = $4 where id = $1`,
    [msg.id, state, captured.toString(), roundsUsed],
  );
  return { status: "completed", state, capturedCredits: captured };
}

async function fail(env: Env, msg: MessageRow, reason: string): Promise<ChatProgress> {
  if (msg.reservation_id !== null)
    await releaseReservation(env.pool, {
      reservationId: msg.reservation_id,
      idempotencyKey: `chat:${msg.id}:release`,
      now: env.now,
    });
  await env.pool.query(
    `update public.chat_messages set state = 'failed_platform', failure_reason = $2 where id = $1`,
    [msg.id, reason],
  );
  return { status: "failed", reason };
}

/** Rewrites a stored edit reply to say which version it became once it was applied. */
async function recordApplied(
  env: Env,
  msg: MessageRow,
  reply: StoredEdit,
): Promise<void> {
  const scope = { accountId: msg.account_id, companyId: msg.company_id };
  const row = await env.pool.query<{ id: string }>(
    `select id from public.chat_messages where reply_to = $1 and role = 'assistant' order by created_at desc limit 1`,
    [msg.id],
  );
  const replyId = row.rows[0]?.id;
  if (replyId === undefined) return;
  await env.pool.query(`update public.chat_messages set content = $2 where id = $1`, [
    replyId,
    await seal(env.pool, env.wrapper, scope, "chat.reply", replyId, reply),
  ]);
}

const isAiFailure = (e: unknown) =>
  e instanceof AiStageError ||
  e instanceof RoutingError ||
  e instanceof RuntimeCapExceeded;

async function allowlist(pool: Pool): Promise<string[]> {
  return readConfig(pool, "commentary.digit_allowlist", z.array(z.string()));
}

/** Runs a held message to its answer, or to the first query the browser must run. */
export async function processMessage(
  pool: Pool,
  wrapper: KeyWrapper,
  transport: AiTransport,
  input: { accountId: string; messageId: string; now?: Date },
): Promise<ChatProgress> {
  const env: Env = { pool, wrapper, transport, now: input.now ?? new Date() };
  const msg = await loadMessage(pool, input.accountId, input.messageId);
  if (msg.state === "completed" || msg.state === "declined_out_of_scope")
    return {
      status: "completed",
      state: msg.state,
      capturedCredits: BigInt(msg.price_credits),
    };
  if (msg.state === "failed_platform")
    return { status: "failed", reason: "This message could not be answered." };
  const scope = { accountId: msg.account_id, companyId: msg.company_id };
  const content = await open<{ text: string; target?: "dashboard" | "template" }>(
    pool,
    wrapper,
    scope,
    "chat.message",
    msg.id,
    msg.content,
  );
  if (content === null)
    throw new ChatError("invalid_state", "The message has no content.");
  if (msg.state === "pending")
    await pool.query(`update public.chat_messages set state = 'running' where id = $1`, [
      msg.id,
    ]);

  try {
    if (msg.message_type === "deep" || msg.message_type === "investigate")
      return await deepLoop(env, msg, content.text);
    const [summary, turns] = await Promise.all([
      threadSummary(env, msg),
      history(env, msg),
    ]);
    const ctx = await chatAiContext(pool, transport, msg.id);

    if (msg.message_type === "edit") {
      const target = content.target ?? "dashboard";
      const blueprint = await latestBlueprint(pool, wrapper, scope);
      if (blueprint === null) return await fail(env, msg, "no_blueprint");
      // The layout the edit is proposed against comes from the same version the proposal is
      // tied to, and is read strictly (ADR 0045): one that is saved but does not parse ends the
      // message uncharged instead of being described to the model as something it is not.
      let spec: unknown;
      try {
        spec =
          target === "dashboard"
            ? (readStoredDashboard(blueprint.parts.dashboardSpec)?.spec ?? null)
            : readStoredTemplate(blueprint.parts.templateSpec);
      } catch (error) {
        if (error instanceof DashboardError && error.code === "unreadable")
          return await fail(env, msg, "layout_unreadable");
        throw error;
      }
      if (spec === null)
        return await fail(
          env,
          msg,
          target === "dashboard" ? "no_dashboard" : "no_blueprint",
        );
      const r = await chatEditSpec(ctx, {
        target,
        spec: spec as never,
        metrics: METRIC_CATALOG.map((m) => ({ id: m.id, label: m.label, unit: m.unit })),
        summary,
        history: turns,
        request: content.text,
      });
      const { ops } = editOperations(r.output);
      // The customer chats and the dashboard follows (ADR 0046): a dashboard change that passed
      // every check is applied as it is answered, and the reply offers Undo. It is a layout over
      // figures the engine computes, and one step from being undone, so nothing is gained by
      // asking first. A change to the MIS template alters the next workbook and still waits for
      // a confirmation.
      //
      // The order is charge, then apply, then record. Applying first would hand the change over
      // for nothing if the capture then failed: the message would be swept as a platform fault
      // and its hold released. This way round, the worst a failure leaves is a change that was
      // paid for and is still a proposal, which the customer applies by hand at no charge.
      const reply: StoredEdit = {
        kind: "edit",
        scope: r.output.scope,
        summary: r.output.summary,
        target,
        baseVersion: blueprint.version,
        operations: ops,
        appliedVersion: null,
      };
      const progress = await finish(env, msg, reply, { values: [], queries: [] }, 0);
      if (target === "dashboard" && r.output.scope === "in_scope") {
        try {
          const applied = await applyDashboardPatch(pool, wrapper, {
            ...scope,
            baseVersion: blueprint.version,
            operations: ops,
          });
          await recordApplied(env, msg, {
            ...reply,
            appliedVersion: applied.blueprintVersion,
          });
        } catch {
          /*
           * The customer has already been charged and answered, so nothing that happens here
           * may take the reply away from them (ADR 0053).
           *
           * Losing a race with another edit was already tolerated. Anything else was rethrown,
           * which escaped as a 500: the charge stood, the change might already be on the board,
           * and the screen showed neither the reply nor the new dashboard until a manual
           * reload. The comment above promises the opposite, so every failure now lands where
           * it says — paid for, still a proposal, undoable and re-appliable by hand.
           */
        }
      }
      return progress;
    }

    const store = await companyMetricValues(pool, wrapper, scope);
    const maxFacts = await readConfig(
      pool,
      "chat.quick_max_facts",
      z.number().int().positive(),
    );
    const company = await pool.query<{
      name: string;
      currency: string;
      number_format: "lakhs_crores" | "absolute" | "millions";
    }>(`select name, currency, number_format from public.companies where id = $1`, [
      msg.company_id,
    ]);
    const retrieved = retrieveFacts(content.text, store, {
      maxFacts,
      conventions: reportingOf(company.rows[0]),
    });
    const r = await chatQuick(ctx, {
      companyName: company.rows[0]?.name ?? "",
      facts: [...retrieved.facts],
      periods: retrieved.periods.map((p) => `p:${p}`),
      summary,
      history: turns,
      question: content.text,
      allowlist: await allowlist(pool),
    });
    return await finish(
      env,
      msg,
      { kind: "answer", output: r.output },
      {
        values: referencedValues(
          r.output.paragraphs.map((p) => p.text),
          store,
        ),
        queries: [],
      },
      0,
    );
  } catch (error) {
    if (isAiFailure(error))
      return fail(env, msg, error instanceof Error ? error.name : "ai_failure");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Deep
// ---------------------------------------------------------------------------

interface StepRow {
  id: string;
  round: number;
  step_ref: string;
  tool_use_id: string;
  sql_text: Buffer;
  purpose: Buffer | null;
  result: Buffer | null;
  status: "pending" | "ok" | "rejected" | "error";
  guard_result: { ok: boolean; reason?: string; tables?: string[] };
}

interface OpenedStep {
  readonly id: string;
  readonly ref: string;
  readonly toolUseId: string;
  readonly sql: string;
  readonly purpose: string;
  readonly status: StepRow["status"];
  readonly tables: readonly string[];
  readonly outcome: StepOutcome | null;
}

async function loadSteps(env: Env, msg: MessageRow): Promise<OpenedStep[]> {
  const scope = { accountId: msg.account_id, companyId: msg.company_id };
  const rows = await env.pool.query<StepRow>(
    `select id, round, step_ref, tool_use_id, sql_text, purpose, result, status, guard_result
     from public.chat_query_steps where chat_message_id = $1 order by round`,
    [msg.id],
  );
  const out: OpenedStep[] = [];
  for (const r of rows.rows) {
    out.push({
      id: r.id,
      ref: r.step_ref,
      toolUseId: r.tool_use_id,
      sql:
        (
          await open<{ sql: string }>(
            env.pool,
            env.wrapper,
            scope,
            "chat.sql",
            r.id,
            r.sql_text,
          )
        )?.sql ?? "",
      purpose:
        (
          await open<{ purpose: string }>(
            env.pool,
            env.wrapper,
            scope,
            "chat.purpose",
            r.id,
            r.purpose,
          )
        )?.purpose ?? "",
      status: r.status,
      tables: r.guard_result.tables ?? [],
      outcome: await open<StepOutcome>(
        env.pool,
        env.wrapper,
        scope,
        "chat.result",
        r.id,
        r.result,
      ),
    });
  }
  return out;
}

async function deepLoop(
  env: Env,
  msg: MessageRow,
  question: string,
): Promise<ChatProgress> {
  const scope = { accountId: msg.account_id, companyId: msg.company_id };
  const maxRounds = await readConfig(
    env.pool,
    "chat.max_rounds",
    z.number().int().positive(),
  );
  const caps = await readConfig(
    env.pool,
    "ai.payload_caps",
    z.object({ chat_rows_per_round: z.number().int().positive() }),
  );
  await loadGuard();
  const [summary, turns, store, company] = await Promise.all([
    threadSummary(env, msg),
    history(env, msg),
    companyMetricValues(env.pool, env.wrapper, scope),
    env.pool.query<{
      name: string;
      currency: string;
      number_format: "lakhs_crores" | "absolute" | "millions";
    }>(`select name, currency, number_format from public.companies where id = $1`, [
      msg.company_id,
    ]),
  ]);
  const retrieved = retrieveFacts(question, store, {
    maxFacts: 40,
    conventions: reportingOf(company.rows[0]),
  });

  for (let guardLoops = 0; guardLoops <= maxRounds; guardLoops += 1) {
    const steps = await loadSteps(env, msg);
    const pending = steps.find((s) => s.status === "pending");
    if (pending !== undefined) {
      await env.pool.query(
        `update public.chat_messages set state = 'needs_query' where id = $1`,
        [msg.id],
      );
      return {
        status: "needs_query",
        stepId: pending.id,
        stepRef: pending.ref,
        sql: pending.sql,
      };
    }
    const ctx = await chatAiContext(env.pool, env.transport, msg.id);
    const step = await chatDeepStep(ctx, {
      companyName: company.rows[0]?.name ?? "",
      tables: SESSION_TABLES,
      facts: [...retrieved.facts],
      periods: retrieved.periods.map((p) => `p:${p}`),
      summary,
      history: turns,
      question,
      steps: steps.map((s) => ({
        ref: s.ref,
        toolUseId: s.toolUseId,
        sql: s.sql,
        purpose: s.purpose,
        outcome: s.outcome ?? { status: "error" as const, reason: "no result" },
      })),
      maxRounds,
      allowlist: await allowlist(env.pool),
    });

    if (step.kind === "answer") {
      const okSteps = steps.filter((s) => s.outcome?.status === "ok");
      return finish(
        env,
        msg,
        { kind: "answer", output: step.output },
        {
          values: referencedValues(
            step.output.paragraphs.map((p) => p.text),
            store,
          ),
          // Query cells become lineage: the SQL, its purpose and the session tables it read.
          queries: okSteps.map((s) => ({
            ref: s.ref,
            sql: s.sql,
            purpose: s.purpose,
            tables: s.tables,
            result: s.outcome,
          })),
        },
        steps.length,
      );
    }

    const round = steps.length + 1;
    const guard = guardSql(step.sql, { maxRows: caps.chat_rows_per_round });
    const inserted = await env.pool.query<{ id: string }>(
      `insert into public.chat_query_steps (chat_message_id, account_id, round, sql_text, guard_result, step_ref, tool_use_id, status)
       values ($1, $2, $3, '\\x', $4, $5, $6, $7) returning id`,
      [
        msg.id,
        msg.account_id,
        round,
        JSON.stringify(
          guard.ok
            ? { ok: true, tables: guard.tables }
            : { ok: false, reason: guard.reason },
        ),
        `q${round.toString()}`,
        step.toolUseId,
        guard.ok ? "pending" : "rejected",
      ],
    );
    const stepId = inserted.rows[0]?.id ?? "";
    await env.pool.query(
      `update public.chat_query_steps set sql_text = $2, purpose = $3, result = $4 where id = $1`,
      [
        stepId,
        await seal(env.pool, env.wrapper, scope, "chat.sql", stepId, { sql: step.sql }),
        await seal(env.pool, env.wrapper, scope, "chat.purpose", stepId, {
          purpose: step.purpose,
        }),
        guard.ok
          ? null
          : await seal(env.pool, env.wrapper, scope, "chat.result", stepId, {
              status: "rejected",
              reason: guard.reason,
            }),
      ],
    );
    await env.pool.query(
      `update public.chat_messages set rounds_used = $2 where id = $1`,
      [msg.id, round],
    );
    // A rejected query goes back to the model as a failed round; an accepted one goes to the browser.
  }
  return fail(env, msg, "round_loop");
}

const resultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    columns: z.array(z.string().min(1).max(80)).min(1).max(40),
    rows: z.array(z.array(z.string().max(400)).max(40)),
    truncated: z.boolean(),
  }),
  z.object({ status: z.literal("error"), reason: z.string().max(500) }),
]);

/** The browser's result for a pending query; then the loop continues. */
export async function submitStepResult(
  pool: Pool,
  wrapper: KeyWrapper,
  transport: AiTransport,
  input: {
    accountId: string;
    messageId: string;
    stepId: string;
    result: unknown;
    now?: Date;
  },
): Promise<ChatProgress> {
  const env: Env = { pool, wrapper, transport, now: input.now ?? new Date() };
  const msg = await loadMessage(pool, input.accountId, input.messageId);
  if (msg.state !== "needs_query")
    throw new ChatError(
      "invalid_state",
      "This message is not waiting for a query result.",
    );
  const step = await pool.query<{ id: string; status: string }>(
    `select id, status from public.chat_query_steps where id = $1 and chat_message_id = $2`,
    [input.stepId, msg.id],
  );
  if (step.rows[0]?.status !== "pending")
    throw new ChatError("invalid_state", "This query is not waiting for a result.");

  const caps = await readConfig(
    pool,
    "ai.payload_caps",
    z.object({
      chat_rows_per_round: z.number().int().positive(),
      chat_bytes_per_round: z.number().int().positive(),
    }),
  );
  const parsed = resultSchema.safeParse(input.result);
  if (!parsed.success)
    throw new ChatError(
      "result_invalid",
      "The query result is not in the expected shape.",
    );
  const json = JSON.stringify(parsed.data);
  if (parsed.data.status === "ok") {
    const ok = parsed.data;
    if (
      ok.rows.length > caps.chat_rows_per_round ||
      ok.rows.some((r) => r.length !== ok.columns.length)
    )
      throw new ChatError(
        "result_invalid",
        "The query result has too many rows or ragged rows.",
      );
    if (new TextEncoder().encode(json).length > caps.chat_bytes_per_round)
      throw new ChatError(
        "result_invalid",
        "The query result is larger than a round allows.",
      );
    try {
      assertNoRawIdentifiers(json);
    } catch {
      throw new ChatError(
        "result_invalid",
        "The query result still contains identifiers that must be redacted.",
      );
    }
  }
  const scope = { accountId: msg.account_id, companyId: msg.company_id };
  await pool.query(
    `update public.chat_query_steps set result = $2, status = $3, row_count = $4, result_digest = $5 where id = $1 and status = 'pending'`,
    [
      input.stepId,
      await seal(pool, wrapper, scope, "chat.result", input.stepId, parsed.data),
      parsed.data.status === "ok" ? "ok" : "error",
      parsed.data.status === "ok" ? parsed.data.rows.length : null,
      createHash("sha256").update(json).digest("hex"),
    ],
  );
  await pool.query(`update public.chat_messages set state = 'running' where id = $1`, [
    msg.id,
  ]);
  try {
    const content = await open<{ text: string }>(
      pool,
      wrapper,
      scope,
      "chat.message",
      msg.id,
      msg.content,
    );
    return await deepLoop(env, { ...msg, state: "running" }, content?.text ?? "");
  } catch (error) {
    if (isAiFailure(error))
      return fail(env, msg, error instanceof Error ? error.name : "ai_failure");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ChatMessageView {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly type: MessageType | null;
  readonly state: string;
  readonly createdAt: string;
  readonly creditsCharged: string;
  readonly text: string | null;
  readonly reply: StoredReply | null;
  readonly values: readonly MetricValue[];
  readonly queries: readonly unknown[];
}

export async function threadView(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; threadId: string },
): Promise<{
  threadId: string;
  companyId: string;
  status: string;
  messages: ChatMessageView[];
} | null> {
  const t = await pool.query<{ company_id: string; status: string }>(
    `select company_id, status from public.chat_threads where id = $1 and account_id = $2`,
    [input.threadId, input.accountId],
  );
  const thread = t.rows[0];
  if (thread === undefined) return null;
  const scope = { accountId: input.accountId, companyId: thread.company_id };
  const rows = await pool.query<{
    id: string;
    role: "user" | "assistant";
    message_type: MessageType | null;
    state: string;
    created_at: Date;
    credits_charged: string;
    content: Buffer;
    resolved_values: Buffer | null;
  }>(
    `select id, role, message_type, state, created_at, credits_charged::text as credits_charged, content, resolved_values
     from public.chat_messages where thread_id = $1 order by created_at, role desc`,
    [input.threadId],
  );
  const messages: ChatMessageView[] = [];
  for (const r of rows.rows) {
    const isUser = r.role === "user";
    const text = isUser
      ? ((
          await open<{ text: string }>(
            pool,
            wrapper,
            scope,
            "chat.message",
            r.id,
            r.content,
          )
        )?.text ?? null)
      : null;
    const reply = isUser
      ? null
      : await open<StoredReply>(pool, wrapper, scope, "chat.reply", r.id, r.content);
    const resolved = isUser
      ? null
      : await open<{ values: MetricValue[]; queries: unknown[] }>(
          pool,
          wrapper,
          scope,
          "chat.values",
          r.id,
          r.resolved_values,
        );
    messages.push({
      id: r.id,
      role: r.role,
      type: r.message_type,
      state: r.state,
      createdAt: r.created_at.toISOString(),
      creditsCharged: r.credits_charged,
      text,
      reply,
      values: resolved?.values ?? [],
      queries: resolved?.queries ?? [],
    });
  }
  return {
    threadId: input.threadId,
    companyId: thread.company_id,
    status: thread.status,
    messages,
  };
}

/**
 * Messages left waiting (a Deep question whose browser went away, or a crashed request) are closed
 * when their hold would expire: the hold is released and the message marked failed. No answer was
 * delivered, so nothing is charged; the AI cost already spent is absorbed. TODO(review): R-43.
 */
export async function sweepChatMessages(
  pool: Pool,
  now: Date = new Date(),
): Promise<number> {
  const ttl = await readConfig(
    pool,
    "wallet.reservation_ttl_seconds",
    z.object({ chat: z.number().int().positive() }),
  );
  const stale = await pool.query<{ id: string; reservation_id: string | null }>(
    `select id, reservation_id from public.chat_messages
     where role = 'user' and state in ('pending', 'running', 'needs_query') and created_at < $1`,
    [new Date(now.getTime() - ttl.chat * 1000)],
  );
  for (const m of stale.rows) {
    if (m.reservation_id !== null)
      await releaseReservation(pool, {
        reservationId: m.reservation_id,
        idempotencyKey: `chat:${m.id}:release`,
        now,
      });
    await pool.query(
      `update public.chat_messages set state = 'failed_platform', failure_reason = 'abandoned' where id = $1 and state in ('pending', 'running', 'needs_query')`,
      [m.id],
    );
  }
  return stale.rows.length;
}
