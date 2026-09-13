# Phase 8 — Chat

Scope from SPEC §34:

> - Quick, deep and edit flows; SQL guard with fuzz tests; step protocol; round cap.
> - Thread cap and summary; Investigate buttons; pricing and reservations per type.
> - *Acceptance:* guard blocks the malicious corpus; round cap enforced server-side; out-of-scope
>   decline charged per policy; placeholders resolve with lineage.

## Plan

- **`packages/sql-guard`:**
  - libpg-query allowlist guard;
  - session table definitions;
  - enforced LIMIT;
  - malicious corpus and property tests.
- **`packages/engine`:** placeholder check generalised with `{{q:…}}` query cells.
- **`packages/chat`:**
  - deterministic Quick retriever;
  - server flows: send and hold, Quick, Edit, the Deep loop with steps, result validation, thread cap and summary, thread view, sweep.
- **`packages/ai`:**
  - `chatQuick`, `chatEditSpec` and `summariseThread` stages;
  - the `chatDeepStep` tool loop;
  - chat AI context;
  - prompts;
  - eval datasets.
- **`packages/pipeline`:** chat session tables in a locked DuckDB; guarded, capped, redacted queries.
- **`packages/render-dashboard`:** answer renderer with metric and query-cell lineage.
- **`packages/jobs`:** template edits with undo. The JSON Patch engine moves to `@magicmis/core`.
- **`apps/web`:**
  - chat API routes;
  - chat page with type, tier and price, the out-of-scope charge note, Deep gated on loaded files, lineage panels, and edit apply/undo;
  - Investigate on dashboard KPIs;
  - parser WebAssembly handling;
  - dev-only fake model for E2E.
- **`apps/worker`:** chat sweep.
- **Migration 0024:**
  - chat message price and tier, reply link and failure reason;
  - query step fields;
  - thread continuation;
  - chat config;
  - chat routing `max_tokens` sized to the cost caps.

## Summary (2026-09-13)

**Acceptance (SPEC §34): met.**

| Criterion | Evidence |
|---|---|
| Guard blocks the malicious corpus | `packages/sql-guard/test/guard.test.ts` (77 tests). All 69 malicious entries are rejected: every denied statement, stacked and comment-hidden statements, `read_csv` / `read_parquet` / `read_json` / `glob`, replacement scans (`FROM 'x.csv'`, `FROM x.csv`), catalogs, `getenv` / `current_setting` / `pg_sleep`, URLs and paths in literals, `SELECT INTO`, `FOR UPDATE`, arrays, `regclass` casts, empty input. Legitimate CTE, window, join and CASE queries pass and are wrapped with the row cap. Property tests embed forbidden constructs anywhere (2,000 runs) and throw arbitrary strings (3,000 runs). **Defence in depth:** `packages/pipeline/test/chat.test.ts` shows that the locked browser DuckDB refuses `read_csv`, `COPY` and re-enabling access even without the guard. |
| Round cap enforced server-side | `packages/chat/test/server.test.ts`. With `chat.max_rounds` = 2, the third model request is sent with `tool_choice: {type: "tool", name: "answer"}` and the message records 2 rounds. A model that still calls `run_query` at the cap is refused, repaired once, then failed with the hold released and no third step stored. A guard-rejected query spends a round and returns to the model as an error. |
| Out-of-scope decline charged per policy | Server test: a one-sentence decline captures the Quick price and records `declined_out_of_scope`. **Browser:** `apps/web/e2e/mis.spec.ts` shows "outside this MIS · 19 credits" and the database shows both messages charged 19. The send button shows the price, and the charge note appears next to the input. |
| Placeholders resolve with lineage | Server: answers store the metric values their placeholders cite, with formulas; Deep answers store query lineage (SQL, purpose, tables, result). `render-dashboard/test/answer.test.ts` re-checks in the browser and substitutes values with lineage keys; digits, unknown metrics and cells outside a result are refused. **Browser E2E:** a Quick answer opens the metric lineage panel; a Deep answer (query run in the browser over the loaded trial balances) opens the query lineage panel showing SQL and tables. |

**Also delivered and tested:**
- **Holds:** prices are held before AI; there is no message without credits.
- **Failures:** an answer with figures fails after one repair and releases the hold.
- **Edit:** the proposal is repaired when a value is not JSON; it applies as a new dashboard version and undoes (server test and E2E).
- **Template edits:** apply, undo, and refuse invalid patches.
- **Threads:** a thread caps; the continuation's first message makes the summary call, recorded on that message.
- **Sweep:** abandoned messages are released.
- **Browser queries:** capped by rows and bytes, redacted, and HUGEINT results stringified.
- **Investigate:** opens a Deep question about the KPI's metric.
- **Evals:** replay runs pass for `chat_quick`, `chat_edit` and `thread_summary`.

**Tests added:**

| Package / suite | Tests |
|---|---|
| sql-guard | 77 |
| chat: retriever | 3 |
| chat: server | 10 |
| pipeline: chat | 5 |
| render-dashboard: answer | 2 |
| jobs: template edits | 1 |
| ai: evals | 3 |
| web E2E | 3 |

**Defects found and fixed:**
- **Chat routing (margin):** as seeded, chat routing projected AI cost above every Quick cap, so no Quick message could run. `max_tokens` was re-seeded in migration 0024.
- **Guard:** it missed cast types carried as an unwrapped `typeName` field.
- **A formatter turned a regex escape into literal NUL bytes.**
- **Script-written regexes lost their backslashes (twice).** Regex-bearing code is now edited only with the editor tools.
- **Parser WebAssembly paths** broke in both the server bundle (fixed by making the package external) and the worker bundle (fixed with a request shim).
- **Dependency cycle** chat → jobs → pipeline → chat, fixed by extracting `@magicmis/sql-guard`.

**New dependencies:**
- `libpg-query` 17.7.4 (MIT): PostgreSQL's parser in WebAssembly, the "real SQL parser" SPEC §27 asks for (ADR 0023).
- `@anthropic-ai/sdk` 0.125.0 as a **types-only** dev dependency of `@magicmis/chat` tests.

**Known issues:**
- The worker's notification concurrency test and the wallet concurrency test each failed once under a full parallel run and passed on rerun.
- The web `wallet.spec` proforma test can hit the app's sign-up rate limit after repeated local runs (noted in Phase 7).

**TODO(review) raised:**
- **R-42:** chat prices against worst-case Deep AI cost, and the chat `max_tokens` seeds.
- **R-43:** abandoned chat messages are released with the AI cost absorbed.
- **R-44:** a tool-loop eval harness for `chat_deep` activation.
- **R-45:** the fake AI transport must never be enabled in a deployed environment.
- **R-46:** SQL guard allowlists and session table definitions; payroll is not yet a session table.
