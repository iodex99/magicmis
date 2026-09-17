import "server-only";

import { submitStepResult, type ChatProgress } from "@magicmis/chat/server";
import { readConfig } from "@magicmis/db/config";
import {
  chatTables,
  loadChatTables,
  prepare,
  priorFacts,
  runChatQuery,
  type Prepared,
} from "@magicmis/pipeline";
import { Redactor } from "@magicmis/redact";
import { head, isHeadCode } from "@magicmis/semantic";
import type { Pool } from "pg";
import { z } from "zod";

import { aiTransport } from "./ai";
import { jobSession } from "./companies";
import { openServerDuck } from "./duck";
import { loadJobFiles } from "./run-job";
import { keyWrapper } from "./runtime";

const MAX_ROUNDS = 20;

/**
 * Deep chat answered on the server (ADR 0032).
 *
 * The chat engine asks for queries one round at a time; before ADR 0032 they ran in the browser against
 * files loaded there. They now run here, against the company's own data: every ledger balance of
 * its latest snapshot (already mapped, party names already tokens) and, while its most recent
 * upload is still kept, its bills for ageing questions. Each query passes the same guard, row cap,
 * byte cap and redaction as before, then the result goes back into the loop. The customer never
 * has to load anything to ask.
 */
export async function answerDeepOnServer(
  pool: Pool,
  input: { accountId: string; companyId: string; messageId: string; first: ChatProgress },
): Promise<ChatProgress> {
  let progress = input.first;
  if (progress.status !== "needs_query") return progress;

  const session = await jobSession(pool, input.accountId, input.companyId);
  if (session === null) return { status: "failed", reason: "company not found" };
  const redactor = await Redactor.create(Buffer.from(session.redactionKey, "base64"));
  const [caps, timeoutMs] = await Promise.all([
    readConfig(
      pool,
      "ai.payload_caps",
      z
        .object({
          chat_rows_per_round: z.number().int().positive(),
          chat_bytes_per_round: z.number().int().positive(),
        })
        .loose(),
    ),
    readConfig(pool, "chat.query_timeout_ms", z.number().int().positive()),
  ]);

  const snapshot = priorFacts(session.memory.priorBalances, new Set());
  let bills: Prepared["bills"] = [];
  try {
    const uploads = await latestUploads(pool, input.accountId, input.companyId);
    if (uploads.length > 0) {
      const { files } = await loadJobFiles(pool, input.accountId, uploads);
      bills = (await prepare(files, redactor, session.company.dateOrder)).bills;
    }
  } catch {
    // The upload has been purged: balance questions still work, ageing ones say so.
  }

  const tables = chatTables(
    { facts: snapshot.facts, bills } as unknown as Prepared,
    snapshot.mappings,
    (code) => (isHeadCode(code) ? head(code).name : code),
  );
  const duck = await openServerDuck();
  try {
    await loadChatTables(duck, tables);
    for (
      let round = 0;
      progress.status === "needs_query" && round < MAX_ROUNDS;
      round += 1
    ) {
      const outcome = await runChatQuery(duck, progress.sql, {
        maxRows: caps.chat_rows_per_round,
        maxBytes: caps.chat_bytes_per_round,
        timeoutMs,
        redactText: (t) => redactor.redactText(t),
      });
      progress = await submitStepResult(pool, keyWrapper(), aiTransport(), {
        accountId: input.accountId,
        messageId: input.messageId,
        stepId: progress.stepId,
        result: outcome,
      });
    }
  } finally {
    duck.close();
  }
  return progress;
}

/**
 * Names for the party and person tokens in an answer, from the company's most recent upload
 * while it is still kept. Tokens are one-way: a name is known only if a kept file contains it.
 */
export async function displayNamesOnServer(
  pool: Pool,
  input: { accountId: string; companyId: string; tokens: readonly string[] },
): Promise<Record<string, string | null>> {
  const names: Record<string, string | null> = Object.fromEntries(
    input.tokens.map((t) => [t, null]),
  );
  const session = await jobSession(pool, input.accountId, input.companyId);
  if (session === null) return names;
  const redactor = await Redactor.create(Buffer.from(session.redactionKey, "base64"));
  try {
    const uploads = await latestUploads(pool, input.accountId, input.companyId);
    if (uploads.length === 0) return names;
    const { files } = await loadJobFiles(pool, input.accountId, uploads);
    // Preparing the files registers every party and person name with the redactor.
    await prepare(files, redactor, session.company.dateOrder);
  } catch {
    return names;
  }
  for (const token of input.tokens) names[token] = redactor.rehydrate(token).name;
  return names;
}

/** The uploads behind the company's most recent completed run. */
async function latestUploads(
  pool: Pool,
  accountId: string,
  companyId: string,
): Promise<string[]> {
  const r = await pool.query<{ uploads: string[] | null }>(
    `select array(select jsonb_array_elements_text(j.stage_checkpoints->'source_uploads')) as uploads
     from jobs j where j.company_id = $1 and j.account_id = $2 and j.state = 'completed'
       and j.stage_checkpoints ? 'source_uploads'
     order by j.completed_at desc nulls last limit 1`,
    [companyId, accountId],
  );
  return r.rows[0]?.uploads ?? [];
}
