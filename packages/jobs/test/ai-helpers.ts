import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type {
  AiTransport,
  BatchRequest,
  BatchResult,
  CountParams,
  CreateParams,
  CreateResult,
} from "@magicmis/ai/transport";

// The SDK types via the transport module: only packages/ai imports the SDK itself.
type Message = CreateResult["message"];
type StopReason = NonNullable<Message["stop_reason"]>;
type Usage = Message["usage"];

export type Step =
  | { readonly kind: "message"; readonly message: Message }
  | { readonly kind: "error"; readonly error: Error };

export function message(
  text: string,
  over: {
    model?: string;
    stop_reason?: StopReason;
    usage?: Partial<Usage>;
  } = {},
): Message {
  return {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: over.model ?? "claude-haiku-4-5-20251001",
    content: [{ type: "text", text, citations: null }],
    stop_reason: over.stop_reason ?? "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1200,
      output_tokens: 300,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      ...over.usage,
    },
  } as unknown as Message;
}

/** A transport that replays scripted responses and records every request. */
export type { Message };

export class ScriptedTransport implements AiTransport {
  readonly created: CreateParams[] = [];
  readonly counted: CountParams[] = [];
  readonly batches: BatchRequest[][] = [];
  countResult = 2000;
  batchStatus: "in_progress" | "ended" = "ended";
  batchOutput: BatchResult[] = [];

  constructor(private readonly steps: Step[] = []) {}

  push(...steps: Step[]): void {
    this.steps.push(...steps);
  }

  create(params: CreateParams): Promise<CreateResult> {
    this.created.push(params);
    const step = this.steps.shift();
    if (step === undefined) return Promise.reject(new Error("no scripted response left"));
    if (step.kind === "error") return Promise.reject(step.error);
    return Promise.resolve({ message: step.message, requestId: `req_${randomUUID()}` });
  }

  countTokens(params: CountParams): Promise<number> {
    this.counted.push(params);
    return Promise.resolve(this.countResult);
  }

  createBatch(requests: readonly BatchRequest[]) {
    this.batches.push([...requests]);
    return Promise.resolve({
      id: "msgbatch_test",
      processingStatus: "in_progress" as const,
    });
  }

  retrieveBatch(id: string) {
    return Promise.resolve({ id, processingStatus: this.batchStatus });
  }

  batchResults() {
    return Promise.resolve(this.batchOutput);
  }
}

export async function newAccount(pool: Pool): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code)
     values (gen_random_uuid(), $1, 'AI Test Co', '27') returning id`,
    [`${randomUUID()}@example.test`],
  );
  const id = r.rows[0]?.id;
  if (id === undefined) throw new Error("account insert failed");
  await pool.query(`insert into wallets (account_id) values ($1)`, [id]);
  return id;
}

/** Test-only shortcut past the eval gate: tests exercise the orchestrator, not activation. */
export async function activateAllRoutes(pool: Pool): Promise<void> {
  await pool.query(`update tier_routing set prompt_version = 1`);
}
