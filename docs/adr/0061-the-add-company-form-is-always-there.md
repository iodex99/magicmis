# ADR 0061: The add-company form is always there

**Status:** accepted · **Date:** 2026-09-22 · **Decided by** the product owner ("the add new
company tab shall always be open, even if companies are added") · **Adjusts** ADR
[0033](0033-one-workspace-no-price-step.md)

## Context

With no companies the form was open; with one or more it collapsed to a dashed button that had
to be clicked before the form appeared. The reasoning was that a returning customer comes to
look at their companies, not to add one.

That is wrong about who is on this page. Somebody who already has one company is the likeliest
person in the product to add a second — a CA firm's first client is followed by its second — and
the page's own heading is still "Add a company. Its MIS is minutes away."

## Decisions

### 1. The form is always open

`AddCompany` renders the same panel whether or not the account has companies. The `startOpen`
prop becomes `first`, and it now changes **only the wording** — the "Start here" badge for an
empty account, "New company" otherwise — never whether the form is there. The Cancel button goes
with the collapsed state, since there is nothing to collapse back to.

### 2. The workbook is not named in the promise

The third step read "A checked workbook, a live dashboard and an assistant that knows the
books." It now reads "A live dashboard and an assistant that knows the books."

**The workbook itself is untouched.** A run still produces one, it is still listed under
Workbooks on Files and settings, and it is still downloadable — ADR 0046 kept it deliberately
("there is no print and no export of the dashboard or the commentary … while the workbooks a run
produced stay downloadable"). The public site still sells it, in as many words: *"produces an
Excel workbook you own rather than a dashboard behind a login"* is the positioning on
`/ai-financial-reporting`. Only this one line of onboarding copy changed.

Whether the workbook should stop being produced at all is a product decision with a much longer
reach — the run pipeline, `packages/render-excel`, the Workbooks panel, three public pages and
ADR 0046 — and it is not made here.

## The reporting conventions, checked

The same request asked whether a company's reporting conventions are stored, remembered and used.
They are; this records what was verified rather than asserting it.

- **Stored per company**, on the `companies` row: `currency`, `fy_start_month`, `number_format`,
  `date_order` (migrations 0003 and 0038). The form posts all four; the API defaults them to the
  Indian set when a caller omits them.
- **Remembered for good.** Nothing in the run path writes any of those four columns — the only
  writers of `companies` are the lifecycle states and the owner's own `PATCH /api/companies/:id`
  (ADR 0035). A monthly refresh cannot quietly move them.
- **Used where figures are rendered.** The dashboard payload carries `fyStartMonth`, `currency`,
  `currencySymbol` and the money style; the commentary and chat facts are formatted through
  `ReportingContext`, built per company from its own row.
- **What the model is told, and what it is not.** The currency and the number format reach
  Anthropic, because the facts a stage is given are already formatted. The financial-year start
  and the date order do **not**, and should not: the model asks for `fy_to_date` and the engine
  resolves it from the company's own start month, so the model cannot get it wrong; dates are
  parsed day-first always (locked decision 14), so `date_order` is a display choice only. This is
  locked decision 7 working as intended — the model names a figure, the engine computes and
  formats it.

## Tests

Two browser tests opened the collapsed button before filling the form; both now go straight to
the field, which is the assertion that the form is there without a click.
