# 0066 — A limit the model is never told

- **Status:** accepted
- **Date:** 2026-09-24
- **Supersedes:** nothing. Follows [0056](0056-a-dashboard-chosen-for-the-company.md) and
  [0062](0062-where-to-act.md), whose stages this repairs, and closes part of R-28.

## Context

The first live evals of `dashboard_layout` and `board_actions` (R-28) came back well under
their thresholds and, on one route, absurdly so:

| route | first live score | threshold |
| --- | --- | --- |
| `dashboard_layout` efficient | 0.298 | 0.95 |
| `dashboard_layout` professional | 0.947 | 0.95 |
| `dashboard_layout` expert | 0.935 | 0.95 |
| `board_actions` efficient | 0.870 | 0.98 |
| `board_actions` professional | 1.000 | 0.98 |
| `board_actions` expert | 0.741 | 0.98 |

The obvious reading was that the prompts needed a second version. Two things said otherwise.
A tier ordering that runs backwards — expert scoring below efficient on `board_actions` — is
not what a weak prompt looks like; a weak prompt hurts the small model most. And 0.298 is not
a model that half understands the task, it is a model tripping over one thing every time.

The evals record every response, so the diagnosis cost nothing: each recorded output was
replayed through the stage's own check, and the recordings were matched to their dataset items
exactly by rebuilding the key the recording transport hashes, 57 of 57 and 54 of 54. Nothing
here was inferred.

Two faults, neither in the prompts.

### `drilldown` was the only field of its group a producer had to state

The efficient tier wrote `"drilldown": null` on **343 of its 432 boxes**, in 46 of 57
responses. Professional and expert did it **zero** times between them. Everything else about
those boards was sound — not one digit in a title, and only five references to a metric the
company did not hold across the whole run.

`drilldown` sits in `widgetSchema` beside `compare`, `sort` and `limit`, all of which default.
It alone was required, although one of its two variants is the universal one: every box ends in
Investigate ([ADR 0047](0047-files-kept-chosen-and-opened-by-nobody-unrecorded.md)), and
Investigate *is* lineage. Drilling to another box is the deliberate exception. A board is a
dozen boxes, so one omission threw the whole layout away and the company got the standard board
instead — over the one value in the schema that could not have been anything else.

### A limit the output is judged by was never in the brief

With that fixed, the same fault appeared in both stages at once: `summary` has a 300-character
limit in the output schema and in no prompt. The model was being marked against a number
nobody had given it.

| route | first attempts overrunning `summary` |
| --- | --- |
| `board_actions` expert | 54 of 54 |
| `dashboard_layout` expert | 46 of 46 |
| `board_actions` efficient | 33 of 54 |
| `dashboard_layout` professional | 32 of 57 |
| `dashboard_layout` efficient | 31 of 57 |
| `board_actions` professional | 16 of 54 |

This is why the tiers ran backwards. The larger models write at more length, so they overran
more often, and the single repair round rescued most of them — which is exactly why the fault
stayed hidden. It was never only an eval score: a repair is a second paid call, so every
"Where to act" on the expert tier would have been billed one model call and made two, against
a `max_ai_cost_ratio` of 0.20. Gross margin is the property this product is built to protect
(§2), and this was a standing leak in it.

Every recording for every stage was then checked against its own schema. The overrun is
confined to these two stages and to `summary` alone; no other route has ever exceeded a limit.
That fits — these are the two newest stages, written after the convention had settled
everywhere else.

## Decision

**1. An absent or null `drilldown` is lineage.** `widgetSchema` takes `.nullish()` and
transforms to `{ kind: "lineage" }`, so it defaults like the three fields beside it. A stated
drilldown is untouched and a malformed one is still refused. The transform materialises the
field, so parsing stays idempotent and a stored spec round-trips unchanged. Because
`chat_edit` validates through the same `dashboardSpecSchema`, a box the chat adds inherits the
same default.

**2. A limit the output is judged by goes in the system prompt, which means a prompt version.**
The first attempt at this put the lengths in `stable()`, beside the action count
`board_actions` already passed there. It changed nothing: `board_actions` efficient still
overran on 32 of 54 first attempts against 33 before. `stable()` is wrapped in `<data>` tags,
and every system prompt in this repository tells the model that what is inside them is the
company's data and **never an instruction** — so the limit was stated in the one place built to
be ignored as one. That rule is load-bearing for prompt injection and is not being softened to
carry a constraint that belongs elsewhere.

So the lengths are in **prompt v2** for both stages, and `LIMITS` stays the single constant the
schema enforces. A versioned `.md` file cannot read a constant, so
`packages/ai/test/prompt-limits.test.ts` asserts that every number in `LIMITS` appears in the
prompt that asks for it. The box-title limit is `WIDGET_TITLE_MAX`, exported from
`render-dashboard` rather than copied.

**3. A field nobody reads must not be able to fail a response.** `dashboard_layout.summary` is
discarded — `firstDashboardSpec` takes the spec out of the result and never looks at it. At 300
characters it rejected 36 of 57 first attempts, throwing away entire boards and leaving the
company on the standard dashboard, over a string with no reader. Its cap is now 1000 and is a
payload guard, not a brief; it stays digit-free as defence in depth in case it is ever
rendered. `board_actions.summary` is rendered, in a narrow panel above the actions, so its 300
stands and v2 states it.

**4. The prompts were not the cause, but they are the cure.** Ruling out a v2 on the strength
of the diagnosis was half right and worth recording as an error: a fault can be entirely ours
and still have its only correct fix in the prompt, because the prompt is where instructions are
allowed to live.

## Consequences

Both stages were re-evaluated live against the corrected schema and brief. Changing `stable()`
changes the prompt text and therefore the recording key, so the earlier recordings no longer
apply and the re-run was necessarily live.

The clearest evidence is `board_actions` on the efficient tier, where the same model, dataset
and schema were measured three times as the fix moved:

| what the model was told | score | first attempts overrunning `summary` |
| --- | --- | --- |
| the limit was in the schema only | 0.870 | 33 of 54 |
| the limit was also stated in `stable()`, inside `<data>` | 0.907 | 32 of 54 |
| **the limit was stated in the system prompt (v2)** | **1.000** | **0 of 54** |

A third of responses overran, then none. That middle row is the finding worth keeping: an
instruction placed inside `<data>` is not an instruction, exactly as the prompts promise, and
the promise held even when it was inconvenient.

`board_actions` is now activated on all three tiers, each on 54 items against a 0.98 threshold:

| route | v1 | v2 |
| --- | --- | --- |
| `board_actions` efficient | 0.870 | **1.000** |
| `board_actions` professional | 1.000 | **1.000** |
| `board_actions` expert | 0.741 | **1.000** |

The expert route is the one to note: it was the worst in the whole set, and the reason was
that Opus writes at more length than the others, so it overran a limit it had never been
given every single time. "Where to act" had no active prompt on any tier and failed as a
platform fault; it now runs.

`dashboard_layout` cleared its 0.95 threshold on the two larger models, on all 57 items:

| route | v1 | v2 |
| --- | --- | --- |
| `dashboard_layout` professional | 0.947 | **1.000** |
| `dashboard_layout` expert | 0.935 | **1.000** |
| `dashboard_layout` efficient | 0.298 | 0.947 — below the bar |

The efficient tier is the one that did not, and it is worth being precise about why, because
the temptation to make it pass was real. Haiku went 0.298 → 0.579 on the drilldown fix and
0.579 → 0.947 on v2, and then stopped. Its remaining failures are not lengths: it names
metrics the company does not hold, usually a percentage whose components are present but whose
own value is null, and a box like that shows a dash every month — exactly what ADR 0056 added
the check to prevent. It also still needed the repair round on 37 of 57 first attempts, so two
thirds of efficient-tier boards were two model calls rather than one.

Two things were available and both were refused. The dataset trims metrics arbitrarily, which
over-represents that case; making it more representative would very likely have carried the
score over 0.95, and would have been tuning the measurement until it passed. And 0.9473 clears
a 0.94 threshold by four items in fifty-seven, which is inside this sample's noise; moving a
bar to fit a score is choosing the answer first.

What moved instead is the model: migration 0063 routes the efficient tier to Sonnet, the same
shape as 0061 did for `chat_edit`. This is the cheapest stage in the product to do that to —
it runs **once per company, ever**, so the recurring-refresh zero is untouched — and Haiku's
repair round had already closed most of the gap in cost: ₹0.36 a call became about ₹0.59
effective, against ₹1.74 for Sonnet. About a rupee, once, per company, rather than leaving
every efficient-tier company on the standard eight boxes. On that route it scores **1.000 on
all 57 items**, and is activated.

That leaves **30 of 33 routes live**, from 24 before this change. The three that remain are
`ledger_mapping`, which waits on a chartered accountant to label the ledgers the fixtures leave
genuinely ambiguous — not something a prompt or a schema can settle.

A second instance of the drilldown wart turned up in the same diagnosis and was fixed on its
own merits: `dimension` was nullable but still required, so a box with nothing to split by had
to say so or take the board down with it. Absent and null now both mean "show the total".

The wider lesson is the cheap one: **the recordings are the evidence, and reading them costs
nothing.** Three times in this round an apparent model failure was ours — the `chat_edit`
labels, the `commentary` check ids, and now these two. The habit that catches it is to replay
what the model actually returned before writing a word of prompt.

`ledger_mapping` remains unactivated on all three tiers and is unaffected by this: it waits on
a CA's judgement for the ledgers the fixtures leave genuinely ambiguous, which is not something
a prompt or a schema can settle.
