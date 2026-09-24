/**
 * The single internal client (SPEC §14). Nothing outside `packages/ai` constructs requests;
 * this module is not re-exported from the package index.
 *
 * SDK usage verified against `@anthropic-ai/sdk` 0.125.0 type declarations: `messages.create(...)`
 * returns an APIPromise with `.withResponse()` → `{ data, request_id }`; `messages.countTokens`
 * returns `{ input_tokens }`; `messages.batches.create/retrieve/results`; typed errors
 * (`NotFoundError`, `PermissionDeniedError`, `RateLimitError`, `InternalServerError`, `APIError`).
 * The client retries 408/409/429/5xx and connection errors (`maxRetries: 2` → three attempts),
 * honouring `retry-after` (https://platform.claude.com/docs/en/api/errors).
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";

export type CreateParams = Anthropic.MessageCreateParamsNonStreaming;
export type CountParams = Anthropic.MessageCountTokensParams;

export interface CreateResult {
  readonly message: Anthropic.Message;
  readonly requestId: string | null;
}

export type BatchRequest = Anthropic.Messages.Batches.BatchCreateParams.Request;

export interface BatchStatus {
  readonly id: string;
  readonly processingStatus: "in_progress" | "canceling" | "ended";
}

export type BatchResult =
  | {
      readonly customId: string;
      readonly type: "succeeded";
      readonly message: Anthropic.Message;
    }
  | { readonly customId: string; readonly type: "errored" | "canceled" | "expired" };

export interface AiTransport {
  create(params: CreateParams): Promise<CreateResult>;
  countTokens(params: CountParams): Promise<number>;
  createBatch(requests: readonly BatchRequest[]): Promise<BatchStatus>;
  retrieveBatch(id: string): Promise<BatchStatus>;
  batchResults(id: string): Promise<BatchResult[]>;
}

/**
 * Above this ceiling the SDK demands streaming (verified 2026-09-24: 24,000 throws on Opus 5,
 * 16,000 does not). Sits below the observed boundary so a slower model does not creep past it.
 */
const STREAM_ABOVE_MAX_TOKENS = 16_000;

export function anthropicTransport(apiKey: string): AiTransport {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return {
    async create(params) {
      /*
       * The SDK refuses a non-streaming request whose `max_tokens` could keep it open past ten
       * minutes, and throws before anything is sent — which is how the Expert routes for
       * commentary and reference_layout (Opus 5 at 24,000) failed every call while the same
       * stages passed at 16,000. Streaming is the documented remedy, so take it whenever the
       * ceiling is high enough to be at risk, and keep the plain call for everything else.
       *
       * `finalMessage()` returns the same assembled Message the non-streaming call does, so the
       * usage accounting and the structured output above are unchanged. A streamed request
       * exposes no response headers, so there is no request id to record.
       */
      if (params.max_tokens > STREAM_ABOVE_MAX_TOKENS) {
        const stream = client.messages.stream(params);
        return { message: await stream.finalMessage(), requestId: null };
      }
      const { data, request_id } = await client.messages.create(params).withResponse();
      return { message: data, requestId: request_id ?? null };
    },
    async countTokens(params) {
      return (await client.messages.countTokens(params)).input_tokens;
    },
    async createBatch(requests) {
      const b = await client.messages.batches.create({ requests: [...requests] });
      return { id: b.id, processingStatus: b.processing_status };
    },
    async retrieveBatch(id) {
      const b = await client.messages.batches.retrieve(id);
      return { id: b.id, processingStatus: b.processing_status };
    },
    async batchResults(id) {
      const out: BatchResult[] = [];
      for await (const r of await client.messages.batches.results(id)) {
        out.push(
          r.result.type === "succeeded"
            ? { customId: r.custom_id, type: "succeeded", message: r.result.message }
            : { customId: r.custom_id, type: r.result.type },
        );
      }
      return out;
    },
  };
}

/** Errors that move to the next model in the fallback chain (SPEC §14). */
export function isFallbackError(error: unknown): boolean {
  if (
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.PermissionDeniedError
  )
    return true;
  // 529 overloaded and other 5xx reach here only after the SDK's own retries are exhausted.
  return (
    error instanceof Anthropic.APIError &&
    typeof error.status === "number" &&
    error.status >= 500
  );
}

export function errorType(error: unknown): string {
  if (error instanceof Anthropic.APIError)
    return `${error.constructor.name}:${String(error.status)}`;
  return error instanceof Error ? error.name : "unknown";
}
