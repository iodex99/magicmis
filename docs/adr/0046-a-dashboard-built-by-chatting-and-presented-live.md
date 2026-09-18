# ADR 0046: A dashboard built by chatting, and presented live

**Status:** accepted · **Date:** 2026-09-19 · **Decided by** the product owner · **Extends** SPEC
§24.2 (dashboard), §27 (`chat_edit`), ADR [0033](0033-one-workspace-no-price-step.md),
[0044](0044-a-rail-and-a-chat-that-fold-away.md) and
[0045](0045-a-companys-own-layout-is-remembered-for-good.md)

## Context

The owner, in their words: _"I want the boxes and the whole dashboard to be integrated with the
chat … so the user just chats with the MIS and the dashboard keeps on updating … give
comparison, make comparison boxes or graphs or whatever the user requests. Basically the
dashboard shall be dynamic … boardroom ready. Let's remove the print or download buttons, anyone
who wants to present it has to present from here only; for presentation we can have a play /
full-screen button … so basically just dump your raw data and chat with it and build (we will
build the first MIS and then they can chat and build with their own preference)."_

What existed: a dashboard is data — a list of boxes, each a kind, a title, metric ids, a period
range and a grid position — stored per company in its blueprint. The chat could already change
it, but only in a mode the customer had to pick first, only with the thirty-one built-in metrics,
only after pressing **Apply**, and it could not express a comparison or a formula.

## Decisions

### 1. The model describes; the engine computes — extended to formulas

A customer can ask for a figure the catalog does not hold ("staff cost as a share of revenue").
The model adds a **formula** to the dashboard as data (`calculated`): a small tree of add,
subtract, multiply and divide over stored metrics and constants. `evaluateCalculated`
(`packages/engine/src/calculated.ts`) computes it for every paid-for month in **exact rational
arithmetic**, rounds once, half-even, and emits ordinary metric values with the formula in words
and its inputs — so a calculated figure is drawn, formatted and opened to its lineage exactly
like a built-in one, and carries `.mom_*` / `.yoy_*` changes under the engine's own rules.
Locked decision 7 holds without exception: no figure on a dashboard was written by a model.

Three back doors are shut in the stage's check, which sends the model back for its one repair:

- **A constant in a formula** must be one the customer typed in the request, or structural
  (1, 2, 4, 7, 12, 30, 100, 360, 365). The model may not bring a number of its own into a sum.
- **A formula must be a fact about the company** (`formulaProblems`). Checking constants one at a
  time is not enough: `365 × 12 × 100` is three permitted constants and one invented figure, and
  `(revenue − revenue) + 365` reads a metric and ignores it. So there is no arithmetic between
  constants (a part that reads no metric must be a single constant), and the formula is evaluated
  on three unrelated sets of made-up values: if what would be displayed is the same each time,
  or is never a number, it does not depend on the books and is refused — including a metric
  divided down until only the chosen number survives rounding. The independent review found
  this; the first version checked leaves only.
- **A title or label** may contain only digits the customer typed. "Revenue, 7.4 crore" can
  never be pinned to a board as if it had been computed. Number *words* are not caught ("last
  six months" is a legitimate title, so they cannot be banned); a title is a name, and the
  prompt says so.

Only what a change **brings in** is judged. A saved dashboard that names a metric the catalog
has since dropped costs that box its figure; checking the whole document would have failed every
later change, twice, at our expense, and frozen the company's dashboard.

The dashboard's own controls reach boxes only: the browser's endpoint accepts `/widgets/…` paths
and nothing else, so formulas cannot be defined past the check by a modified client.

A formula reads stored metrics only, never another formula (no cycles, and lineage stays one
step deep). A box may not show a `calc_` id with no formula behind it, and a formula may not be
removed from under a box; both are schema rules.

### 2. Two additions to what a box can be

- **`comparison`**: each metric this month against the previous month or the same month last
  year — both figures, the change, and the change percent where the engine states one (a change
  in a percentage is in points; no percent of a percent). The arrow repeats the sign of the
  stored change; it is never computed from a float.
- **`compare: "last_year"`** on line and bar charts draws the same months a year back beside
  each series, dashed or faded. Not on stacks: two stacked years side by side read as one total.

**Every addition is optional with a default.** ADR 0045 reads a saved dashboard strictly, so a
field an older saved dashboard lacks must never make it unreadable; a test parses the pre-0046
shape. For the same reason "is this metric in the catalog" is **not** in the schema
(`unknownMetrics`): it is checked where a change is proposed. A catalog that later drops a
metric costs that box its figure, not the company its dashboard.

### 3. One chat box; a dashboard change is applied as it is answered

- **No mode to pick.** In Ask, `detectIntent` (`packages/chat/src/intent.ts`) decides whether a
  message is a question or a change to the dashboard. It is rules, not a model: a classifier
  call would cost money on every message, and its verdict could not be shown before the customer
  presses send. These rules can — the box says **"This will update the dashboard"** as they
  type, with **Ask it instead** one press away. They are separately priced actions in the price
  book (the seed prices happen to be equal), so the customer is told which one a message is.
  In doubt it is a question: a question sent as a change is declined and charged, which is the
  worse mistake. A change needs a layout verb **and** a thing on a dashboard ("compare", "show"
  and "give" are not layout verbs; "show me **a chart**" is), and words from other parts of the
  product — account, files, credits, company — rule it out unless a box is named. "Delete my
  account" and "show me the dashboard for March" are questions. The explicit modes remain.
- **Applied, not proposed.** A dashboard change that passed every check is applied by the server
  in the same step that answers (`appliedVersion` on the stored reply), and the reply offers
  **Undo**. The order is **charge, apply, record**: applying first would hand the change over for
  nothing if the capture then failed and the message were swept as a platform fault. This way
  round the worst a failure leaves is a change that was paid for and is still a proposal, applied
  by hand at no charge. Undo is offered only while that change is still the version on screen;
  once the dashboard has moved past it the reply says "Applied earlier. The dashboard has
  changed since." It is a layout over figures the engine computes and is
  one press from being undone, so asking first bought nothing but a click per change. Losing a
  race with another edit (ADR 0045's `stale`) leaves it as a proposal with an Apply button; it
  is not a failure of the message. A change to the **MIS template** alters the next workbook and
  still waits for a confirmation.

### 4. Present, and no print or export

**Present** puts the dashboard alone on the screen: company, month, units, the boxes. No rail, no
chat, no edit or Investigate controls. Left and right step through the months; Esc leaves. Where
the stage only covers the window, Esc closes an open lineage drawer first; in true full screen
the browser takes Esc for itself and leaves full screen, which leaves Present. The stage is a
modal dialog to assistive technology, takes focus, and holds the page behind it still. Present
is disabled while a layout edit is waiting to be applied, rather than discarding it. It asks the browser for the whole screen and, where that is
refused, still covers the window, so Present never fails to present. The lineage drawer lives
inside the presenting element, so when a director asks where a number came from, it opens.

The **Print or save as PDF** buttons (workspace header and commentary report) and the header's
**Latest workbook** download are removed. A deck is out of date the moment it is exported and a
number on a slide cannot be questioned; presenting from the live dashboard is the product's
answer, and it keeps the meeting where the chat is.

**Kept on purpose:** the list of workbooks under the dashboard, and the download at the end of a
run. The Excel workbook is what a run is charged for (ADR 0031: "a run gets the customer to a
workbook") and what the public site promises. Removing access to a paid deliverable is a
different decision from removing export of the dashboard, and the owner did not ask for it.

### 5. The film, the words, the copy

- The tour gains a fifth step, **Build and present** (chat adds a comparison box; Present takes
  the screen), and its closing card now reads "Raw data in · chat to build it · present it live".
  It is 39 seconds. `e2e/support/tour-stills.ts` renders single frames in seconds, for checking a
  scene before the several-minute render.
- A page for the phrases this opens up — _dump raw data_, _boardroom-ready MIS_, _board meeting
  dashboard_, _build a dashboard by chatting_ — at `/boardroom-ready-mis`, registered per the
  ADR 0038 rule. `PublicPage` gains optional `keywords`, emitted as the keywords meta tag; search
  engines rank on copy, so every phrase listed is also said on its page. The home title and
  description lead with the same positioning, and `llms.txt` states that the dashboard is built
  by chatting and presented live, not exported.
- Removed at the owner's request: "Prepaid credits, priced per action. No free tier, no trial,
  no subscription." under the home hero, and the tour's visible caption. SPEC §2.3 still needs a
  reader to be able to tell the figures are invented, so it is said where the caption is not:
  on the film's closing card, in the video's accessible name for a screen reader, and in its
  structured-data and sitemap descriptions for a crawler.

## Anthropic API

No request shape changed: the same `chat_edit` stage, the same structured output schema, the
same one repair. Only the prompt text (`prompts/chat_edit/v2.md`; v1 is untouched) and the
stage's own `check` function changed, so nothing new needed verifying against the API
documentation. v2 cannot be activated for customers until its evals are recorded (R-28), like
every other prompt.

## Tests

- `packages/engine/test/calculated.test.ts` — exact results and one rounding; money stays whole
  paise; nulls with reasons; changes under the engine's ids and rules; the schema refuses other
  operations, formulas of formulas, scientific notation and over-long trees. **Properties:**
  add-then-subtract and divide-then-multiply return the original to the paisa, a share of itself
  is one hundred percent, division by zero is never a number, order does not matter.
- `packages/render-dashboard/test/dynamic.test.ts` — a pre-0046 saved dashboard still reads; an
  unknown metric does not make one unreadable; the comparison view in both bases including the
  no-prior-month and points-not-percent cases; the last-year series and its lineage keys;
  formulas added, referenced, orphaned, duplicated and removed from under a box.
- `packages/ai/test/chat-edit-check.test.ts` — what the chat may put on a dashboard and the
  things it may not, including the reviewer's composed-constant attack, a metric read and thrown
  away, and a stale metric elsewhere on the board not blocking an unrelated change.
- `packages/chat/test/intent.test.ts` — forty-two messages routed, among them every sentence the
  review showed being charged as a change; `server.test.ts` — a
  dashboard change is applied as answered, refuses a second hand-application, and undoes; a
  template change stays a proposal.
- `apps/web/e2e/mis.spec.ts` — in the browser: the hint appears and can be declined; a rename is
  on the dashboard with no Apply, survives a reload and undoes from the reply; a comparison box
  and a formula card are built by two sentences, the formula's figure equals staff cost ÷
  revenue × 100 recomputed in the test from the stored values, and its lineage shows the formula;
  there is no print or download button; Present covers the window, steps months on the arrow
  keys, opens lineage on the stage, and exits.

## Known and left

- **Ctrl+P still prints.** The buttons are gone; the browser's own print is not, and the print
  stylesheet that made the old button's output tidy is still there. Blocking the browser's print
  would be hostile and would not stop a screenshot. Noted rather than fought.
- A customer can still add a box free from the dashboard's own controls or a hand-written
  request to its endpoint, as before (SPEC §24.2: a layout edit reads no data). What they cannot
  do there is define a formula.

## Consequences

- The dashboard spec is now something a model writes into more freely, so the stage's check is
  load-bearing. Anything new a box can hold must be added to the check in the same change.
- `dashboardPayload` evaluates formulas on every load. It is arithmetic over at most twenty
  formulas and twenty-four months; if it ever matters it can be cached per blueprint version.
- Chat Q&A (`retrieveFacts`) does not know about a company's formulas yet: a question about
  "staff cost share" is answered from the built-in metrics. Noted for a later pass.
- The fake model used in development and the browser tests now answers three kinds of request
  (compare, share/formula, rename), each with output the real stage's check accepts.
