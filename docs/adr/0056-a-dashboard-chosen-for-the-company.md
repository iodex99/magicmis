# ADR 0056: A dashboard chosen for the company, and boxes that sort themselves

**Status:** accepted · **Date:** 2026-09-21 · **Decided by** the product owner ("not every
business will have the same KPIs, let it be decided by Claude... can we have smart boxes,
sorts and filters in boxes as per the data inside it?") · **Extends** ADR
[0046](0046-a-dashboard-built-by-chatting-and-presented-live.md)

## Context

Every company got the same eight boxes. That layout suits a trading company and nobody else.
A consultancy got a stock-days row that would never hold a figure, and a working-capital table
half full of dashes.

Worse in the other direction: the engine has always computed **receivables and payables by age
bucket** and **payroll by designation**, every month, for every company that uploads the
reports. No box in the default dashboard could show either. The figures were paid for,
computed, stored, and never once displayed.

## Decisions

### 1. The first dashboard is chosen for the company

A new stage, `dashboard_layout`, picks the boxes when a company's dashboard is first built. It
is told which metrics that company actually holds figures for, which of them the books split up
and what values the split takes, and how many months there are.

The books say what the business is. Inventory and direct costs mean trading or making
something. Payroll split by designation means a people business. Bills ageing means collections
matter. A company with none of those is billing for services.

Three things keep it safe:

- **It runs once**, where there is no dashboard yet. A monthly refresh still makes no AI call
  at all, which is where the recurring margin comes from, and nothing about that changes.
- **It cannot fail the run.** No active prompt version, a routing failure, a cost cap: any of
  them keeps the standard dashboard. A company is never left without one. In particular a
  cost-cap pause is caught rather than surfaced, because stopping a delivered run to quote for
  a *layout the customer did not ask for* would be absurd.
- **It cannot invent.** The model may use only metrics this company holds, so no box can be
  placed that shows a dash for ever. A title may not contain a digit at all: there is no
  request here that could have typed one, so any digit is the model's own, and locked decision
  7 holds. "Top ten" is the `limit` field, never words.

Until the owner runs its evals (R-28) no prompt version is active, so the stage refuses and
every company gets the standard boxes. That is the intended state, not a gap.

### 2. A box can be split by a dimension, and can sort and trim itself

A new widget kind, `breakdown`: one bar per value of the box's dimension, for its first metric.
This is what finally makes payroll by designation visible.

Two optional fields on every widget:

- `sort`: `{by: "value" | "label", direction}`. Sorting by value compares the stored decimal
  strings as integers, so a figure larger than a double stays in the right place.
- `limit`: keep the first rows after sorting. The top ten by value is a sort and a limit.

Both default to null, which leaves the engine's own order and every row. That matters twice:
a dashboard saved before these existed must still read (ADR 0045), and an age bucket already
has the one order that means anything, so sorting it is opt-in.

### 3. The chat learned them in the same change

ADR 0046 requires that anything new a box can hold is added to the `chat_edit` check in the
same change, or the chat could propose a box the board cannot store. The prompt now documents
`breakdown`, `sort` and `limit`, and the check accepts them because it validates against the
same schema.

## What this does not do

- **The layout is chosen once, not maintained.** A company whose business changes keeps the
  boxes it was given until somebody asks the chat to change them. Re-proposing a layout on a
  refresh would break the zero-AI refresh, so it would have to be a separate priced action.
- **Sorting applies to dimension-split boxes only.** A `table`'s rows are its metrics, in the
  order the box lists them, and that is already the author's choice.
- **There is no value filter**, such as hiding rows under a threshold. A top-N limit covers
  most of what a threshold would, and a threshold is a number in the layout, which is the sort
  of thing that needs thinking about before the model can write one.

## Tests

`packages/render-dashboard/test/breakdown.test.ts`: source order by default; value order with a
figure beyond a double's exact range; label order; a limit keeping the top rows; an empty or
unnamed split saying so rather than drawing nothing; an age chart left in bucket order unless
asked; and a dashboard saved before sorting existed still parsing.
`packages/ai/test/dashboard-layout.test.ts`: a layout built only from figures the company holds
is accepted; one naming a metric it does not hold is refused; a digit in a title or the summary
is refused; a breakdown by a split the books do not make is refused; and an empty board, bad
JSON and a box past the grid are all refused.
