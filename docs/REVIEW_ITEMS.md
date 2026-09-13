# Review items

Required by SPEC §35: every `TODO(review)` marker in the codebase is listed here.
SPEC §0.6 designates these as placeholders needing your review — legal text, TallyPrime
menu paths, the SAC code, final prices.

**Status legend:** `open` — needs your input · `drafted` — placeholder in place, needs
your sign-off · `closed` — resolved, with the resolution noted.

---

## Blocking a phase

| # | Item | Needed by | Status |
|---|---|---|---|
| R-01 | **Product name.** Spec says `[PRODUCT_NAME]`; directory is `magicmis`. Note §32 forbids "magic" wording in customer UI, which sits awkwardly with MagicMIS as a brand. Held as a single constant (`packages/core/src/brand.ts`, used by web, admin and email), currently the placeholder "MIS Studio", so the real name is a one-line change. | Before launch | open |
| R-02 | **Seller legal name, address, GSTIN** for tax invoices (§13). Placeholders in `app_config.billing.seller`; invoice issue refuses them once `billing.allow_placeholder_details` is false (R-27). Also confirm whether turnover requires e-invoicing (IRN). | Before launch | drafted |
| R-03 | **SAC code** for the service. Spec marks this `TODO(review)` explicitly. Needs CA confirmation. Placeholder `PENDING-REVIEW` in `billing.sac_code`, guarded as R-02. | Before launch | drafted |
| R-04 | **Final price book.** §12's table is explicitly illustrative. Seeded as given, admin-editable. Margin dashboard will show whether seed prices hold under `max_ai_cost_ratio`. | Phase 2 seeds; confirm before launch | open |
| R-05 | **Final credit packs and bonus tiers.** §12, same status as R-04. | Phase 2 seeds; confirm before launch | open |
| R-06 | **Invoice template text** — §13 marks it `TODO(review)` for CA verification. Drafted in `packages/billing/src/pdf.ts` (layout per Rule 46 particulars) and `words.ts` ("Rupees … and … Paise Only"). | Before launch | drafted |

## Deferred to their phase

| # | Item | Needed by | Status |
|---|---|---|---|
| R-07 | **TallyPrime menu paths** in `docs/help/tally` (one page per report, path marked), and whether real TallyPrime exports match the fixture layouts (`fixtures/generator/src/reports.ts`). §16: do not invent paths that cannot be verified. | Before launch | drafted |
| R-08 | **Tally predefined group lists.** Names, parents and the 9 Balance Sheet / 6 P&L split verified against Tally.ERP 9 help (`packages/tally/src/groups.ts`); the TallyPrime page confirms 15 + 13 but does not list them. Confirm in TallyPrime, and confirm each group's nature and gross-profit flag. | Phase 5 | drafted |
| R-09 | **Model prices, IDs, effort parameter, cache multipliers, batch discount** — verified 2026-09-13 and seeded in migration 0019 (ADR 0019). Still open: tune per-stage effort and `max_tokens` in `tier_routing` from live evals, and re-verify prices before launch (the admin Margin screen flags entries older than `ai.registry_stale_days`). | Before launch | drafted |
| R-20 | **GSTIN check-character algorithm.** | Phase 2 | **closed** — owner decision 2026-09-13: GSTIN is supplied by the user, and its accuracy is the user's responsibility. No further verification will be pursued. The existing format-and-checksum check stays, since SPEC §8 asks for it and it already reproduces two independent specimens. |
| R-10 | **Terms of service** — prepaid, non-refundable, non-transferable, no cash-out, 12-month validity, memory fee, lifecycle, professional-review disclaimer, acceptable use. §31: placeholder only, no final legal language. | Before launch | drafted — structured outline of how the product behaves in `apps/web/src/app/legal/terms/page.tsx`; legal wording still needed |
| R-11 | **Privacy notice** — browser processing, what leaves the browser, Anthropic as subprocessor, retention, DPDP rights, grievance contact. §31: placeholder only. | Before launch | drafted — outline in `apps/web/src/app/legal/privacy/page.tsx`; legal wording, subprocessor regions and grievance officer still needed |
| R-12 | **First-upload processing notice** text. §31. | Before launch | drafted — `apps/web/src/components/ProcessingNotice.tsx`; recorded and enforced server-side (ADR 0024 §4); wording needs legal review |
| R-13 | **GST rate** — seeded at 18% per §13 config default; confirm current rate for this SAC at launch. | Before launch | open |
| R-14 | **FX rate and buffer** — seeded at §13's 3% buffer default; set the operating rate. | Before launch | open |
| R-15 | **Statutory retention period** for financial records — seeded at §10's 8-year default; confirm. | Before launch | open |
| R-21 | **Admin MFA reset recording** — the account-recovery runbook records the reset with a witnessed SQL insert into `audit_log` until the Phase 9 admin console provides the action. | Phase 9 | open |
| R-22 | **Production Supabase Auth settings** must mirror `supabase/config.toml`: email confirmations on, TOTP on, 12-character mixed-case-and-digit passwords, secure password change, Resend SMTP, and the token-hash confirmation template in `supabase/templates/confirmation.html`. | Before launch | open |

## Raised in Phase 2

| # | Item | Needed by | Status |
|---|---|---|---|
| R-23 | **Email wording** for every SPEC §29 notice (`apps/worker/src/templates.ts`). | Before launch | drafted |
| R-24 | **Price book margin-impact preview** (SPEC §26) against the last 30 days of usage — needs `ai_calls`. | Phase 9 | **closed** — `priceImpactPreview` in `@magicmis/ai/margin`, Preview impact on `/price-book` (ADR 0024 §1) |
| R-25 | **Unicode font in invoice PDFs** — standard Helvetica replaces non-Latin characters in business names with `?`. | Before launch | open |
| R-26 | **Live Razorpay test-mode run** with real test keys, and the dashboard webhook (events `payment.captured`, `order.paid`, `payment.failed`) pointed at `/api/webhooks/razorpay`. Automated tests use a fake gateway. | Before launch | open |
| R-27 | **Production must set `billing.allow_placeholder_details` to `false`** after R-02/R-03 are filled. | Before launch | open |
| R-28 | **Live AI evals and prompt activation.** No prompt version is active, so every AI stage refuses. Run `AI_LIVE=1 ANTHROPIC_API_KEY=… DATABASE_URL=… pnpm --filter @magicmis/ai evals -- --stage sheet_classification --tier efficient` (and column_mapping, each tier), commit the recordings, then activate with `activatePromptVersion`. Spends real money on synthetic data only. Thresholds in `ai.eval_thresholds` are placeholders. | Before launch | open |
| R-29 | **Ledger mapping eval dataset** — needs the canonical heads from the semantic layer. | Phase 5 | open |
| R-31 | **Global library promotion queue** (SPEC §18): candidates from ≥ `semantic.library_promotion_min_accounts` distinct accounts, admin approval, person/party-name exclusion. Account rules are encrypted, so candidate counting needs a keyed digest of the normalised name. | Before launch | built — digest-only votes and a nightly candidate refresh (ADR 0024 §5). Review the vocabulary allowlist in `packages/semantic/src/library-eligibility.ts` with a CA |
| R-32 | **Metric conventions for CA review** (ADR 0020): EBITDA excludes other income; DSO/DPO/inventory days on the month's flow and calendar days; Deposits (Asset) shown as non-current; Sales Accounts default to sale of products. | Before launch | open |
| R-33 | **Canonical heads, Schedule III references, abbreviation list and library seed** (`packages/semantic`): references are indicative, not verified against the Companies Act text; fuzzy threshold `0.85` is a seed. | Before launch | drafted |
| R-34 | **HyperFormula licence** (GPL-3.0-only): used only as a test oracle. If in-browser V11 ever needs more than our evaluator's grammar, a commercial licence or another engine is needed. | Only if V11 grows | open |
| R-35 | **Indian number formats in Excel and LibreOffice** (`render-excel/formats.ts`): digit-placeholder lakh/crore codes, bracketed negatives and zero must be opened and checked in both applications (SPEC §24.1 asks for saved-fixture verification). | Before launch | open |
| R-36 | **Lifecycle timings**: first memory-fee debit one month after the setup anchor date; `outputs.retention_days` 365; `lifecycle.deletion_purge_delay_days` 30. | Before launch | open |
| R-30 | **Estimator heuristics** (`ai.estimator` chars per token, inflation, output ratio, p90 multiplier) are unmeasured seeds; replace with values from live evals and let nightly calibration take over. | Before launch | open |

## Raised in Phase 7

| # | Item | Needed by | Status |
|---|---|---|---|
| R-37 | **Commentary digit allowlist** (`commentary.digit_allowlist`, migration 0023): phrases such as "Schedule III" or "Ind AS 115" that may keep their digits in commentary. Confirm the list with the CA reviewer; every entry weakens V12. | Before launch | open |
| R-38 | **Commentary prose review.** The eval scores only the placeholder rule (V12). Before activating `commentary` prompt versions, a CA reads outputs on the synthetic facts packs for tone, neutrality and "insufficient data" behaviour (SPEC §25 style rules). Also covers `reference_layout` live eval accuracy thresholds (R-28). | Before launch | open |
| R-39 | **Reference MIS vocabulary** (`packages/templates/src/catalog.ts`, `packages/ingest/src/reference-layout.ts`): the label synonyms that bind rows without AI, and the header words that set period patterns (e.g. "Var %" as month-on-month %). Wrong synonyms bind silently (the user still reviews every row). | Before launch | drafted |
| R-40 | **Uncharged dashboard layout edits.** Renaming, reordering and removing widgets through UI controls stores a new version without a charge (ADR 0022 §1); chat edits are charged per message. Confirm this with the product owner against SPEC §2.3. | Before launch | open |
| R-42 | **Chat prices vs AI cost** (migration 0024): chat `max_tokens` re-seeded to Quick/Deep round 1,500, Edit 2,000, summary 1,000 so a call fits price × `max_ai_cost_ratio`. A Deep message with five large rounds can still exceed its cap (then it fails without charge). Confirm `chat_deep` price and rounds against live usage. | Before launch | open |
| R-43 | **Abandoned chat messages** (`sweepChatMessages`): a message waiting past its hold (e.g. a Deep question whose tab closed) is released and marked failed; the AI cost already spent is absorbed. Confirm the policy. | Before launch | open |
| R-44 | **`chat_deep` evals.** The eval harness runs structured-output stages only; Deep is a tool loop, so its prompt cannot pass the activation gate until the harness can script browser query results. | Before launch | open |
| R-45 | **Fake AI transport** (`apps/web/src/lib/server/ai.ts`): `AI_TRANSPORT=fake` is refused unless `NEXT_PUBLIC_ENVIRONMENT=development`. Deployment checks must confirm neither is set in production. | Before launch | open |
| R-46 | **SQL guard allowlists and session tables** (`packages/sql-guard`): allowed functions, cast types and the `balances` / `bills` table definitions. Payroll data is not exposed to Deep chat yet. | Before launch | open |
| R-41 | **Reference MIS limits and heuristics**: 20 visible sheets, 400 rows and 60 columns per sheet are read; the label column is the text-densest of the first three, the header row the text-densest of the first 15 with values below. Hidden sheets are skipped and listed. Move limits to config if real workbooks need more. | Before launch | open |

## Raised in Phase 9

| # | Item | Needed by | Status |
|---|---|---|---|
| R-47 | **Gross margin inputs** (migration 0025): `admin.payment_fee_percent` "2.00" and `admin.infra_cost_paise_per_day` 0 are placeholders. Set them from the Razorpay contract and actual hosting invoices, or the margin dashboard overstates gross margin. | Before launch | open |
| R-48 | **Rate limits** (`ratelimit.limits`, per minute): AI 30 and chat 12 per account, export 3 per account, API 600 per IP. Tune from load tests and early usage. | Before launch | open |
| R-49 | **Data export link lifetime** (`privacy.export_link_hours` 72, migration 0026). Other points to confirm against DPDP guidance: the export contents (sign-in history capped at 500 events), and that account deletion forfeits unused credits and is refused while credits are held. | Before launch | open |
| R-51 | **Payment reconciliation job** (docs/runbooks/payment-webhook-outage.md). A purchase paid but not credited after Razorpay's 24-hour webhook retry window currently needs an engineer to re-run the webhook grant path. Build a job that fetches payment status from the Razorpay API for stuck purchases (verify the API shape first). | Before launch | open |
| R-52 | **Tamper-evident audit chain** (ADR 0024 §9). The nightly check detects edits and broken links but not a full rewrite by someone with database owner access. Hashes are unkeyed SHA-256, and `seq`/`created_at` are not hashed. The daily admin email now carries the chain head as an off-database copy. Decide on HMAC with a KMS key, hashing `seq` and `created_at`, and write-once external anchoring. | Before launch | open |
| R-53 | **Break-glass scope** (ADR 0024 §1). A grant covers the whole account, not one company. The customer gets one email at grant time, not a per-view digest. Any single admin can grant it without re-authentication. Confirm, or tighten to per-company grants, admin re-auth and two-person approval. | Before launch | open |
| R-54 | **Secrets in rendered responses.** The CI scan covers `.next/static` only. Props passed from server to client components ship in HTML and RSC payloads. Add an E2E step that fetches rendered pages and scans them with `scripts/scan-client-bundles.mjs` rules. | Before launch | open |
| R-55 | **Hosting assumptions** (ADR 0024 §6). The client IP trusts `x-vercel-forwarded-for`, else the right-most `x-forwarded-for`. HSTS is sent only when the proxy sees `https:`, and `includeSubDomains; preload` should be decided at the apex domain. If the app is not deployed on Vercel, re-check all three. | Before launch | open |
| R-50 | **Processing register** ([docs/compliance/processing-register.md](compliance/processing-register.md)). A data protection professional must review: <ul><li>purposes and legal basis wording;</li><li>subprocessor regions (Anthropic, Resend);</li><li>grievance officer;</li><li>Significant Data Fiduciary assessment.</li></ul> | Before launch | open |

## Decisions the spec leaves open

| # | Item | Needed by | Status |
|---|---|---|---|
| R-16 | **Email provider** — §5 says Resend or Postmark, record in ADR. | Phase 0 | **closed** — Resend, directed by the product owner 2026-09-13 (superseding an interim Postmark choice). See ADR 0010. |
| R-17 | **Google / Microsoft sign-in** — §8 says may be offered, decision recorded in ADR. | Phase 1 | **closed** — not offered in this build; email + password + mandatory TOTP only. Reversible without a schema change. See ADR 0009. |
| R-18 | **KMS vs secrets manager** for the master key — §5 prefers a cloud KMS. | Phase 0 | **closed** — AWS KMS customer-managed key in `ap-south-1`, reached via Vercel OIDC with no long-lived credentials. See ADR 0008. |
| R-19 | **Supabase region** — §5 says use India (Mumbai) if available; confirm in docs. | Phase 0 | **closed** — Mumbai `ap-south-1` ("South Asia (Mumbai)") confirmed available. [Source](https://supabase.com/docs/guides/platform/regions), verified 2026-09-11. See ADR 0003. |

---

*Keep this file current as markers are added and resolved — §35 requires it, and §0.6
requires each phase summary to list the markers that phase raised.*
