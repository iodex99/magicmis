# Plan — remove friction from every path a first-time user takes

**Trigger:** the product owner, 2026-09-15: the product must be usable by someone who has
never seen it, with every unnecessary step removed — "design, flow, UI, everything".

## The honest count

Here is what a new customer does today between arriving and holding their first workbook.
Every line is a thing they must decide, type or click.

| # | Step | Friction |
|---|---|---|
| 1 | `/sign-up`: email, password, business name, GSTIN, address line 1, line 2, city, PIN, state, accept Terms, accept Privacy | **11 fields before seeing anything.** Nine of them exist to print a tax invoice they have not yet asked for. |
| 2 | "Check your email" | — |
| 3 | Click the link → lands on `/sign-in/verified` | **A dead end.** The link already signed them in; we then show a page whose only content is "now go and sign in". |
| 4 | `/sign-in`: type email and password **again** | **Pure waste.** They have a session. |
| 5 | `/sign-in/enrol`: scan QR, type code | Required (SPEC §8). Keep. |
| 6 | Backup codes: read, copy, tick, continue | Required. Keep. |
| 7 | `/app` — empty. No companies, no credits, no files. | **No idea what to do next.** |
| 8 | Work out that credits must be bought → `/wallet` → pick one of six packs with no guidance | **An unguided decision** about a number they cannot yet reason about. |
| 9 | Add a company | — |
| 10 | `/run`: choose files | — |
| 11 | Choose "Intelligence tier" | **A decision a newcomer cannot make.** |
| 12 | Choose "Delivery" | Same. |
| 13 | Click **Get price** | **A step that exists for no reason.** The price is knowable the moment the files are in. |
| 14 | A different screen appears; read it; click **Confirm** | The confirmation is required (SPEC §12). The *separate screen* is not. |
| 15 | Mapping review: a 9-column grid of 42 rows | **Intimidating.** The 38 rows that are already right are shown with the same weight as the 4 that need a look. |
| 16 | Confirm mappings → workbook | — |

**Sixteen steps. Eleven fields. Three decisions nobody can make on day one.**

## What is locked and stays

- Nothing is free (§2.3), prepaid credits only (§2.4), a fixed price **confirmed before
  every paid action** (§2.5, §12).
- 2FA on every account, no exceptions (§8).
- One login per account (§2.2).
- Before a paid action the UI shows only file names, sizes, sheet and row counts (§2.3).

None of those is friction for its own sake, and none of them is going. Everything else is
fair game.

## The work

### 1. Sign-up asks for four things (steps 1)

Email, password, business name, one consent tick. **Billing address and GSTIN move to the
first purchase**, which is where GST place of supply is actually needed and where the
customer is already thinking about invoices. Migration `0034` makes `accounts.state_code`
nullable; `signupProfileSchema` makes the address optional.

One checkbox covers both Terms and Privacy notice, each linked. Two consent rows are still
written, with their own versions — the record is unchanged, the gesture is one. Recorded as
a review item for the legal pass.

### 2. The email link signs you in (steps 3–4 deleted)

`/auth/callback` already establishes a session through `exchangeCodeForSession` /
`verifyOtp`. It now sends a newly verified user straight to `/sign-in/enrol`.
`/sign-in/verified` survives only as the fallback for when no session was established.

### 3. `/app` tells a new account what to do (step 7)

A "Get started" card with three numbered steps — add a company, load your files, run the
first MIS — each showing the action, each ticking off as it completes, the whole card gone
once the account has run a job.

### 4. Credits are bought where they are needed (step 8)

- The price confirmation, when short, names the **smallest pack that covers it** and takes
  the payment inline. No trip to the wallet, no guessing.
- Every pack says what it buys in plain terms: "≈ 8 monthly refreshes".
- One pack is marked recommended.
- Billing details are collected inline at the first purchase, not at sign-up.

### 5. The run is one screen (steps 11–14 → one)

- The price is fetched the moment the files are ready. No "Get price" button.
- Tier and delivery collapse into **Options**, closed by default, with the defaults chosen
  for you and explained in a sentence.
- A summary panel carries the §12 confirmation — action, tier, delivery, price, available
  now, available after — and one button: **Run setup — 999 credits**. That click is the
  confirmation. Nothing is charged before it.

### 6. Mapping review leads with the answer (step 15)

- A headline: "38 of 42 mapped automatically · 4 need a look".
- The grid opens filtered to the rows needing attention.
- When nothing needs attention, the table is collapsed behind "Review all 42" and the
  primary action is simply **Looks right — continue**.

### 7. Copy a newcomer can act on

Every label, hint and empty state re-read for someone who has never built an MIS. Tier
descriptions in one line each. No raw identifiers. No jargon the UI has not defined.

## Constraints held

- Every price is still confirmed before the charge, with balance before and after.
- No free preview of paid analysis anywhere.
- 2FA, one session, prepaid credits unchanged.
- WCAG 2.2 AA; full keyboard operability.
- Tests move only where the flow deliberately moved, and the move is recorded.
