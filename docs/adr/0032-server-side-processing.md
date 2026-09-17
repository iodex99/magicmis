# ADR 0032: Files are uploaded and processed on the server

**Status:** accepted · **Date:** 2026-09-17 · **Decided by** the product owner · **Amends** the locked decision in SPEC §2.8 ("raw files never leave the browser"), SPEC §7 (Zone A), §15–§24 (where the pipeline runs), §19 (mandatory mapping review) and §27 (Deep chat queries in the browser)

## Context

The owner ran a sample workbook and was asked to review **1,518 ledger rows, 1,161 of them
unmapped**. Their direction: _"remove the browser processing fully … it may cause such type of
friction and may throw away the user, let claude api handle."_

Before changing a locked decision, the cause was traced and put to the owner (working rule 3):
the review burden came from a best-guess fallback reading a non-trial-balance sheet with no AI
available, and from the review being mandatory — neither caused by the browser as such. Three
options were offered: keep browser processing and remove the friction; a hybrid where the
browser reads and Claude maps; or upload files and let the server and Claude do the work. The
owner chose **upload to server, Claude handles it**, knowing it reverses the privacy
positioning and requires the legal and marketing copy to change.

## Decision

### 1. Upload

Files are uploaded in chunks of `sources.chunk_bytes` (4 MB, under Vercel's 4.5 MB request body
limit), three at a time, to `/api/companies/:id/uploads` → `PUT /api/uploads/:id/chunks/:n` →
`POST /api/uploads/:id/complete`.

- Each chunk is **sealed under the company's data key** (`sealForCompany`, purpose
  `source_chunk`) before it is written to the output store. The store never holds plaintext
  (`e2e/frictionless.spec.ts` asserts it on disk).
- `source_uploads` (migration 0041, RLS forced, owner-select only) holds a name, size, which
  chunks arrived (a set, so parallel and retried chunks are counted once), status, and counts —
  nothing from inside a file.
- On completion the server counts what SPEC §2.3 allows before payment — name, size, sheet
  count, row count — or returns a refusal with what to export instead. An `.xlsx` is counted
  without a spreadsheet library (`countXlsx`: inflate each worksheet part with Node's native zlib
  and count `<row>` elements holding a value). Inside the Next.js server SheetJS took 50–110 s on
  the 50 MB fixture against 14 s in plain Node; the counter takes about 2 s, and the SPEC §33
  upload-and-read budget is met in 10 s. SheetJS is also given native zlib (`use_zlib`) for the
  full read a paid run needs.
- **Retention:** every upload expires after `sources.retention_days` (30, **R-63**). The worker's
  `sources-purge` task removes expired chunks hourly, and also those of deleted companies. The
  Uploaded files page lists every kept file with its deletion date and deletes on request.
  Destroying a company key already makes its chunks unreadable; the purge clears the ciphertext.

### 2. Price and run

- `POST /api/jobs` takes `uploadIds` (and a `referenceUploadId`) instead of browser-computed
  size descriptors. The server checks the uploads belong to the account and company, reads them
  and prices from its own counts — a modified browser can no longer understate a job's size.
- `POST /api/jobs/:id/run` (after the SPEC §12 confirmation) runs the whole job in one request
  (`maxDuration` 300 s): read → prepare → classify → map → compute → validate → render →
  complete (`apps/web/src/lib/server/run-job.ts`). The browser shows progress by polling the job
  state.
- **No mandatory review.** Mapping follows the cascade, AI proposes heads for what is left, and
  every proposal is accepted as made. Anything unplaceable goes to Unmapped, reported as a
  warning (ADR 0031). A month no file names is assumed (the month after the company's latest,
  else the latest loaded, else last month) and said in a notice. A reference MIS layout is bound
  by rules then AI and accepted as proposed.
- AI stages are checkpointed per job (`saveStageOutput`), so a retried run never pays twice, and
  an AI stage that cannot run falls back without failing the job.
- DuckDB runs server-side through the Node blocking build of the same `@duckdb/duckdb-wasm`
  1.32.0 the engine is tested against, loaded at runtime (`process.getBuiltinModule` →
  `createRequire`) because the bundler cannot process its Emscripten output. One in-memory
  database per job, closed afterwards.

### 3. Chat

Deep questions run their queries on the server (`answerDeepOnServer`) against the company's latest
snapshot — every ledger balance, already mapped, party names already tokens — plus bills from the
most recent upload while it is kept. Each query passes the same SQL guard, row and byte caps and
redaction as before; the loop continues server-side and the browser receives the answer. Names
behind tokens in an answer come from `POST /api/companies/:id/chat/names`, which re-reads the
kept upload; once it is purged, tokens show as tokens.

### 4. What was removed

The browser pipeline and ingestion workers, their DuckDB asset copy step, the mapping and binding
review components, and every endpoint that only existed for the browser to drive a job:
`/api/jobs/:id/ai/*`, `/api/jobs/:id/complete`, the `advance` and `fail` job actions,
`/api/chat/messages/:id/steps/:stepId/result` and `/api/companies/:id/session` (which handed the
company's redaction key to the browser). Each was a place where a modified client could submit
results the server had to trust; none remains.

### 5. What did not change

- **Claude never outputs numbers** (SPEC §2.7). It names sheet types and proposes heads; the
  engine computes every figure.
- **Anthropic receives only redacted content** from action-specific server code: sheet structure,
  capped redacted samples, redacted ledger names, chat query results. The outbound builder and
  `assertNoRawIdentifiers` are unchanged; ledger names bound for AI mapping are additionally
  passed through `redactText`.
- The API key is server-side only; no endpoint accepts a prompt.
- Before payment, only names, sizes, sheet counts and row counts are shown.

## Consequences

- **The privacy positioning changes.** "Raw files never leave the browser" was on the home page,
  security page, several guides, the privacy notice, the terms and the processing notice. All now
  say what happens: files are uploaded over an encrypted connection, encrypted under a key unique
  to the company, used only for paid runs, redacted before the AI sees any part of them, and
  deleted on a schedule. The security page says plainly that a service which never received the
  file would be a stronger guarantee. Document versions move to 1.1-draft (migration 0042), so
  every account accepts the new processing notice before its next upload.
- **More data is held.** Customer files now sit on our infrastructure for up to the retention
  period. That raises the stakes on the storage bucket, the KMS key policy and the output store
  credentials, and it is a change the data-protection review (**R-50**) must see. The processing
  register gains an uploaded-files activity.
- **Serverless limits.** A run happens in one request. The largest setups must finish inside the
  function's maximum duration; the job is checkpointed, and moving the run to the pg-boss worker
  is the next step if that limit is reached in production (**R-64**).
- **The friction the owner hit is not fully solved by this alone.** With no prompt activated
  (R-28), unmatched ledgers still go to Unmapped. The difference now is that the customer gets a
  workbook with warnings instead of a review screen; the matching itself improves when the AI
  stages are switched on.
- Tests: upload store (sealed at rest, any order, retries, cross-account refusal, purge), browser
  acceptance for upload, refusal, PDF, drag state, the 50 MB budget, Uploaded files deletion, the
  full setup/refresh/reference/chat flows on the server path, and the cross-tenant probe over
  every new route.
