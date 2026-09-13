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
| R-07 | **TallyPrime menu paths** in `docs/help`. §16: do not invent paths that cannot be verified — write structure, mark the path. | Phase 3 | open |
| R-08 | **Tally predefined group lists** (15 primary, 13 sub-groups) verified against Tally documentation before seeding. | Phase 3 | open |
| R-09 | **Model prices, IDs, effort parameter, cache multipliers, batch discount** verified against docs. §14 seed values are explicitly unverified. | Phase 4 | open |
| R-20 | **GSTIN check-character algorithm.** | Phase 2 | **closed** — owner decision 2026-09-13: GSTIN is supplied by the user, and its accuracy is the user's responsibility. No further verification will be pursued. The existing format-and-checksum check stays, since SPEC §8 asks for it and it already reproduces two independent specimens. |
| R-10 | **Terms of service** — prepaid, non-refundable, non-transferable, no cash-out, 12-month validity, memory fee, lifecycle, professional-review disclaimer, acceptable use. §31: placeholder only, no final legal language. | Phase 9 | open |
| R-11 | **Privacy notice** — browser processing, what leaves the browser, Anthropic as subprocessor, retention, DPDP rights, grievance contact. §31: placeholder only. | Phase 9 | open |
| R-12 | **First-upload processing notice** text. §31. | Phase 9 | open |
| R-13 | **GST rate** — seeded at 18% per §13 config default; confirm current rate for this SAC at launch. | Before launch | open |
| R-14 | **FX rate and buffer** — seeded at §13's 3% buffer default; set the operating rate. | Before launch | open |
| R-15 | **Statutory retention period** for financial records — seeded at §10's 8-year default; confirm. | Before launch | open |
| R-21 | **Admin MFA reset recording** — the account-recovery runbook records the reset with a witnessed SQL insert into `audit_log` until the Phase 9 admin console provides the action. | Phase 9 | open |
| R-22 | **Production Supabase Auth settings** must mirror `supabase/config.toml`: email confirmations on, TOTP on, 12-character mixed-case-and-digit passwords, secure password change, Resend SMTP, and the token-hash confirmation template in `supabase/templates/confirmation.html`. | Before launch | open |

## Raised in Phase 2

| # | Item | Needed by | Status |
|---|---|---|---|
| R-23 | **Email wording** for every SPEC §29 notice (`apps/worker/src/templates.ts`). | Before launch | drafted |
| R-24 | **Price book margin-impact preview** (SPEC §26) against the last 30 days of usage — needs `ai_calls`. | Phase 9 | open |
| R-25 | **Unicode font in invoice PDFs** — standard Helvetica replaces non-Latin characters in business names with `?`. | Before launch | open |
| R-26 | **Live Razorpay test-mode run** with real test keys, and the dashboard webhook (events `payment.captured`, `order.paid`, `payment.failed`) pointed at `/api/webhooks/razorpay`. Automated tests use a fake gateway. | Before launch | open |
| R-27 | **Production must set `billing.allow_placeholder_details` to `false`** after R-02/R-03 are filled. | Before launch | open |

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
