# ADR 0033: One company workspace, and no price step before an action

**Status:** accepted · **Date:** 2026-09-17 · **Decided by** the product owner · **Amends** SPEC §12
("Price confirmation UI"), §24–§27 (dashboard, commentary and chat as separate screens) and §32
(navigation)

## Context

After ADR 0032 the owner reviewed the app and asked for four things:

- _"the thing where we show the estimated credit use, let's remove it completely … let the user
  spend."_ Every paid action showed its price and asked for a confirmation first: the run screen
  priced itself, the dashboard and commentary buttons opened a price panel, and the chat send
  button carried the price.
- _"the sections commentary and chats are same … merge it … it shall not be a different tab, it
  shall be a chat window kinda thing beside the actual dashboard, so the user always has a
  reference."_
- _"the add company is a small box, look how the homepage looks."_
- _"what is the thing where you upload files without adding a company, don't need anything like
  that"_ — the **Uploaded files** page in the main navigation read as a place to upload outside a
  company.

## Decision

### 1. No price step

A paid action starts when its button is pressed. `lib/paid-job.ts` creates the job and holds its
credits in one step; there is no price panel, no "Confirm — N credits" button and no price on the
chat send button. What still stops a start, because it must:

- **An estimate over the AI cost cap** still needs its quote accepted first (locked decision 6).
  The quote amount is shown then, and only then.
- **A wallet that cannot cover the action** holds nothing and offers credits (inline on the run
  screen, a wallet link elsewhere).

Charges are unchanged: credits are held on start and captured on delivery, and a failure is not
charged. What was actually charged is still shown after the fact (run result, chat message,
company activity), and the price book stays public at `/pricing`. The public site, pricing page
and terms no longer promise that a price is shown before anything runs; the terms now say that
pressing an action's button is the instruction to run it and charge its price. The terms are still
the unpublished 1.1 draft (R-10), so the version is not bumped.

Locked decision 3 is unaffected: before a paid action the screen still shows only file names,
sizes, sheet counts and row counts.

### 2. One workspace per company

`/app/companies/:id` is the company:

- **Not set up:** the page is the setup — drop the trial balances, press **Build my MIS**. A new
  company lands here straight from the add form. When the run finishes, **Open the dashboard**
  reloads the page into the workspace.
- **Set up:** the dashboard on the left and the **assistant** beside it, sticky, always in view.
  The assistant is one conversation for quick answers, deeper analysis (server queries), layout
  changes and the month's **commentary**; commentary is a mode of the same composer and renders as
  an item in the conversation. **Investigate** on a dashboard card hands its question to the
  assistant instead of opening another page. Lineage for any figure opens in a drawer over the
  right edge, so neither the dashboard nor the conversation is pushed aside. Below the dashboard:
  workbooks, the company's kept files (with delete), activity and charges, and delete company.

The `/dashboard`, `/commentary` and `/chat` routes redirect to the workspace. The company's
navigation is two items: **Dashboard and assistant**, and **Add a month** (`/run`, refresh only; a
company that was never set up is sent to its workspace).

### 3. Adding a company

With no companies, the app home is the add-company screen, laid out like the public homepage hero:
a headline, three steps and a large form card. With companies, the home shows them as cards and a
full-width **Add a company** button opens the same form in place.

### 4. No account-wide files page

`/app/data` and its navigation item are removed. A company's kept files are listed on that
company's page with their deletion date and **Delete now**, which keeps the privacy commitment
(see or delete any kept file sooner) where the files belong. Privacy, security and the processing
notice point there.

## Consequences

- `PriceConfirmDialog` is deleted; `PaidJobButton` is a single press with quote and shortfall
  handling. `/api/pricing/preview` remains for the public price book.
- The run screen no longer creates and cancels draft estimates while files are added; a job is
  created only when the customer presses the button.
- E2E acceptance (`mis.spec.ts`, `ingest.spec.ts`, `frictionless.spec.ts`) drives the new flow:
  add company → workspace setup → **Build my MIS** → dashboard; refresh from **Add a month**; the
  assistant's modes; per-company file deletion.
- CLAUDE.md's flow rule that "the run screen prices itself and its single button is the SPEC §12
  confirmation" is replaced by this ADR.
