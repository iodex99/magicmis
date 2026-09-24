# Project brain — Magic MIS

Prepaid, usage-priced AI MIS platform for CA firms and SMEs. Indian-built and sold
worldwide: **India is billed in INR with GST, everywhere else in USD as a zero-rated
export of services** (ADR 0030).
Full specification: [docs/SPEC.md](docs/SPEC.md) — complete, Sections 0–35.

---

## Current phase

**All ten phases built (§34)**, plus the Phase 9 follow-ups (ADR [0025](docs/adr/0025-reconciliation-anchors-break-glass-scope.md)), the interface redesign (ADR [0026](docs/adr/0026-ui-redesign.md), and the one-workspace flow, ADR [0033](docs/adr/0033-one-workspace-no-price-step.md), and the currency, report and dark-mode pass, ADR [0034](docs/adr/0034-one-currency-boardroom-reports-dark-mode.md) with its follow-ups, ADR [0035](docs/adr/0035-year-mismatch-commentary-report-chat-admin-dark.md) and the character pass, ADR [0036](docs/adr/0036-character.md) and the brand mark and explainer, ADR [0037](docs/adr/0037-brand-mark-and-explainer.md), and every name the report goes by, ADR [0038](docs/adr/0038-every-name-the-report-goes-by.md), and raw data and the words the market types, ADR [0039](docs/adr/0039-raw-data-and-the-words-the-market-types.md), and credits that keep with the price book in the wallet, ADR [0040](docs/adr/0040-credits-that-keep-a-price-book-that-moves.md), and credit packs in dollars with a rendered tour, ADR [0041](docs/adr/0041-credit-packs-in-dollars-a-tour-that-is-rendered.md), and one look from site to sign-in with a quieter security page, ADR [0042](docs/adr/0042-one-product-from-site-to-sign-in-and-a-quieter-security-page.md), and Google or Apple sign-in with the password reset, ADR [0043](docs/adr/0043-sign-in-with-google-or-apple-and-the-password-reset.md), and a rail and chat that fold away, ADR [0044](docs/adr/0044-a-rail-and-a-chat-that-fold-away.md), and a company's own tables and names remembered for good, ADR [0045](docs/adr/0045-a-companys-own-layout-is-remembered-for-good.md), and a dashboard built by chatting and presented live, ADR [0046](docs/adr/0046-a-dashboard-built-by-chatting-and-presented-live.md), and add a file with files kept, chosen and opened by nobody unrecorded, ADR [0047](docs/adr/0047-files-kept-chosen-and-opened-by-nobody-unrecorded.md), and the storage cap, hidden months everywhere and the legal review brief, ADR [0048](docs/adr/0048-decisions-on-kept-files-cap-hidden-months-legal-brief.md), and running out of credits before and part-way, ADR [0049](docs/adr/0049-running-out-of-credits.md), and a Wallet that sells, ADR [0050](docs/adr/0050-a-wallet-that-sells.md), and sample dashboards in place of a sample MIS, ADR [0051](docs/adr/0051-sample-dashboards-not-a-sample-mis.md), and what a rupee costs to earn, ADR [0052](docs/adr/0052-what-a-rupee-costs-to-earn.md), and what a full audit found, ADR [0053](docs/adr/0053-what-the-audit-found.md), and the decisions on what it left open, ADR [0054](docs/adr/0054-decisions-on-the-open-items.md), and the owner's business page, ADR [0055](docs/adr/0055-the-owners-business-page.md), and a dashboard chosen for the company, ADR [0056](docs/adr/0056-a-dashboard-chosen-for-the-company.md), and what the end-to-end audit found, ADR [0057](docs/adr/0057-what-the-end-to-end-audit-found.md), and closing what it left open, ADR [0058](docs/adr/0058-closing-what-the-audit-left-open.md), and indexes for the reports, ADR [0059](docs/adr/0059-indexes-for-the-reports.md), and the add-company form always being there, ADR [0061](docs/adr/0061-the-add-company-form-is-always-there.md), and where to act, ADR [0062](docs/adr/0062-where-to-act.md), and where to act is on the board, ADR [0063](docs/adr/0063-where-to-act-is-on-the-board.md), and reading the board is not changing it, ADR [0064](docs/adr/0064-reading-the-board-is-not-changing-it.md), and the owner's page reads as a report, ADR [0065](docs/adr/0065-the-owners-page-reads-as-a-report.md), and a limit the model is never told, ADR [0066](docs/adr/0066-a-limit-the-model-is-never-told.md), plan [ui-redesign](docs/plans/ui-redesign.md)) the friction pass (ADR [0027](docs/adr/0027-friction.md)), the launch decisions (ADR [0029](docs/adr/0029-launch-decisions.md)), the public site (plan [seo-marketing](docs/plans/seo-marketing.md)) and selling worldwide in two currencies (ADR [0030](docs/adr/0030-worldwide-two-currencies.md), plan [worldwide](docs/plans/worldwide.md)). **Deployment target is Vercel.** What remains needs facts only the owner holds: [docs/REVIEW_ITEMS.md](docs/REVIEW_ITEMS.md) — the apex domain (R-01), seller details and SAC (R-02/R-03), final prices (R-04/R-05, which wait on R-28's live evals for real AI costs), legal wording (R-10/R-11/R-12), a live Razorpay run (R-26), the export LUT (R-59), Razorpay international activation (R-60) and a data-protection review (R-50).

Design system: tokens in `packages/ui/src/tokens.ts`, mirrored into both apps' `globals.css`.
Headlines use Space Grotesk through `.display`; figures never leave Inter's tabular numerals.
Motion is CSS (`.rise`, `.lift`, `.press`, `RollingNumber`) and collapses under reduced motion;
no gradients, no glows (ADR 0036).
The mark has one definition, `MARK_PATH` in `apps/web/src/components/Logo.tsx`; the favicon, social
image, rail, headers and admin console all draw from it, and `apps/web/public/brand/` holds the
exports. The motion explainer in `docs/brand/explainer/` is a pure function of time, rendered frame by
frame to `public/brand/tour.webm` by `apps/web/e2e/support/record-tour.ts` — never filmed in
real time (ADR 0041). **Dollar positioning:** the public pricing page shows dollars to everyone but
a visitor geolocated in India, who sees the rupees they will be billed (ADR 0041).
Primitives in `apps/web/src/components/ui.tsx`; icons are hand-drawn in `Icon.tsx` (no icon
dependency, and never a sparkle). One indigo accent; the dark `ink` surface is navigation
only and never sits under figures. **No public page outside `/legal` names a vendor or any part of the stack** — an E2E test enforces it; processors are named in the privacy and processing notices because the law requires it (ADR 0042). **The public site offers no sample MIS to download**: it shows sample dashboards, drawn with the product's chart components on invented companies, in two rows drifting in opposite directions (`DashboardCarousel`, `.marquee-track`; no edge fade, and still under reduced motion), and `/mis-report-template` redirects for good to `/mis-dashboard` (ADR 0051). Seed a signed-in demo account against the local stack
with `apps/web/e2e/support/seed-demo.ts`.

Flow rules that are easy to undo by accident: sign-up asks for four things only (billing
details are collected at the first purchase, migration 0034); the confirmation email
establishes the session and lands in the app; **customers sign in with a password, or with Google or Apple once the owner has switched one on** (`AUTH_OAUTH_PROVIDERS`, off by default; [runbook](docs/runbooks/identity-providers.md)) — a provider account has no password, the re-check for sensitive actions still asks for one, and the emailed reset link sets it and **authorises nothing else**: the token is spent by a POST together with the new password, never on the GET and never as a re-authentication grant; a provider sign-in to an account nobody has ever signed in to does not claim it but sends its owner to finish it (ADR 0043)
(ADR 0028 — the admin console still requires TOTP, and `app.current_account_id()` now gates
on the active session alone, migration 0036); **the Wallet opens on the credit packs with a button on each, never on a form** — billing details are a step inside the first purchase that carries straight on to payment, packs are listed before tax in the visitor currency until then (`walletView` requires it), and the per-action price table lives at `/wallet/prices`, one quiet link away, because a button that holds credits must have its price on record (ADR 0050); **a run has no Delivery option** — every run is instant and the tier is the only choice (ADR 0050); **there is no price step** — pressing an
action's button holds its credits, and only a quote over the AI cost cap or a short wallet
stops it (ADR 0033); **a company is one workspace** — setup when new, then the dashboard
with the assistant (chat and commentary merged) beside it, no separate tabs (ADR 0033); **the chat may be folded away but is never out of reach** — a fixed launcher, Ctrl/⌘ K, Investigate, and a rail button on every signed-in page all open it, it stays mounted while hidden, and both it and the rail remember their state in cookies the server reads (ADR 0044); **a company's own tables and names are remembered for good, per company** — a stored layout is read only through `packages/jobs/src/stored-layout.ts`, where absent is null and unreadable is thrown (never fall back to the default layout: it would be stored over the company's own), `completeJob` keeps the newest layout at the moment it writes unless told `layout: "replace"` (reference recreate only), and every `storeBlueprint` names the version it was `basedOn` and is refused if that is no longer the latest (ADR 0045); **the dashboard is built by chatting and presented live** — one chat box, where `detectIntent` (rules, shown to the customer as "This will update the dashboard" before they send) routes a message to a question or a dashboard change; a dashboard change that passes the stage's check is applied by the server as it is answered and offers Undo, while a change to the MIS template still waits for a confirmation; a figure the catalog lacks is a **formula as data** (`calculated` on the dashboard spec) that the engine computes exactly (`evaluateCalculated`) — the model may put into a formula only a constant the customer typed or a structural one, and into a title only digits the customer typed; every addition to the dashboard spec is optional with a default so older saved dashboards still read (ADR 0045), and anything new a box can hold must be added to the `chat_edit` check in the same change; **there is no print and no export of the dashboard or the commentary** — it is presented from the dashboard's own Present button, full screen, with lineage still one click away — while the workbooks a run produced stay downloadable (ADR 0046); **it is "Add a file", one button, and the dashboard follows** — a completed run delivers the dashboard too (`bringDashboardUpToDate`), as its own priced action at the price-book price and never failing the run; **files are kept** (`sources.retention_days` = 0 means no expiry) and **every decryption of one is recorded first** (`loadUploadBytes` requires a `purpose`; `source_upload_reads` is append-only and has no purpose for a member of staff, because nothing in the admin console or the worker opens a file — keep it that way); **never write "we cannot read your files"**: the server processes them, so what is said is that no person on our side can open one, that every opening is on a record the customer sees, and that deleting the company destroys its key; **a file's tick decides whether its months are on the dashboard** — a run records the months each file fed, and `visibleValues` shows a figure only if no month it was computed from is hidden, recomputing and charging nothing; **the workspace is the board and the chat only**, every box on it ends in Investigate and Change, and conventions, files, workbooks, charges and deletion live on Files and settings (`/app/companies/:id/manage`) (ADR 0047); **a hidden month is hidden everywhere** — board, quick and Deep answers, commentary — and kept files are **capped per company** (`sources.max_company_bytes`), not priced; the sentence "no member of staff can open a file" is in the terms and is held by `packages/jobs/test/no-staff-path.test.ts`: if it fails, change the wording first, never the test (ADR 0048); **running out of credits never loses work or leaves the page** — a short wallet, a run paused part-way for a quote (`needs_quote` is not a failure: the screen offers to carry on and resumes from the checkpoint), a quote the wallet cannot cover and a short chat message are all topped up in place with the files or the message kept (ADR 0049); **every figure carries the company's own currency** — `formatValue`, `companyFormat`,
`buildFactsPack`, `retrieveFacts` and `renderWorkbook` all require the symbol, with no rupee
default, and the scale is stated on screen and in the workbook (ADR 0034); **light and dark**
are one inverted neutral ramp plus semantic surfaces, chosen by a `theme` cookie read in the
root layout (ADR 0034); **a run says when the files run on a
different financial year from the company** (`detectSourceFinancialYear`) and the conventions
can be corrected afterwards, PATCH `/api/companies/:id` (ADR 0035); **a run gets the customer to a workbook**
(ADR 0031, ADR 0032) — files are uploaded and the whole run happens on the server
(`lib/server/run-job.ts`, one request, no review); any file format is read (text PDFs included) or refused with a
reason, unplaceable sheets are set aside rather than failing the job, AI classification is
called only when no balances were found, a missing month is assumed and said, an AI stage that
cannot run never fails the job, and data-fault checks deliver the workbook with warnings
(`deliverWithWarnings`) while platform faults still block. Changing `supabase/templates/` needs
`docker restart supabase_auth_magicmis` to take effect locally.

CI runs E2E against a **clean** Supabase stack, which catches what a long-lived local one
hides. Before pushing a flow change, reproduce it: `npx supabase stop --no-backup` then
`npx supabase start -x storage-api,imgproxy,realtime`.

Run the checks as CI does: `pnpm test` (turbo, not `pnpm -r test` — they schedule
differently), `pnpm lint`, `pnpm typecheck`, and `pnpm format:check`, which covers the
whole tree including `.sql`, `.html` and `.md` that a hand-written glob will miss.

**Turbo caches `lint` and `typecheck` too, not just `test`.** A green `pnpm lint` reading "24 successful" can be twenty-four cache replays; CI then fails on a rule your new file breaks. Force the one you are relying on as evidence: `TURBO_FORCE=true pnpm exec turbo run lint`.

**Turbo caches test results and replays the old passing log on a hit**, which reads exactly
like a fresh pass. Before trusting a green suite as evidence, run `TURBO_FORCE=true pnpm test`
— `pnpm test -- --force` does not work, the flag reaches vitest instead — or read the
`cache hit` / `cache miss` lines. CI always misses, so otherwise it sees the truth first.

**An interrupted Playwright run leaves its Chrome processes behind too.** Twenty-two of them made the browser suite take 36 minutes instead of 17 and fail two timing-sensitive tests — a different two each run, which is the tell. `tasklist //FI "IMAGENAME eq chrome.exe"` before believing a browser failure here; the same suite passed 59/59 once they were killed. And **`--grep` is not a way to reproduce one `mis.spec.ts` failure**: that file is serial and its later tests are built by its earlier ones, so an isolated run fails for setup reasons on any commit, proving nothing.

**A Testcontainers run whose reaper died leaves an orphaned `postgres:17-alpine` container behind**, and one of those burning a third of the CPU made the browser suite fail in three unrelated places and a 24-second setup time out at five minutes (ADR 0054). Check `docker ps` for one before believing any timing taken here.

A fully uncached run at `--concurrency=3` can still exhaust Docker Desktop on this machine
(`Health check not healthy after 120000ms` from Testcontainers). That is the laptop, not
the code: CI runs the same suite uncached on native Docker in under two minutes. For a
trustworthy local full run use `TURBO_FORCE=true pnpm exec turbo run test --concurrency=1`,
or verify the packages you touched individually and let CI be the arbiter. Ten packages each start a Postgres through Testcontainers, so the root script
caps turbo at `--concurrency=3`. A `Hook timed out in 180000ms` in a random package means
that cap is too high for the machine, not that the test is slow.

**When CI fails, read the log before theorising.** Job names and step timings are not
evidence: a green-looking 30-second failure turned out to be every test passing and the
run dying on an unhandled `pg` idle-client error at teardown (ADR 0027). Logs need a token
with Actions:read — ask for one rather than guessing.

Local stack: `npx supabase start -x storage-api,imgproxy,realtime` (storage is unused until
Phase 6 and its container fails a health check on first boot here). Apply new migrations with `npx supabase migration up`.
Web E2E: `pnpm --filter @magicmis/web build && pnpm --filter @magicmis/web e2e`.
Admin E2E (needs `apps/admin/.env.local`, see `.env.example`; `APP_ENVIRONMENT=development`):
`pnpm --filter @magicmis/admin build && pnpm --filter @magicmis/admin e2e`. Stop any stray
server on ports 3000/3001 first — Playwright reuses an existing server, **and a reused one
brings its own environment**. A server started by hand without `KEY_WRAPPER=local` reaches for
AWS KMS on every `generateDataKey`, so every upload and every run fails; the suite then reads as
three scattered product failures rather than one misconfigured server. Start a local one the way
`apps/web/playwright.config.ts` does — `DATABASE_POOL_MAX=12 KEY_WRAPPER=local
LOCAL_MASTER_KEY=<base64 of 0123456789abcdef0123456789abcdef> OUTPUT_STORE=local
AI_TRANSPORT=fake pnpm --filter @magicmis/web start` — and read the server's own log before
believing a browser failure.

To look at a change rather than read it: `apps/web/e2e/support/seed-company.ts` takes a funded
account all the way to a working board through the UI (thirteen months, a real run, about two
minutes), and `shot-demo.ts` screenshots the workspace and Present from it.
Fixtures: `pnpm --filter @magicmis/fixtures generate` (and `generate:large`) write `fixtures/out`;
web E2E global setup generates them if missing and clears the local sign-up throttle (10/hour per IP).
Worker locally: `pnpm --filter @magicmis/worker start` (runs with `--conditions=react-server`).
Testcontainers connects over `127.0.0.1`: Docker Desktop's IPv6 forwarder drops burst connections.
Git commits here need `-c user.name=Dwahnil -c user.email=dwahnilbaria19@gmail.com`.

### Phase 0 record

`docs/SPEC.md` is **complete, Sections 0–35.**

Phase 0 scope (§34): monorepo · ADR template · CI (lint, typecheck, unit tests) · env
validation · Supabase local · migrations for all 35 tables in §9 · RLS baseline +
cross-tenant harness · audit log with hash chain · config tables · design tokens and
base UI components.
**Acceptance:** CI green · RLS harness proves isolation on seeded data · audit chain
verification passes.

Progress — all seven tasks done:

| Task | State |
|---|---|
| Bootstrap (spec, CLAUDE.md, git, `.claude/`, ADR template, REVIEW_ITEMS) | done |
| 1. Monorepo + toolchain (pnpm, strict TS, ESLint, Prettier, Turborepo) | done |
| 2. `packages/core` — money, time, format, identifiers, hashchain, config | done · 140 tests |
| 3. `packages/db` — 11 migrations / 35 tables, RLS, constraints | done · 49 tests |
| 4. Audit log hash chain (writer + paged verifier) | done |
| 5. RLS baseline + cross-tenant harness | done · 16 of the 49 |
| 6. CI (GitHub Actions) | written; not yet run on a runner (no git remote) |
| 7. `packages/ui` — design tokens + numeric presentation | done · 15 tests |

**204 tests, lint and typecheck green.** Summary and ADRs: [docs/plans/phase-0.md](docs/plans/phase-0.md), [docs/adr/](docs/adr/).

Environment notes for a future session:

- `corepack enable pnpm` fails here with EPERM writing to `C:\Program Files\nodejs`.
  pnpm 12.3.4 is installed via `npm i -g pnpm` into the existing user-writable prefix.
- Docker Desktop is a **per-user** install at
  `%LOCALAPPDATA%\Programs\DockerDesktop`, not `Program Files`. A shell started before
  the install has a stale PATH; `packages/db/test/setup-docker-path.ts` repairs it for
  the test worker so Testcontainers can spawn the Docker credential helper.
- Pre-pull `postgres:17-alpine` and `testcontainers/ryuk:0.14.0` if a registry pull
  fails through Docker Desktop's built-in proxy.

### The ten phases (§34)

The product owner waived the stop-for-review gate between phases on 2026-09-13 ("build
everything now"). Plans, summaries and ADRs are still written per phase.

| #   | Phase                                         | State       |
| --- | --------------------------------------------- | ----------- |
| 0   | Foundations                                   | complete |
| 1   | Accounts and security                         | complete (275 tests incl. 5 E2E) |
| 2   | Wallet, pricing, payments, GST                | complete (374 tests + 10 E2E) |
| 3   | Ingestion, Tally, redaction, fixtures         | complete (578 fixtures to ground truth; 50 MB in ~17 s) |
| 4   | AI layer and margin controls                  | complete (49 ai tests; no prompt activated until live evals, R-28) |
| 5   | Semantic layer, mapping, engine, validation   | complete (42 monthly TBs to the paisa; V1–V10 proven) |
| 6   | Jobs, Excel output, lifecycle                 | complete (setup→refresh with zero AI calls, UI E2E; §23 charges; V11) |
| 7   | Dashboard, commentary, reference MIS recreate | complete (V12 post-check; batch commentary; recreated MIS verified by HyperFormula + UI E2E) |
| 8   | Chat                                          | complete (guard corpus + fuzz; server round cap; charged declines; lineage; UI E2E) |
| 9   | Admin console, compliance surfaces, hardening | complete (814 tests + 29 E2E; margin flag E2E; purge shreds every key; cross-tenant, CSP, injection, scrubbing suites; security audit fixed) |

Update this section as each phase completes.

### Definition of done for the whole build (§35)

Every locked decision in §2 enforced in code **and** covered by an automated test · no
path delivering analysis, mapping results, findings or outputs without a captured or
held charge · no path for a browser to send an arbitrary prompt to Anthropic · every
number traceable to a metric ID or query result with lineage · **monthly refresh on
unchanged structure makes zero AI calls** · margin dashboard shows AI cost ratio per
action and flags any over `max_ai_cost_ratio` · all `TODO(review)` items listed in
[docs/REVIEW_ITEMS.md](docs/REVIEW_ITEMS.md) · spec, CLAUDE.md, ADRs, runbooks and help
content current.

---

## The ten working rules (Section 0)

1. Spec lives in `docs/SPEC.md`, verbatim. `CLAUDE.md` holds locked decisions,
   conventions and the current phase, and stays updated as phases complete.
2. **Build in phases, per Section 34.** Write `docs/plans/phase-N.md` at the start of
   each phase; write a summary + ADRs in `docs/adr/NNNN-title.md` at the end, then
   **stop and wait for review.**
3. **Locked decisions are not negotiable.** On conflict, stop and ask. Never silently
   work around one.
4. **Verify every external fact against official docs before implementing it** —
   Anthropic API (params, model IDs, prices, effort, structured outputs, prompt
   caching, batch, token counting), Supabase, Razorpay, SheetJS, DuckDB-WASM,
   ExcelJS, ECharts, Indian GST rules. **Record the doc URL in the ADR. Never guess
   an API shape.** Anthropic docs: https://docs.claude.com/en/api/overview ·
   site map: https://docs.claude.com/en/docs_site_map.md
5. **Never hardcode business numbers.** Prices, packs, tier multipliers, margin
   ratios, limits, retention periods, tax rates, FX rates → config tables/files,
   admin-editable. Spec seed values are illustrative only.
6. Anything the spec calls a placeholder (legal text, TallyPrime menu paths, SAC
   code, final prices) gets a `TODO(review)` marker and is listed in the phase summary.
7. **Tests are part of the work.** A phase is not complete while any test, typecheck
   or lint fails.
8. **No real client data, no secrets, ever committed.** All fixtures synthetic, made
   by scripts in `fixtures/generator`.
9. Small, conventional commits.
10. **Boring dependencies.** Every new dependency gets one line of justification in
    the phase summary.

---

## Locked decisions (Section 2) — not negotiable

1. **Standalone product.** Own brand, infra, Anthropic account, payment gateway
   account, database. No shared code or identity with any other product.
2. **One login per account.** No team members, invitations, roles, organisations,
   sub-users or shared access of any kind. One active session — a new login
   terminates the previous one.
3. **Nothing is free.** No free tier, trial, free generation, free sample on user
   data, or free preview of analysis. **Amended by ADR 0040: the price book is free to
   read but no longer public** — it lives at `/wallet/prices`, one link from the Wallet (ADR 0050); `/pricing` publishes the
   credit packs, which Razorpay requires to be visible and in INR before it activates an
   account. Before a paid action the UI may show **only**
   file names, sizes, sheet counts, row counts. Sheet recognition, mapping results,
   data-quality findings and all outputs appear **only inside a paid action**.
   Uncharged: account creation, buying credits, viewing the price book, help docs,
   public marketing samples on fictional data.
4. **Prepaid credits only.** 1 credit = ₹1 ex-GST. No postpaid, no negative balance,
   no credit lines. **Credits never expire** (ADR 0040): lots are consumed oldest first
   by `created_at`, and there is no validity period, sweeper or expiry notice.
5. **A standard credit price per action** from a configurable price book — called "standard", never "fixed", in anything a customer reads, because decision 6 quotes a job that needs more (ADR 0041). Users never see
   tokens, model names or AI cost — the chat's tier chooser shows the **credits** a
   message will cost, never tokens (ADR 0040). Tier multipliers apply.
6. **Margin guardrail.** Every action has `max_ai_cost_ratio` (default 0.20). Estimate
   over cap → user must accept a quote first. Runtime cap hit → job **pauses**. It
   never silently overspends.
7. **Claude never outputs numbers.** Every figure in every output, commentary and chat
   answer is computed by the deterministic engine and inserted via placeholders. A formula
   the chat adds to a dashboard is data the engine evaluates; its constants are the
   customer's or structural, never the model's (ADR 0046).
8. **Amended by ADR 0032: files are uploaded and processed on the server.** Each chunk is
   sealed under the company's data key before storage. **Amended again by ADR 0047:
   uploads are kept until their owner deletes them** (`sources.retention_days` = 0; an
   operator may still set a period), every decryption is recorded where the owner sees
   it, and the owner can download or delete any file. Anthropic still receives only what action-specific server code sends —
   redacted structure, capped redacted samples, redacted ledger names, chat query
   results — never a whole file. Before payment only names, sizes, sheet and row counts
   are shown.
9. **Anthropic API key is server-side only.** Action-specific endpoints only — never a
   generic prompt passthrough. The browser cannot choose prompts, models or token
   limits.
10. **Intelligence tiers, not model names:** Efficient, Professional, Expert. Expert+
    (highest model) is admin-issued quote only, disabled by default.
11. **Chat with the MIS costs credits per message.**
12. **Recurring costs.** Every monthly refresh consumes credits; each active company
    also incurs a monthly company memory fee.
13. **Desktop only.** Latest Chrome, Edge, Firefox. Mobile browsers get a message.
14. **Indian context, sold worldwide** (ADR 0030). **India bills in INR with GST;
    everywhere else bills in USD as a zero-rated export of services (IGST Act §16).**
    Credits have no currency — only their purchase does. FY April–March default
    (per-company configurable) · lakhs/crores formatting (absolute and millions options) ·
    **store UTC, display IST** · **dates parsed day-first, never month-first.**

**Prices are set per currency, never converted.** There is no exchange rate on any
customer-facing amount; `ai.fx` converts vendor cost for margin reporting only.

**Business priority: gross margin is the single most important property of this
product.** Every design choice affecting cost or pricing must protect it.

**Nearly every index leads with `account_id` or `company_id`, because that is what a customer reads by. The reports do not** (ADR 0059): the money figures, the monthly accounting exports and the worker sweeps read **across every account** by time or by state, and each needs an index of its own — migration 0057 adds six, including a partial one on `audit_log` for the admin lockout counter, which runs on every sign-in attempt against the biggest append-only table there is. Before adding a seventh, check whether the predicate's leading column already has one; `packages/db/test/report-indexes.test.ts` plans each read with `enable_seqscan = off`, which is the only way to ask whether an index *fits* a query on a table too small for the planner to care. **Idempotency is correctness, not speed** — it is what stops a retry charging twice, and it costs a little performance rather than buying any. Sixteen mutating routes take no `Idempotency-Key` and fifteen are right not to (an auth retry is meant to be a fresh attempt, the webhook dedupes by the gateway's event id, a chunk write is naturally idempotent, the run route is guarded by its state machine); anything that **creates a row** needs one.

**A refund is a second fact beside the sale** (ADR 0058): `purchases` carries `refunded_minor`, `refunded_at` and `refund_ids`, and the sale **keeps its status** — marking it 'refunded' took it out of the month it was sold in while its tax invoice stayed in that month's GST summary. Refunds are de-duplicated by **the refund's own id**, never by the event: one refund arrives as `refund.created`, `refund.processed` and `refund.speed_changed`. **A credit note is a real document** (`issueCreditNote`, series `CRN`, migration 0056): same gapless counter, every particular copied from the invoice it corrects, amounts the reduction with tax split in the sale's own proportion, several per purchase allowed, and reported as its own rows in `gst_summary` because GSTR-1 wants them apart. Credits are still never reversed. **The LUT is read by financial year** (`lut_by_fy`), because RFD-11 is filed once a year and last year's ARN does not cover this year's supply.

**The auth throttle counts the attempt, not the failure** (ADR 0058). `claimAttempt` counts and decides in one locked decision before the attempt is made — reading first and counting after let two hundred parallel sign-ins all see zero. Because a success counts too, `releaseAttempt` gives the attempt back: the person's own key is cleared, the network's key only gets the one attempt back, since clearing that let anyone with one valid account zero the bucket for every other account behind the same address.

**`chat_edit` is told which splits the company's books make** and refuses a box that breaks a figure down by anything else, judged only on what the change brings in (ADR 0058). Prompt v3 tells the model, so the refusal is the backstop rather than the usual path.

**An invoice is built from the sale, never from the account row** (ADR 0057). `purchases` snapshots `buyer_country` and `buyer_gstin` beside the currency and the place of supply, and two check constraints hold currency to country and keep a GSTIN off an export — because reading the country live let a customer who corrected their address after paying make it disagree with the place of supply, and the invoice's own constraint then refused the insert **inside the transaction that grants the credits**: money taken, credits rolled back, every retry the same. For the same reason a GSTIN is refused unless its leading two digits name an **assigned** GST state: the checksum does not test them, and `stateName` throws in that same transaction. **A refunded purchase is never credited afterwards** — events arrive out of order, and crediting one left the customer holding the money and the credits.

**`/auth/callback` accepts `type=signup` and nothing else** (ADR 0057). It establishes a session and claims it, so anything it accepts is a link that signs its holder in; a reset token must never be one, and while `recovery` was accepted a link sent to a victim signed them into the attacker's account. `confirmation.html` is the only template that points there. **The Supabase auth cookies are `httpOnly`** through `authCookieOptions`: there is no browser Supabase client anywhere in the tree, so nothing needs to read them, and `authenticated` can read the tenant's rows from PostgREST with a stolen refresh token.

**Nothing reaches Anthropic without the redactor, including a failure** (ADR 0057). A DuckDB error quotes the value that broke the query and is replayed in the next round; `assertNoRawIdentifiers` now runs on **every** step outcome, not only the `ok` branch. The `dashboard_layout` stage sends **how many** values a split takes, never the values: a designation column holds whatever the payroll export put there.

**A delivered job must capture, or it is not delivered** (ADR 0057). `capture(..., required)` throws when a delivery's hold has gone and nothing was captured, a customer cannot cancel a job that is `rendering`, and `/api/outputs/:id` refuses an output whose job is not `completed` — a cancel landing while the workbook was being written used to release the hold and leave the workbook downloadable. **A data fault is charged**: `fail()` in the run defaulted to `platform_fault` at every call site, so files with no balances released the whole hold after a real classification call — free AI, repeatable. **The same file may be listed once**: the ownership check counted distinct ids, and a repeated one doubled every figure in the MIS with all three validation checks still green. **Settlement prices are read as at `job.created_at`**, not at settlement.

**`/wallet/prices` publishes the `instant` price**, because ADR 0050 made it the only delivery and the button charges it; publishing the standard price put commentary on the page at 373 and charged 422 (ADR 0057).

**Never open sealed values in a loop.** `openForCompany` is a transaction, a `for update` lock on the company's key row and a KMS unwrap, every call. Use `openManyForCompany` (ADR 0057) — the rule `latestMetricStores` already follows for snapshots. A chat thread's messages, the model's history, a message's query steps and a file's chunks all go through it.

**"Where to act" is commentary's opposite half** (ADR 0062): commentary describes the month and its prompt forbids advice in as many words; this says what to do about it, as its own `board_actions` job at its own price. Both read **the same facts pack** (`factsPackFor`), which is what makes locked decision 7 hold — every figure is a placeholder the engine fills, checked by the same `checkPlaceholderTexts` over every field the model wrote, including the summary and each heading. An action must carry a step; an observation with none is commentary. Urgency is `now` / `this_quarter` / `watch`, three words rather than a score the model would have invented. The prompt and the panel both say these are suggestions to consider, **not tax, legal or audit advice** — for a product sold to CA firms that sentence is not decoration. Like every other stage it has **no active prompt version** until its evals run (R-28), and until then the button fails the job as a platform fault and releases the hold in full. **The button is on the board, not in the chat** (ADR 0063): `DashboardClient` renders it in the header on the month the board is showing, and hands the request to the assistant through `runAction` — the same shape Investigate uses — so there is one implementation of the quote, the short wallet and the error. It is the row's only filled button and a size up, with Present demoted to secondary to pay for it; the weight is the accent, the size, `font-semibold` and `.lift`, never a gradient or a glow.

**The month picker is an anchor, not a filter, and reading the board is not changing it** (ADR 0064). Every box carries its own window and resolves it against that anchor in `periodsFor`: `current`, `fy_to_date` from the company's own year start, or `last_n`. **Range** and **Compare** beside the picker apply a `BoardLens` at render over values the engine already computed — **no AI call, no charge, and nothing written**, so a reload returns the board its owner saved; both start at "As saved". The rule that makes one global control safe is that **the range reaches only a box whose own window is multi-month**: a card, a waterfall and a comparison state one month by construction, and revenue for five months is not a figure anyone asked for — which is also why a tickbox of arbitrary months was refused, since it forces a sum-or-average question with no good answer, once per box kind. The lens offers only shapes `widgetSchema` already allows, so a board read through it is one that could have been saved. Asking for a box to be **kept** that way is still a priced, versioned dashboard change (ADR 0045, ADR 0046). A chart legend is `type: "scroll"`, one row with pages, because the grid reserves a fixed 26px and a wrapping legend grew into the axis labels as soon as a reader put last year beside three metrics.

**The add-company form is always open** on `/app`, whether or not the account already has companies (ADR 0061). `first` changes the badge wording only, never whether the form is there, and there is no collapsed button to click through any more. Its third step no longer names the workbook — but **the workbook itself is untouched**: a run still produces one and it is still downloadable from Files and settings (ADR 0046), and the public site still sells it.

**A company keeps its own reporting conventions for good** — `currency`, `fy_start_month`, `number_format` and `date_order` on the companies row, written at creation and changed only by the owner through `PATCH /api/companies/:id` (ADR 0035). **No run path writes them**, so a monthly refresh cannot move them. The currency and the number format reach Anthropic, because the facts a stage is given are already formatted through `ReportingContext`; the financial-year start and the date order deliberately do **not** — the model asks for `fy_to_date` and the engine resolves it from the company's own start month, and dates are parsed day-first always (locked decision 14), so the date order is a display choice only.

**A company's first dashboard is chosen for it** by the `dashboard_layout` stage from the metrics it actually holds (ADR 0056), because the books say what the business is. It runs **only where there is no dashboard yet**, so a monthly refresh still makes no AI call; anything that stops it — no active prompt, routing, the cost cap — keeps `DEFAULT_DASHBOARD` rather than failing the run or quoting for a layout nobody asked for; and the model may name only metrics that company holds, with **no digit allowed in a title**, since no request here could have typed one. A `breakdown` box shows one bar per value of its dimension, and every box takes an optional `sort` and `limit` (both null by default, so a board saved before them still reads, and an age bucket keeps its own order). Sorting by value compares the stored strings as integers, never as floats.

**A limit the output is judged by belongs in the system prompt, and nowhere else works** (ADR
0066). `summary` had a 300-character cap in the schema and in no prompt, so the model was
marked against a number nobody gave it: `board_actions` expert overran on **54 of 54** first
attempts and `dashboard_layout` expert on 46 of 46, and the single repair round hid it by
quietly making every call two — a margin leak, not just a score. **Stating it in `stable()`
changed nothing** (32 of 54 against 33 before): `stable()` is wrapped in `<data>` tags, and
every system prompt here tells the model that what is inside them is data and **never an
instruction** — a rule that is load-bearing against injection and is not to be softened. So the
lengths live in the prompt, which means a new prompt version, and
`packages/ai/test/prompt-limits.test.ts` asserts every number in each stage's `LIMITS` appears
in the prompt that asks for it, because a versioned `.md` cannot read a constant. The
box-title limit is `WIDGET_TITLE_MAX`, exported from `render-dashboard` rather than copied.
**A field nobody reads must not be able to fail a response**: `dashboard_layout.summary` is
discarded by `firstDashboardSpec`, and at 300 it threw away 36 of 57 boards over a string with
no reader, so its cap is 1000 and is a payload guard, not a brief. An **absent or null
`drilldown` is lineage**, and an **absent `dimension` is null**, so both default like the
`compare`, `sort` and `limit` beside them — the efficient tier wrote `drilldown: null` on 343
of 432 boxes and lost whole boards over the one value that could not have been anything else.
**Do not move a threshold or a dataset to make a score pass**: `dashboard_layout` efficient
reached 0.947 against 0.95, and both the obvious rescues — trimming the dataset's
over-representation of absent percentages, or dropping the bar to 0.94, which four items in
fifty-seven would clear — are choosing the answer first. Migration 0063 moves the **model**
instead (efficient to Sonnet, as 0061 did for `chat_edit`), which is affordable only because
`dashboard_layout` runs **once per company, ever** and so never touches the recurring-refresh
zero. **The eval recordings are the evidence and
reading them is free**: replay what the model actually returned, matched to its item by
rebuilding the recording key (`sha256(model + "\n" + first user message)`) — that habit found
this, the `chat_edit` labels and the `commentary` check ids, all of which looked like model
failures and were ours. Only the **first** attempt is recorded (`messages.length === 1`), so a
recording shows what the model does before the repair round hides it.

**The owner's business page is `/business` in the admin console** (ADR 0055), behind the console's own gate — separate app and domain, password with TOTP in one step, email allowlist re-checked every request, optional IP pin — never behind a secret URL, which is not a second factor and cannot be revoked. It reports **cash collected and revenue earned separately**, because a prepaid customer pays once and spends over months, and it **never claims an MRR**: the memory fee is contracted and is shown apart from the consumption run rate, which has the fee removed so the two cannot double count. Activation means a completed setup, not a signup. Add a metric in `apps/admin/src/server/business.ts`, not on the page. **The page reads as a report, not a debug view** (ADR 0065): figures are Inter's tabular numerals and never `font-mono`; bars are `accent-200` with the last period in `accent-600`, never the navigation `ink`, which must not sit under a figure; **a one-point series renders as a sentence rather than a lone slab**, because early in a product's life that is the usual case; and each band states the question it answers with exactly one `lead` `Stat` answering it — Accounts, Companies, **Revenue recognised** rather than cash collected, Consumption run rate, Share of revenue. A `Delta` under a trend is derived from the series the chart draws, so the sentence cannot disagree with the picture.

**A later price-book version may not come into force before an earlier one** — migration 0052 refuses it, which is what makes ordering by version and ordering by date the same answer, so neither needs changing (ADR 0054). **Metric values for many periods are read with `latestMetricStores`**, one query and one key unwrap, never `latestSnapshot` in a loop: that decrypted each month's ledger balances only to throw them away. **A refund is recorded, never acted on** — credits are non-refundable, reversing a grant could drive a balance negative, and spent credits cannot be recovered. **The connection pool is 5 per instance** because every warm serverless instance holds its own; `DATABASE_POOL_MAX` raises it for anything that is not one-request-at-a-time — the worker, and the single Node server behind local development and the E2E run. **Function memory is a Vercel dashboard setting**, not `vercel.json`, while Fluid compute is on ([runbook](docs/runbooks/deployment-limits.md)).

**An instant surcharge cannot be folded into a base price (ADR 0053):** `computePrice` is `round(base × tier_multiplier + surcharge)`, so the surcharge is deliberately outside the multiplier and moving it inside changes every tier but professional — migration 0048 did that and raised expert commentary 17% before 0049 put it back. **`delivery` is chosen by the server, never the browser**, because it is a price input. **A paused run is never cancelled on a short wallet**: cancelling captures the cancel-after-AI fee and destroys the checkpoint, so only a job that has not started is cancelled. **Unrecognised sheets are redacted as though they hold people** (`sheetKind: "payroll"` plus `isPartyColumn`), because the privacy notice promises party and employee names are tokenised before anything reaches the model. **A chunk must fit the size the upload declared**, which is what the per-company cap is measured against.

**What the margin is made of (ADR 0052), and how to keep the report honest:** a credit sells
for ₹0.87 to ₹1.00 after the pack bonus, and 4% to 38% more per credit in dollars with no GST
to remit. AI is capped at `max_ai_cost_ratio` per action (20%) but runs at 2% to 5%, and a
monthly refresh on unchanged structure makes **no AI calls at all** — that zero is the
recurring margin, so never let a change introduce an AI call into an unchanged refresh.
**The gateway fee is charged on money received, never on credits spent**: `marginReport` sums
settled `purchases` by method and currency, because bonus credits carry no money, a pack is
spent across later months, and a bank transfer pays no fee. Fees are per currency in
`admin.payment_fee_percent_by_currency`, infra cost per day is real and non-zero, and both are
estimates until R-67/R-68 close. **Kept files are not priced into credits**: they sit in object
storage at about two cents per gigabyte per month, the memory fee covers them many times over,
and keeping a file changes nothing about what the AI reads.

---

## Engineering conventions (Section 4)

- **TypeScript `strict` everywhere.** Zod schemas at _every_ boundary: HTTP, database
  JSON columns, AI inputs and outputs, file parsing results, config.
- **Header-based parsing only.** Never rely on column positions.
- **Time:** stored UTC, displayed IST.
- **Money and quantities:**
  - INR → **integer paise**
  - Credits → **integers**
  - AI cost → **integer micro-USD**, plus the INR equivalent at the FX rate in effect
  - **Never use JS floating point for money**
  - In DuckDB use `DECIMAL(38,4)` or integer paise
- **Idempotency on every mutating operation.** API endpoints take `Idempotency-Key`;
  webhooks de-duplicated by event ID; file imports keyed by content fingerprint.
- **Soft-delete everywhere** (`deleted_at`) + scheduled purge jobs. Purge of encrypted
  company data = **crypto-shredding**: destroy the company's data key.
- **Append-only, hash-chained audit log** (`prev_hash`, `hash`) for auth events, wallet
  mutations, pricing/config changes, admin actions, deletions, consent records. The
  credit ledger is hash-chained too.
- **Environment variables validated at boot with Zod.** The app refuses to start on
  invalid config.
- **Business config lives in the database** with versioning and `effective_from`. Every
  config change is written to the audit log.
- **Tests:** all business rules get unit tests; money and ledger logic gets **property
  tests**.

---

## Trust boundaries (Section 7) — the rule that shapes the codebase

| Zone               | What it is                                | What it may hold                                                                           |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| **A — Browser**    | Untrusted client                          | Uploads files in chunks, shows counts and results, downloads the workbook; holds no data (ADR 0032) |
| **B — Our server** | Trusted (Next.js route handlers + worker) | Auth, wallet, pricing, quotes, job state, AI orchestrator, blueprints, snapshots, billing  |
| **C — Anthropic**  | Vendor                                    | Only what an action-specific server function sends                                         |

Enforced:

- No endpoint accepts free-text prompts to forward to Claude. The only free-text AI
  input is a chat message, wrapped in the chat system prompt with scope restrictions.
- Every AI endpoint has a Zod schema and a per-action max payload size. Oversize →
  clear error.
- Model, effort and `max_tokens` are chosen **server-side** from tier routing config.
- The server computes charges **only** from Anthropic usage data it receives directly —
  never from figures reported by the browser.

---

## Stack (Section 5)

Next.js (latest stable, App Router, TS) · Tailwind + shadcn/ui · TanStack Query +
Zustand · Supabase (Postgres, Auth — password only for customers, TOTP for admins; Storage, RLS; India/Mumbai region if
available) · Vercel (functions pinned nearest India) · `pg-boss` worker on a container
host · `@anthropic-ai/sdk` (server/worker only) · SheetJS (**official distribution, not
the stale npm registry version**) · DuckDB-WASM · Comlink · OPFS · ExcelJS · Apache
ECharts · HyperFormula (tests) · Razorpay · Resend (ADR 0010) · AES-256-GCM
envelope encryption w/ KMS master key · Vitest + fast-check + Playwright +
Testcontainers · Sentry (PII scrubbing) + pino · pnpm workspaces (+ Turborepo if useful)

Deviating from any default requires documentation showing it cannot meet a requirement,
recorded in an ADR.

---

## Out of scope (Section 3) — do not build

multi-user/teams/roles · client portals or share links · free tier or trial · Tally
desktop connector · scheduled refreshes without a user upload · Zoho/QuickBooks/Busy/
SAP/Google Sheets integrations · mobile apps or layouts · multi-currency · forecasting ·
multi-entity consolidation · Improve/Redesign modes for reference MIS (Recreate only) ·
PDF board pack · Data Vault · budget module · industry KPI packs

**But build for extension:** connectors implement an ingestion interface; templates and
dashboard specs are data; the chat engine can later query stored data.

---

## Repository layout (Section 6)

```
/apps        web (Next.js customer app + API) · admin (separate auth + domain) · worker (pg-boss)
/packages    core · db · wallet · billing · ai · ingest · tally · redact · semantic ·
             engine · templates · render-excel · render-dashboard · chat · ui
/fixtures    generator — synthetic companies + Tally-style exports with ground truth
/docs        SPEC.md · adr/ · plans/ · runbooks/ · help/
```

---

## Toolchain notes (this machine)

- Node **v22.18.0**, npm 10.9.3, pnpm 12.3.4 (see the environment notes under
  "Current phase" for why corepack is not used).
- Windows 11. Shell is PowerShell; a Git Bash is also available. Large heredocs fail
  under Git Bash here — write files with the editor tools, not `cat <<EOF`.
