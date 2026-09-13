# Phase 4 — AI layer and margin controls

Scope from SPEC §34:

> - Model registry and tier routing (verified against docs); orchestrator with structured outputs,
>   repair, retries, fallback, caching, token counting, runtime cap.
> - `ai_calls` cost accounting; estimator and calibration; batch client in worker.
> - Prompts v1 for classification and mapping; eval harness.
> - *Acceptance:* recorded cost per call matches computed cost from usage; runtime cap test pauses
>   a job; no generic passthrough exists (test); evals run and report.

## Design

**`packages/ai`** — server and worker only (an import guard test fails if `apps/web` client code or
`packages/ingest|redact|tally` import it).

- **Exports only purpose-named functions**: `classifySheets`, `mapColumns`, `mapLedgers` in this
  phase (commentary, chat and reference layout arrive with their phases). The orchestrator and the
  transport are internal; a test asserts the public surface contains no generic prompt function and
  that no exported function accepts a prompt, model, effort or `max_tokens`.
- **Transport interface** over `@anthropic-ai/sdk` 0.125.0: `create`, `countTokens`, batch
  `create/retrieve/results`. Tests use a scripted transport; evals can replay recorded responses
  or run live behind `AI_LIVE=1`.
- **Registry and routing** from `model_registry` / `tier_routing` (latest version per key). Model,
  effort and `max_tokens` come only from routing; effort is omitted for models that do not support
  it (Haiku 4.5).
- **Prompts** from versioned files `packages/ai/prompts/<name>/v<N>.md`. Every system prompt carries
  the SPEC §14 prompt rules. Content order, most to least stable: system instructions → knowledge
  pack → template spec → account mapping rules → blueprint → volatile payload in `<data>` tags; cache
  breakpoints after the stable blocks.
- **Structured outputs** via `output_config.format` (`json_schema`) generated from the Zod schema and
  reduced to the supported subset (no min/max/length/pattern; `additionalProperties: false`); the full
  Zod schema then validates. One repair attempt with the validation errors; a second failure is a
  `platform_fault`. `stop_reason: refusal` and `max_tokens` truncation are recorded and fail the stage.
- **Runtime cap** before every call: `projected = cost_so_far + counted_input_cost + max_tokens ×
  output_price` (token count from `countTokens`). Over cap → `RuntimeCapExceeded`; the job helper
  moves the job to `needs_quote`, releases its reservation, records `estimation_miss`.
- **Retries** by the SDK (`maxRetries: 2` → 3 attempts, honours `retry-after`, retries 408/409/429/5xx).
  **Fallback** down `fallback_chain` on 404/403 or 529/5xx after retries; `fallback_from` recorded;
  the delivered tier is reported so pricing can capture the lower tier's price.
- **Cost accounting**: every API call (including repairs and failures with usage) writes `ai_calls`
  with tokens, cache tokens, request id, latency, status; `usd_cost_micro` computed exactly in bigint
  (rounded up to the micro-USD), INR paise at the admin FX rate plus buffer.
- **Estimator**: per-stage token heuristics from size descriptors (chars per token and inflation from
  config), `estimator_calibration` p90 per size bucket when present; decides exact price vs quote.
  **Calibration** worker job recomputes p50/p90 nightly from `ai_calls`.
- **Batch client** in the worker: submit, poll, stream results by `custom_id`, record costs at the
  batch discount.
- **Concurrency**: in-process global semaphore sized from config.
- **Evals** (`packages/ai/evals`): labelled datasets built from the synthetic fixtures (sheet
  classification from report types; column mapping from generated headers); per tier report accuracy,
  cost per item and latency; results stored; a prompt version can be activated in `tier_routing` only
  when its recorded results meet configured thresholds.

**`apps/admin`** — margin screen v1: AI cost ratio per action from `ai_calls` + captured credits,
flags over `max_ai_cost_ratio`, cache hit rate per stage, fallback rate; model registry view with
`verified_at` staleness warning.

## External facts verified (2026-09-13)

| Fact | Source |
|---|---|
| Model IDs: `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-5`, `claude-fable-5-1`; prices per MTok input/output $1/$5, $2/$10, $5/$25, $10/$50; Haiku 4.5 context 200K / output 64K, others 1M / 128K; thinking adaptive on Sonnet 5/Opus 5/Fable 5.1, extended on Haiku 4.5; default effort `high`, not supported on Haiku 4.5 | https://platform.claude.com/docs/en/about-claude/models/overview |
| Cache writes 1.25× (5 min) and 2× (1 h); cache reads 0.1×, 0.025× on Fable 5.1; batch 50% off input and output; no long-context surcharge on 4.6+; `inference_geo: "us"` 1.1× | https://platform.claude.com/docs/en/about-claude/pricing |
| Usage fields `input_tokens` (after last breakpoint), `cache_creation_input_tokens`, `cache_read_input_tokens`, optional `cache_creation.ephemeral_5m_input_tokens`/`ephemeral_1h_input_tokens`; total input = sum; up to 4 breakpoints; minimum cacheable 4,096 (Haiku 4.5), 1,024 (Sonnet 5), 512 (Opus 5, Fable 5.1) | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| `output_config.effort`: `low`/`medium`/`high`/`xhigh`/`max`; supported on Sonnet 5, Opus 5, Fable 5.1 (not Haiku 4.5) | https://platform.claude.com/docs/en/build-with-claude/effort |
| Structured outputs: `output_config.format: {type: "json_schema", schema}`; supported on all four models; `additionalProperties: false` required; no `minimum`/`maximum`/`minLength`/`maxLength`/`pattern`/recursion; SDK helper `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod` | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| `POST /v1/messages/count_tokens` (`client.messages.countTokens`), same inputs as Messages, returns `input_tokens`; an estimate; free, separately rate-limited; 4.7+ tokenizer ~30% more tokens | https://platform.claude.com/docs/en/build-with-claude/token-counting |
| Batches: up to 100,000 requests or 256 MB; `processing_status` `in_progress` → `ended`; results `succeeded`/`errored`/`canceled`/`expired`, keyed by `custom_id`, available 29 days; expire after 24 h; 50% pricing | https://platform.claude.com/docs/en/build-with-claude/batch-processing |
| Errors: 400/401/402/403 `permission_error`/404 `not_found_error`/413/429/500/504/529 `overloaded_error`; `request-id` header; SDKs retry transient failures twice by default honouring `retry-after`; typed exception classes | https://platform.claude.com/docs/en/api/errors |
| `@anthropic-ai/sdk` 0.125.0, peer `zod ^3.25 || ^4` | `npm view @anthropic-ai/sdk` |

**Not verified here:** the exact tokenizer behaviour for estimator heuristics beyond "~30% more
tokens on 4.7+"; the heuristic constants are config and calibrated from `ai_calls` (R-09 stays open
for final prices before launch).

## Tests

- Cost: computed cost equals recorded cost for scripted usage including cache writes (5 m and 1 h),
  cache reads, batch, and Fable 5.1's read multiplier; property: never negative, monotone in tokens.
- Runtime cap pauses a job (state `needs_quote`, reservation released, `estimation_miss` recorded).
- No generic passthrough: public export surface test; web bundle import guard.
- Orchestrator: structured-output request shape, repair once then `platform_fault`, refusal,
  truncation, fallback on 404/529 with `fallback_from`, effort omitted for Haiku.
- Estimator and calibration; batch client with scripted results.
- Evals run in replay mode in CI and write a report.

## Summary (2026-09-13)

**Acceptance (SPEC §34): met.**

| Criterion | Evidence |
|---|---|
| Recorded cost per call matches cost computed from usage | `packages/ai/test/cost.test.ts` covers cache writes (5 m and 1 h), cache reads, Fable 5.1's read multiplier, batch discount and round-up, with property tests for non-negativity and monotonicity. `test/orchestrator.test.ts` compares the `ai_calls` row (µ$, paise, FX rate used, token columns) with `costMicroUsd(usage)`. `test/services.test.ts` does the same for batch rows. |
| Runtime cap test pauses a job | `test/orchestrator.test.ts`, "runtime cap pauses a job": the first call fits and is recorded; the second is projected over the cap and is never sent. The job ends in `needs_quote` with its reservation released and held credits back to 0. An `estimation_miss` event carries the absorbed cost, and a `runtime_cap` quote is offered at a 49/99 ending. |
| No generic passthrough exists | `test/surface.test.ts` checks four things: the export list holds only purpose-named functions; stage inputs have no model, prompt, effort or max_tokens field; the index is `server-only`; and no client component or browser package imports `@magicmis/ai`, and nothing outside `packages/ai` imports the SDK. |
| Evals run and report | `test/evals.test.ts` builds datasets from the fixtures and runs the harness in replay mode through the production orchestrator. It stores an `ai_eval_runs` row and checks that a replay cannot activate a prompt. `pnpm --filter @magicmis/ai evals` writes a JSON report. |

**Tests added:** 49 in `packages/ai`:
- cost 12
- orchestrator 13
- surface 5
- units 9
- services 7
- evals 3

Admin, worker and db suites still pass (11, 7 and 62 tests).

**Built**

- `packages/ai`:
  - registry and routing
  - exact cost
  - Zod → structured-output schema
  - SDK transport
  - orchestrator: cache breakpoints, `<data>` payload, token-counted runtime cap, one repair, refusal and truncation handling, fallback chain, `ai_calls` for every call
  - `classifySheets`, `mapColumns`, `mapLedgers` with payload caps and input-dependent checks
  - job cap and pause
  - estimator and calibration
  - batch submit and collect
  - semaphore
  - activation gate
  - margin and registry queries
  - eval datasets, harness and CLI
- Prompts v1: shared rules, sheet classification, column mapping and ledger mapping.
- `apps/worker`: nightly `ai-estimator-calibration` task.
- `apps/admin`: Margin screen v1, showing:
  - AI cost ratio per action, flagged over `max_ai_cost_ratio`
  - cache hit, fallback and failure rates per stage
  - estimation misses and absorbed cost
  - model registry with a staleness warning
- Migration 0019:
  - verified model registry (Fable 5.1 unavailable by default)
  - SPEC §14 routing for nine stages × three tiers, with no prompt activated
  - `ai_eval_runs`, `margin_events`
  - `ai.fx`, `ai.estimator`, `ai.concurrency`, `ai.eval_thresholds`, `ai.cache_ttl`, `ai.registry_stale_days`
- ADR 0019.

**Decisions of note**
- Batch items that fail are rerun realtime, so the single repair and the fallback live in one place.
- Evals bypass activation only for the candidate version and only through the internal `runStage`.
- Vitest aliases `server-only` to a stub. The worker imports only the marker-free `@magicmis/ai/estimator` subpath.

**New dependencies**

- `@anthropic-ai/sdk` 0.125.0: the SPEC §5 Anthropic client (typed errors, retries, `withResponse` request IDs).
- `server-only` 0.0.1 in `packages/ai`: a build-time guard that stops the AI package being bundled for the browser.

**TODO(review) raised or touched:**
- R-09: drafted. Prices verified; effort and `max_tokens` still need tuning from evals.
- R-14: FX seed.
- R-28: live evals and prompt activation.
- R-29: ledger-mapping eval dataset.
- R-30: estimator heuristics.
