# 0086 — What a customer gets back to: every email lands, the year is asked, the map is shown, the cash flows, and a sample shows the whole

- **Status:** accepted
- **Date:** 2026-10-10
- **Decided by:** the product owner, who chose five items from a list of improvements to what a
  customer gets ("do 1-4 and 9 completely"); the decisions inside each are the builder's.
- **Builds on:** [0031](0031-frictionless.md), [0032](0032-server-side-processing.md),
  [0035](0035-year-mismatch-commentary-report-chat-admin-dark.md),
  [0045](0045-a-companys-own-layout-is-remembered-for-good.md),
  [0046](0046-a-dashboard-built-by-chatting-and-presented-live.md),
  [0049](0049-running-out-of-credits.md), [0051](0051-sample-dashboards-not-a-sample-mis.md),
  [0069](0069-ledger-mapping-labelled-by-claude.md), [0081](0081-the-words-every-market-types.md).

## 1. Every email lands somewhere

Five of the worker's email templates linked to pages that did not exist: `/app/jobs/:id` (job
completed, job failed, quote offered, awaiting review, review expiring), `/app/companies` (the
archive and purge notices) and `/app/companies/:id/refresh` (the monthly reminder). Those are the
emails that bring a customer back, and each opened "not found".

**Decision.** `/app/jobs/:id` is a real page: what ran, its month, what it charged, its workbook,
and for a failure the message the run screen gave (only a `server_run` detail, which is written for
customers; anything else gets a plain sentence by failure class). A job waiting on its owner — a
quote, or the year question below — redirects to the run screen with `?job=`, which loads the
pending quote or question and carries on from there; a commentary, where-to-act or dashboard job
redirects to the workspace, where it is read. `/app/companies` redirects to `/app` and
`/app/companies/:id/refresh` to `/run`. `src/lib/email-links.test.ts` reads every `path:` in the
worker's templates and fails if no page answers it, so a sixth cannot be written.

## 2. A run that finds a different financial year stops and asks

ADR 0035 detected files running a different financial year from the company and said so on the
finished workbook — "change the year, then run the month again". That was a second run, charged
again, for a fact the run already knew before it computed anything.

**Decision.** The run asks before it computes. After mapping, if the files' year
(`detectSourceFinancialYear`) differs from the company's, the job moves to `awaiting_review` with
its credits still held, records `year_question` on its checkpoints, and returns `needs_year`. The
screen asks which is right:

- **Use the files' year** — the browser changes the company's year through
  `PATCH /api/companies/:id`, the conventions call that is the only writer of conventions (ADR 0035),
  and then calls the run route again on the same job.
- **Keep the company's year** — the run route records `year_kept` on the job, and the run carries on
  with the old notice.

Either way it is one job, one hold and one charge. `awaiting_review` was chosen because it already
does everything a pause needs: it extends the reservation with the review time limit, queues the
"awaiting review" email, reminds before expiry and is expired by the sweeper — and under ADR 0032 no
server run entered it for any other reason, so the two emails were reworded for this question. A
resumed run reads and maps its files again, from checkpointed AI answers, and its `step` never
moves the job backwards. The question is shown inside a paid action — the credits are held — so
locked decision 3 is kept; an abandoned question expires like any other hold.

**It found one at once.** The browser suite's main company had been set up on the calendar year a
browser outside India is given, from books that run April to March, so every figure that suite
built for a year had the April restart read as a month — and passed, because a notice was all that
said so. The new question stopped its first run. The suite now sets that company to April, as an
Indian firm's is pre-filled.

## 3. The ledger map

A company's mapping was learnt on its first run and applied first on every run after, and nobody
could see it whole: lineage showed the ledgers behind one figure at a time, and a ledger left
Unmapped was visible only as a figure that seemed short.

**Decision.** `/app/companies/:id/ledgers`, linked from Files and settings, lists every ledger the
books have shown with the MIS line it feeds and its latest balance, Unmapped first. Choosing a line
saves at once through `PATCH /api/companies/:id/ledgers`, which writes a new blueprint version with
`basedOn` (refused as stale if another landed first) and is refused while a run for the company is
live (a heartbeat in the last ten minutes), because a run writes its own mapping back when it ends.
Leaving a ledger unmapped puts it on `acceptedUnmapped`, so the cascade settles it without the
model (ADR 0069). A change applies the next time the MIS is built; nothing is recomputed, charged
or sent to the model. Party and employee ledgers show their token, "name kept private".

## 4. The workbook has a cash flow statement

The workbook had a profit and loss, a balance sheet summary and ratios, and the public site said
in three places that it had no cash flow statement. An MIS without one is missing the page a
lender and a board read first.

**Decision.** A **Cash flow** sheet by the indirect method, for each month of the year and the year
to date: profit after tax, depreciation, the movements in receivables, inventories, other current
assets, payables and other current liabilities, and unmapped balances; fixed assets bought (the
change in net block less depreciation) and other non-current assets; borrowings, other long-term
liabilities and capital introduced or withdrawn; then the net change, cash and bank at the start
and at the end.

- **Nothing is a balancing figure.** Every line is profit, depreciation or a head's movement with
  its sign turned (`release`), and between them the lines cover every head a ledger can be mapped
  to — the parent heads catch anything mapped to `CA`, `CL`, `NCA` or `NCL` directly. So the three
  sections come to the movement in cash whenever the trial balances balance, and when they do not,
  the foot of the sheet does not tie and says so by not tying.
- **Movements, not closing differences.** The engine's movement is the change from last month's
  closing, or from the reported opening in the first month loaded, so a company's first month has a
  cash flow wherever its export reports openings, and so does its first year to date.
- **The year end.** Profit-and-loss ledgers restart when a year opens, and the closed year's result
  arrives in capital or reserves as an increase no cash paid for. `cf_profit_carried` takes it out:
  over every ledger, movement less change in closing — which is only ever that restart — so it needs
  no knowledge of the year beyond what the movements already hold. It is zero in every other month.
- **The same in Excel.** Each line is a formula over the Data sheet (`release`, `carried` and
  `opening` kinds in `render-excel/src/formulas.ts`), and the existing workbook test checks every
  cell against the engine with both HyperFormula and the V11 evaluator, for all three fixture
  companies.
- **Proved, not sampled.** `packages/engine/test/cash-flow.test.ts` checks that start + operating +
  investing + financing = end on every month of the three fixture companies across the April 2026
  year end, and on random double-entry books (forty runs, with year-end transfers into the Profit &
  Loss A/c and a ledger the cascade cannot place).
- It is a management cash flow from the books, not the AS 3 statement: interest stays where the
  books put it, and an overdraft mapped to borrowings is financing.

**Existing companies get it.** A company's template lives in its blueprint, so the built-in moved to
version 2 and `templateForRun` gives a run the current built-in in place of an **untouched** copy of
version 1 — exact equality with version 1 as shipped. A recreated reference MIS, or a built-in the
company changed in any way, is its own and is left alone.

**Kept out of the AI's lists on purpose.** The cash flow lines are stored with the year to date only
(a month-on-month change in a change in cash would be stored for every month and read by nobody),
and they are not in `METRIC_CATALOG`. That catalogue is also what the chat's dashboard changes and
the first board's layout send to the model, and both were switched on by evals over the list as it
was; the cash flow joins it when those are measured again. The commentary's facts pack walks its own
fixed list and is unchanged. The public pages that said there was no cash flow statement now say
there is one.

## 5. A finished sample company before the first upload

A new account met an empty form and had to trust that a board, commentary and where to act were
worth the files and the credits.

**Decision.** `/app/sample`, linked from the empty Companies page, is an invented services firm —
thirteen months of the services fixture's books and pay sheets — shown with the product's own
dashboard, commentary and where-to-act views in a read-only mode: Range, Compare, Present and every
figure's lineage work; nothing edits, charges or opens a chat. It is a **recording**:
`e2e/support/record-sample.ts` takes the books through the real product once, with the real model
writing the words, and saves what the three screens read to `src/lib/sample-company.json`, with the
run's file ids replaced. Showing it computes nothing, calls nothing and charges nobody — locked
decision 3 allows it for the reason it allows the public site's samples: the data is fictional and
the page says so on its face.

The services books were chosen over the trading ones: the trading fixture's stock swings by more
than a month's sales, so that ingestion meets hard cases, and the first recording's commentary
rightly called its direct costs anomalous. `src/lib/sample-company.test.ts` holds the recording to
the rules a live payload meets — the commentary's figure check, the same check on every field of
where to act, a value in every box — so a change the recording no longer fits fails the build, and
the fix is to record it again (about seven US cents).

## Found on the way, not changed

A thirteen-month setup stores one snapshot, for its latest month, so the board's month picker
offers that month alone although every month's figures are stored and the trend charts draw them.
Left for the owner to decide, with the rest of the list.
