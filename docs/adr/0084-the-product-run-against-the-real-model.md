# 0084 — The product run against the real model

- **Status:** accepted
- **Date:** 2026-10-09
- **Decided by:** the product owner, who funded the key and asked for every API test still
  outstanding to be run — "everything".
- **Builds on:** [0050](0050-a-wallet-that-sells.md), [0056](0056-a-dashboard-chosen-for-the-company.md),
  [0062](0062-where-to-act.md), [0068](0068-a-start-that-costs-nothing.md),
  [0083](0083-haiku-5-5.md).

## Context

The live evals (ADR 0083) prove each AI stage against its dataset. They do not prove the product:
every browser test drives a fake model (`AI_TRANSPORT=fake`), so no customer action had ever
reached the real model end to end, and the Message Batches path behind standard-delivery
commentary had never sent a batch.

## What was run

- **`apps/web/e2e/support/live-smoke.ts`**: two companies set up through the UI on the real model
  (trading books at Professional, a services business with payroll at Efficient), then every
  priced AI action pressed through the routes the buttons call — commentary, where to act, quick,
  Deep and dashboard-edit chat — and quick and Deep at Expert. It reports each action and reads
  back what each charged and what its AI cost. Rerun it before launch against a staging stack.
- **`packages/ai/evals/batch-live.ts`**: three commentary items as one real Message Batch,
  polled until it ends.

Everything, including the evals of ADR 0083 and the replays used to diagnose, cost $1.96 in 949
calls.

## What it found, and what was fixed

1. **Where to act had never worked from the app.** `POST /api/jobs` listed every job type but
   `board_actions`, so the board's button was refused with a 422 for every customer since ADR
   0062. The database, price book and routing all had it; the route did not, and the browser suite
   checked the button was visible and enabled but never pressed it. Added, and `mis.spec.ts` now
   presses it and the commentary button and checks both are completed and captured.
2. **Commentary and where to act threw on a margin.** `isMaterial` in the facts pack compared every
   metric's change with the money threshold through `BigInt`, and a percentage, ratio or days
   figure changes by a decimal string: "Cannot convert -3.627123 to a BigInt" on every request
   for any company with a margin. The threshold now applies to money only; a test covers each
   unit.
3. **A company with payroll was quietly given the standard dashboard.** The `dashboard_layout`
   stage was told about payroll by designation, headcount and gross pay, which the engine computes
   but the dashboard catalog does not hold. The model chose a payroll box — rightly, for a people
   business — the check refused it as not "one this dashboard can show", the repair did the same,
   and the run fell back to the eight standard boxes. `layoutInputFor` now offers only what the
   board can show; the same company's layout passed first time against the real model.
4. **A first company opened in dollars on a calendar year.** The new-company form is pre-filled
   from the billing country, and billing details are asked for at the first purchase — after the
   welcome credits (ADR 0068) have paid for the first setup. So most first companies were added
   with no country, and got the international set: USD, a January year, millions. On Indian books
   a January year makes April's year-to-date reset read as revenue collapsing, which is what the
   live where-to-act answer reported. `defaultConventions` now falls back to the country the
   request comes from (`x-vercel-ip-country`, the signal the pricing page already uses), and the
   billing country still wins once given. It only ever seeds a form the reader can see.
5. **The fake model learned commentary and where to act** in their real shapes, citing only the
   engine's placeholders, so the browser suite can press both buttons.
6. **The commentary route built its own Anthropic client** rather than taking `aiTransport()` as
   every other AI route does, so it ignored `AI_TRANSPORT=fake`: the moment the browser suite
   pressed the button, it called the real API with a placeholder key and got a 401. Production
   always runs the real model, so no customer saw it; the suite could not have tested commentary
   until it was the same as the rest.

## Measured

| | Result |
|---|---|
| Setup runs (Professional, Efficient) | completed and charged; clean books placed by rules with no AI call |
| Commentary, where to act (Professional, Efficient) | completed on the real model after the fixes |
| Quick, Deep and edit chat (all tiers tried) | completed and charged |
| First dashboard | chosen by the model for both companies, first attempt |
| AI cost against the price charged | 0.92% (cap 20%) |
| Message Batch, three commentary requests | 3 of 3 usable, recorded as batch calls at the batch discount, $0.018 |

## Left for the owner

- **ADR 0056's promise is not yet kept.** It added breakdown boxes so that payroll by designation
  and receivables by age could finally be shown, but those figures are not in the dashboard
  catalog, so no box can show them. Finding 3 stops the stage being offered them; showing them
  needs the catalog, the board's labels, the chat-edit check and the eval datasets to learn them.
- **A run's dashboard is always priced and routed at Professional** (`dashboard-after-run.ts`): a
  customer who chose Efficient pays 299 for it rather than 239, and one who chose Expert pays 299
  and gets Sonnet rather than Opus. That is a pricing decision, not a fault, and is left as it is.
- Haiku 5.5's habit of typing a figure (ADR 0083) and ADR 0077's sign guidance for Deep both want
  a new prompt version, each measured by its own eval.
