# ADR 0019 — AI layer: internal orchestrator, purpose-named stages, cost from usage, pause on cap

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 4

## Context

SPEC §2.5–2.9, §7, §12 and §14 require the following:

- Anthropic is reachable only through server-side, action-specific functions.
- Model, effort and `max_tokens` come from tier routing.
- Structured output is validated, with one repair attempt.
- Every call is recorded with exact cost.
- A runtime cap pauses a job before it overspends.
- A prompt version can be activated only after its evals pass.

## Verified facts

All facts were checked on 2026-09-13.

| Fact | Source |
|---|---|
| Model IDs are `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-5` and `claude-fable-5-1`. | https://platform.claude.com/docs/en/about-claude/models/overview |
| Effort is not supported on Haiku 4.5. | https://platform.claude.com/docs/en/about-claude/models/overview |
| Prices per MTok (input / output): Haiku 4.5 $1 / $5, Sonnet 5 $2 / $10, Opus 5 $5 / $25, Fable 5.1 $10 / $50. | https://platform.claude.com/docs/en/about-claude/pricing |
| Cache writes cost 1.25× (5 min) or 2× (1 h). Cache reads cost 0.1×, or 0.025× on Fable 5.1. | https://platform.claude.com/docs/en/about-claude/pricing |
| The Batch API is 50% off. | https://platform.claude.com/docs/en/about-claude/pricing |
| Usage fields: `input_tokens` (uncached remainder), `cache_creation_input_tokens`, `cache_read_input_tokens`, and the `cache_creation` 5m/1h breakdown. | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| Structured outputs use `output_config.format = {type: "json_schema", schema}`. `additionalProperties: false` is required. Numeric, length and pattern constraints are not supported. | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| Effort is set with `output_config.effort`. | https://platform.claude.com/docs/en/build-with-claude/effort |
| Token counting (`messages.countTokens`) returns an estimate and is free. | https://platform.claude.com/docs/en/build-with-claude/token-counting |
| Batches take up to 100,000 requests or 256 MB and expire after 24 h. Results come back per `custom_id`. | https://platform.claude.com/docs/en/build-with-claude/batch-processing |
| Error types include not_found and permission (404/403), 429, 5xx and 529 overloaded. The SDKs retry twice by default and honour `retry-after`. | https://platform.claude.com/docs/en/api/errors |
| `@anthropic-ai/sdk` 0.125.0 provides `messages.create().withResponse()` → `{data, request_id}`, typed error classes and `MessageCountTokensParams` including `output_config`. | Package type declarations |

## Decisions

1. **One internal orchestrator; the public surface is purpose-named stages only.**
   - `packages/ai` exports `classifySheets`, `mapColumns` and `mapLedgers`. Later phases add the remaining SPEC §14 functions.
   - Each stage fixes its prompt file, Zod input and output schemas, and a byte cap on the payload.
   - `runStage`, `recordCall` and request building are not exported.
   - `test/surface.test.ts` checks the export list and the input schemas, and verifies that:
     - no client component or browser package imports the package;
     - nothing outside `packages/ai` imports the SDK.
   - The index imports `server-only`.
   - The worker imports only the `@magicmis/ai/estimator` subpath, which has no `server-only` marker.

2. **Routing is read from the database, latest version wins.**
   - `tier_routing.prompt_version` is null until a prompt version is activated, and a null value refuses the stage.
   - Effort is sent only where the model supports it, so it is never sent for Haiku 4.5.

3. **Prompt layout, most stable first.**
   - The system prompt is the stage file plus the shared rules, with a cache breakpoint.
   - The user content is the stable blocks (allowed types, roles or heads), with a breakpoint on the last one, followed by the payload in `<data>` tags.
   - Content below the model's minimum cacheable length is simply not cached; no extra charge applies.

4. **Output validation.**
   - Zod (the source of truth) generates the JSON schema, reduced to the supported subset and closed on every object.
   - After parsing, three checks run:
     - the full Zod schema, which rejects digits in prose;
     - input-dependent checks: every ref answered once, codes from the allowed list, a role used at most once;
     - anything that fails triggers one repair turn carrying the errors.
   - A second failure, a refusal or a `max_tokens` stop fails the stage as a `platform_fault`.

5. **Fallback.**
   - Not-found, permission and 5xx/529 errors, after the SDK's two retries, move to the next model in `fallback_chain`.
   - Models flagged `available=false` are skipped.
   - `fallback_from` is recorded, and the result reports `downgraded` so pricing can capture the delivered tier.
   - A 400 is not retried on another model.

6. **Cost comes from usage only.** Every call writes one `ai_calls` row, including failures (zero usage) and repairs.
   - Cost is summed as an exact rational over:
     - uncached input;
     - 5-minute and 1-hour cache writes;
     - cache reads;
     - output;
     - the batch discount, where it applies.
   - It is rounded up once, to the micro-USD.
   - INR is paise at `ai.fx` rate × (1 + buffer), rounded up, with the effective rate stored.

7. **Runtime cap.**
   - Before each call: projected = spent + counted input at full input price + `max_tokens` at output price. This is never optimistic.
   - If projected exceeds the cap, `RuntimeCapExceeded` is thrown before sending.
   - `runJobAiStage` then does the following:
     - moves the job to `needs_quote`;
     - releases the reservation;
     - records an `estimation_miss` margin event for the cost absorbed so far;
     - offers a `runtime_cap` quote sized to the projected total at `max_ai_cost_ratio`, rounded to the configured endings.
   - The cap is the job's price, or its accepted quote, × `max_ai_cost_ratio`.

8. **Batch.** Batches are submitted and collected by the worker.
   - The cap is checked per budget at full price before submission.
   - Costs are recorded at the discount.
   - An item that errored, expired, was refused, was truncated or failed validation is returned as `retry_realtime`, so the realtime path supplies the single repair. There is no fallback inside a batch.

9. **Estimator.**
   - Stage token estimates come from size descriptors (counts only), using `ai.estimator` characters per token × tokenizer inflation, priced at the routed model.
   - p90 = p50 × the p90 multiplier, raised to the calibrated p90 for the action, tier and size bucket when present.
   - Nightly worker job `ai-estimator-calibration` recomputes p50/p90 from `ai_calls` over `calibration_window_days`.
   - `monthly_refresh` has no AI stages (SPEC §35).

10. **Activation gate.**
    - `activatePromptVersion` requires the latest **live** eval for that stage, tier, prompt version and routed model to meet `ai.eval_thresholds`.
    - Replay runs never count.
    - Activation writes a new routing version and an audit entry.

11. **Evals.**
    - Datasets come from the synthetic fixtures:
      - sheet classification with names and titles removed;
      - column mapping labelled by the Phase 3 header rules.
    - The harness uses the production orchestrator, bypassing activation for the candidate version only.
    - Live mode (`AI_LIVE=1` + key) saves recordings; replay mode reproduces them.
    - With no recording, an oracle replay exercises the harness in CI.

12. **Concurrency.** An in-process FIFO semaphore applies: a global limit plus per-account limits for jobs and chat, from `ai.concurrency`.

## Consequences

- No prompt is activated yet. Every stage refuses until a live eval passes, which needs an API key and spend (R-28).
- Model prices are data. Admins see `verified_at` staleness after `ai.registry_stale_days`.
- `ledger_mapping` has no eval dataset until canonical heads exist (Phase 5, R-29).
- Commentary, chat and reference-layout stages reuse the orchestrator when their phases land.
