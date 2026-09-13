/**
 * Message Batches for standard-delivery stages (SPEC §14, §23), run by the worker.
 *
 * Verified 2026-09-13 (https://platform.claude.com/docs/en/build-with-claude/batch-processing):
 * up to 100,000 requests or 256 MB per batch; `processing_status` `in_progress` | `canceling` |
 * `ended`; results per `custom_id` as `succeeded` | `errored` | `canceled` | `expired`; batches
 * expire after 24 hours; usage is billed at 50% of standard prices.
 *
 * The runtime cap applies before submission, per job, from counted input tokens. Batch has no
 * repair turn and no fallback: an item that fails validation or does not succeed is returned as
 * `retry_realtime`, and the caller runs that item through the realtime stage (which repairs once).
 */

import { microUsd } from "@magicmis/core/money";

import { costPaise, projectedCallCostMicroUsd } from "./cost";
import {
  AiStageError,
  prepareStage,
  recordCall,
  requestBase,
  responseText,
  RuntimeCapExceeded,
  validateOutput,
  type AiContext,
  type PreparedStage,
  type StageSpec,
} from "./orchestrator";
import { loadModel } from "./registry";
import type { BatchRequest } from "./transport";

const CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/u;

export interface BatchItem<I> {
  readonly customId: string;
  readonly ctx: AiContext;
  readonly input: I;
}

export interface SubmittedBatch {
  readonly batchId: string;
  readonly customIds: readonly string[];
}

async function prepared<I, O>(
  spec: StageSpec<I, O>,
  items: readonly BatchItem<I>[],
): Promise<PreparedStage<I>[]> {
  return Promise.all(
    items.map((it) => prepareStage(it.ctx.db, it.ctx.tier, spec, it.input)),
  );
}

export async function submitStageBatch<I, O>(
  spec: StageSpec<I, O>,
  items: readonly BatchItem<I>[],
): Promise<SubmittedBatch> {
  const first = items[0];
  if (first === undefined) throw new RangeError("submitStageBatch: no items");
  const ids = new Set<string>();
  for (const it of items) {
    if (!CUSTOM_ID.test(it.customId))
      throw new RangeError(`invalid custom_id ${it.customId}`);
    if (ids.has(it.customId)) throw new RangeError(`duplicate custom_id ${it.customId}`);
    ids.add(it.customId);
  }

  const preps = await prepared(spec, items);
  const requests: BatchRequest[] = [];
  const projectedByBudget = new Map<AiContext["budget"], bigint>();

  for (const [i, it] of items.entries()) {
    const prep = preps[i];
    if (prep === undefined) continue;
    const model = await loadModel(it.ctx.db, prep.route.model_id);
    if (!model.available) {
      throw new AiStageError(
        "no_model_available",
        `${prep.route.model_id} is unavailable`,
      );
    }
    const { effort: _effort, ...base } = requestBase(prep, model.model_id);
    const messages = [{ role: "user" as const, content: prep.userContent }];
    const counted = await it.ctx.transport.countTokens({
      model: base.model,
      system: base.system,
      messages,
      output_config: base.output_config,
    });
    // Priced at full rate for the cap: the discount is a saving, never an assumption.
    const add = projectedCallCostMicroUsd(counted, prep.route.max_tokens, model);
    const soFar =
      (projectedByBudget.get(it.ctx.budget) ?? it.ctx.budget.spentMicroUsd) + add;
    projectedByBudget.set(it.ctx.budget, soFar);
    const projectedPaise = costPaise(microUsd(soFar), prep.fx).paise;
    if (projectedPaise > it.ctx.budget.capPaise) {
      throw new RuntimeCapExceeded(
        spec.stage,
        projectedPaise,
        it.ctx.budget.capPaise,
        it.ctx.budget.spentMicroUsd,
      );
    }
    requests.push({ custom_id: it.customId, params: { ...base, messages } });
  }

  const status = await first.ctx.transport.createBatch(requests);
  return { batchId: status.id, customIds: [...ids] };
}

export type BatchItemResult<O> =
  | { readonly customId: string; readonly status: "ok"; readonly output: O }
  | {
      readonly customId: string;
      readonly status: "retry_realtime";
      readonly reason: string;
    };

/** Null while the batch is still processing. */
export async function collectStageBatch<I, O>(
  spec: StageSpec<I, O>,
  batchId: string,
  items: readonly BatchItem<I>[],
): Promise<BatchItemResult<O>[] | null> {
  const first = items[0];
  if (first === undefined) return [];
  const status = await first.ctx.transport.retrieveBatch(batchId);
  if (status.processingStatus !== "ended") return null;

  const results = new Map(
    (await first.ctx.transport.batchResults(batchId)).map((r) => [r.customId, r]),
  );
  const preps = await prepared(spec, items);
  const out: BatchItemResult<O>[] = [];

  for (const [i, it] of items.entries()) {
    const prep = preps[i];
    const r = results.get(it.customId);
    if (prep === undefined || r === undefined) {
      out.push({ customId: it.customId, status: "retry_realtime", reason: "missing" });
      continue;
    }
    if (r.type !== "succeeded") {
      out.push({ customId: it.customId, status: "retry_realtime", reason: r.type });
      continue;
    }
    const model = await loadModel(it.ctx.db, r.message.model);
    const call = {
      ctx: it.ctx,
      stage: spec.stage,
      promptVersion: prep.promptVersion,
      modelRequested: prep.route.model_id,
      model,
      fallbackFrom: null,
      effort: requestBase(prep, model.model_id).effort,
      maxTokens: prep.route.max_tokens,
      usage: r.message.usage,
      latencyMs: null,
      requestId: null,
      fx: prep.fx,
      batchId,
    };
    const stop = r.message.stop_reason;
    if (stop === "refusal" || stop === "max_tokens") {
      await recordCall({
        ...call,
        status: stop === "refusal" ? "error" : "invalid_output",
        errorType: stop,
      });
      out.push({ customId: it.customId, status: "retry_realtime", reason: stop });
      continue;
    }
    const v = validateOutput(spec, prep.input, responseText(r.message));
    await recordCall({
      ...call,
      status: v.ok ? "ok" : "invalid_output",
      errorType: v.ok ? null : "validation",
    });
    out.push(
      v.ok
        ? { customId: it.customId, status: "ok", output: v.output }
        : { customId: it.customId, status: "retry_realtime", reason: "validation" },
    );
  }
  return out;
}
