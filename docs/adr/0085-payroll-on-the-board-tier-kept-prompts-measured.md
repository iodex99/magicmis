# 0085 — Payroll on the board, the run's tier kept, and three prompts measured

- **Status:** accepted
- **Date:** 2026-10-09
- **Decided by:** the product owner, who asked for the three items ADR 0084 left open to be done
  "taking your best decisions".
- **Builds on:** [0056](0056-a-dashboard-chosen-for-the-company.md),
  [0058](0058-closing-what-the-audit-left-open.md), [0077](0077-deep-chat-measured.md),
  [0083](0083-haiku-5-5.md), [0084](0084-the-product-run-against-the-real-model.md).

## 1. Payroll and ageing can be shown on the board

ADR 0056 added the breakdown box so that payroll by designation and receivables by age — computed
by the engine every month from the pay sheet and the pending bills — could finally be seen. The
box rendered them, and its tests used them; but every list of what a board may hold was the MIS
library (`METRIC_CATALOG`) alone, so the first-dashboard check and the chat's check both refused
them, and ADR 0084 could only stop offering them.

**Decision.** `render-dashboard` now carries `ANALYSIS_METRICS` — receivables and payables by
age, payroll cost by designation, headcount, gross pay, employer PF and ESI, each with its label,
unit and the split the engine stores it by — and `dashboardMetrics(library)` is the library
followed by those. The first-dashboard choice and a dashboard change by chat are both given it; a
change to the MIS template is still given the library alone, because a template row binds to the
library. The library itself is unchanged: it also maps a customer's reference MIS and feeds the
chat's synonyms. Labels come through `metricLabel`, so a box reads "Payroll cost by designation",
not `payroll_cost`. The engine's own `METRIC_LABELS` is untouched, because commentary's facts pack
walks it.

**The eval data was wrong in the same way.** The first-dashboard dataset split `employee_cost` by
designation and `receivables` by bucket — splits the engine never makes — so it scored boards on
cases that cannot occur while the real ones failed in production. It now adds the real analysis
figures where the report behind them would exist (a pay sheet for a business with staff costs,
bills ageing for one with receivables), and the chat-edit dataset gained three requests for them.

## 2. A run's dashboard is priced and chosen at the run's tier

`bringDashboardUpToDate` created the dashboard job at Professional whatever the run was: an
Efficient run paid 299 for its dashboard rather than 239, and an Expert run's first board was
chosen by Sonnet rather than Opus. **Decision:** it follows the tier the customer chose for the
run, as every other part of the run does — the same rule that already charges an Expert monthly
refresh at Expert though it makes no AI call. The tier is read from the job row, never the browser.

## 3. Three prompts, measured

- **Where to act v3.** Haiku 5.5 typed a figure on a quarter of its first answers — "about 13.6%",
  "the same 20 percent" — a figure it worked out rather than one in the pack. v3 names that habit
  and asks for a last read of every field for a stray digit.
- **Chat edit v4.** Its first-answer failures on Haiku 5.5 were not figures at all: every one was a
  `test` operation on the right box id at the wrong position, one off from counting through the
  spec. The request now lists every box with its pointer (`boxPositions`), and v4 says to copy the
  pointer from that list rather than count.
- **Deep v5.** ADR 0077's one miss was a receivables total negated, following "negate a credit
  balance" onto a debit. v5 names which balances are debits (already positive, never negated) and
  which are credits.

**The rule for switching on:** a new version is activated on a route only where its live eval
meets the threshold and scores at least what the version it replaces scored there. It was set
before any run, so a result could not choose it.

## Measured, 2026-10-10

| Route | Before | New | Run cost | Decision |
|---|---|---|---|---|
| Where to act, Efficient (Haiku 5.5) | v2 0.981 | v3 **1.000** | $0.02 | v3 on |
| Where to act, Professional (Sonnet 5) | v2 1.000 | v3 0.981 | $0.32 | stays on v2 |
| Where to act, Expert (Opus 5) | v2 1.000 | v3 **1.000** | $1.65 | v3 on |
| Chat edit, Efficient (Sonnet 5) | v3 0.980 | v4 **0.981** | $0.30 | v4 on |
| Chat edit, Professional (Haiku 5.5) | v3 0.961 | v3 0.944, v4 0.944 | $0.03 | **moved to Sonnet 5** |
| Chat edit, Professional (Sonnet 5) | — | v4 **0.981** | $0.29 | v4 on |
| Chat edit, Expert (Sonnet 5) | v3 0.980 | v4 **0.981** | $0.29 | v4 on |
| First dashboard, all tiers (v2, corrected data) | 1.000 | **1.000** each | $5.91 | stays on |
| Deep, Efficient (Sonnet 5) | v4 1.000 | v5 0.984 | $0.35 | stays on v4 |
| Deep, Professional (Sonnet 5) | v4 0.984 | v5 **0.984** | $0.33 | v5 on |
| Deep, Expert (Opus 5) | v4 0.952 | v5 **0.984** | $0.93 | v5 on |

The round cost $11.11 in 1,157 calls, all on synthetic data.

- **Professional chat edits moved to Sonnet 5** (migration 0076). Haiku 5.5 measured 0.944 on both
  versions with the request as it now is, under the 0.95 threshold; its 0.961 the day before was
  the lucky side of the same misses. The threshold was not moved (ADR 0066); the model was, as 0061
  did for Efficient. At 19 credits an edit, Sonnet's AI cost is about 7%, inside the 20% cap, and
  Haiku 5.5 stays the fallback. Professional is the tier most people use, and a wrong edit changes
  a layout the company keeps.
- **Deep v5 fixed the sign it was written for**: v4's one Professional miss, a receivables total
  negated, is right under v5. Its one new miss there is a different one (a monthly sales figure
  in a column not named as money). Expert rose from 0.952 to 0.984.
- **The first dashboard uses payroll when it has it**: of the 36 corrected cases with a split on
  offer, every one of the 18 payroll cases put payroll by designation on the board; the ageing
  split was chosen once in 18, which is the model's call — a customer can still ask for it.
- `go-live --dryRun` lists Where to act at Professional and Deep at Efficient as "not on" because
  it looks for the newest version on disk. Both run their earlier version here by the rule above.
  In production, go-live evaluates the newest on that database's own runs and switches each on
  only if it passes there.

## What the browser found on the way

Putting a payroll box on the board by asking for it crashed the page: the board's list of values
under a chart read a value's month as everything after the `@` in its key, and a breakdown's key
ends `|designation=Accountant`. No breakdown had ever been accepted onto a board, so none had ever
been drawn. `parseMetricKey` reads keys back; `payroll.spec.ts` asks for the box on a services
company with its pay sheets and fails on any error the page throws. The chat's rules for telling
a dashboard change from a question also learned payroll, headcount, salaries and ageing.
