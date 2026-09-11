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
| R-01 | **Product name.** Spec says `[PRODUCT_NAME]`; directory is `magicmis`. Note §32 forbids "magic" wording in customer UI, which sits awkwardly with MagicMIS as a brand. Held as a single constant in `packages/core` so it is a one-line change. | Phase 1 (first customer-facing copy) | open |
| R-02 | **Seller legal name, address, GSTIN** for tax invoices (§13). | Phase 2 | open |
| R-03 | **SAC code** for the service. Spec marks this `TODO(review)` explicitly. Needs CA confirmation. | Phase 2 | open |
| R-04 | **Final price book.** §12's table is explicitly illustrative. Seeded as given, admin-editable. Margin dashboard will show whether seed prices hold under `max_ai_cost_ratio`. | Phase 2 seeds; confirm before launch | open |
| R-05 | **Final credit packs and bonus tiers.** §12, same status as R-04. | Phase 2 seeds; confirm before launch | open |
| R-06 | **Invoice template text** — §13 marks it `TODO(review)` for CA verification. | Phase 2 | open |

## Deferred to their phase

| # | Item | Needed by | Status |
|---|---|---|---|
| R-07 | **TallyPrime menu paths** in `docs/help`. §16: do not invent paths that cannot be verified — write structure, mark the path. | Phase 3 | open |
| R-08 | **Tally predefined group lists** (15 primary, 13 sub-groups) verified against Tally documentation before seeding. | Phase 3 | open |
| R-09 | **Model prices, IDs, effort parameter, cache multipliers, batch discount** verified against docs. §14 seed values are explicitly unverified. | Phase 4 | open |
| R-20 | **GSTIN check-character algorithm** verified against official GSTN documentation. Implemented as a mod-36 Luhn-style fold and confirmed against two independent specimen GSTINs plus a generated-check-character property test, but §0.4 forbids relying on an external fact without a doc URL. Tax invoices depend on it, and an invalid GSTIN silently yields no state code — which would misroute CGST/SGST vs IGST. | Phase 2 | open |
| R-10 | **Terms of service** — prepaid, non-refundable, non-transferable, no cash-out, 12-month validity, memory fee, lifecycle, professional-review disclaimer, acceptable use. §31: placeholder only, no final legal language. | Phase 9 | open |
| R-11 | **Privacy notice** — browser processing, what leaves the browser, Anthropic as subprocessor, retention, DPDP rights, grievance contact. §31: placeholder only. | Phase 9 | open |
| R-12 | **First-upload processing notice** text. §31. | Phase 9 | open |
| R-13 | **GST rate** — seeded at 18% per §13 config default; confirm current rate for this SAC at launch. | Before launch | open |
| R-14 | **FX rate and buffer** — seeded at §13's 3% buffer default; set the operating rate. | Before launch | open |
| R-15 | **Statutory retention period** for financial records — seeded at §10's 8-year default; confirm. | Before launch | open |

## Decisions the spec leaves open

| # | Item | Needed by | Status |
|---|---|---|---|
| R-16 | **Email provider** — §5 says Resend or Postmark, record in ADR. Proceeding with Resend unless told otherwise. | Phase 0 | drafted |
| R-17 | **Google / Microsoft sign-in** — §8 says may be offered, decision recorded in ADR. 2FA stays mandatory either way. | Phase 1 | open |
| R-18 | **KMS vs secrets manager** for the master key — §5 prefers a cloud KMS. | Phase 0 | open |
| R-19 | **Supabase region** — §5 says use India (Mumbai) if available; confirm in docs. | Phase 0 | open |

---

*Keep this file current as markers are added and resolved — §35 requires it, and §0.6
requires each phase summary to list the markers that phase raised.*
