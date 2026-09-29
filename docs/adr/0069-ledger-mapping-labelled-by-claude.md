# 0069 — Ledger mapping, labelled by Claude

- **Status:** accepted
- **Date:** 2026-09-29
- **Decided by:** the product owner ("also let claude only do the ledger mapping")
- **Closes:** R-29, and the last three of the 33 routes in R-28. Follows
  [0066](0066-a-limit-the-model-is-never-told.md).

## Context

`ledger_mapping` was the one AI stage with no active prompt. It maps the ledgers the
deterministic cascade cannot place, and an activation needs a live eval of at least fifty scored
items above its threshold (0.85). R-29 held that the dataset needed a chartered accountant to
label, for two reasons: the head is a judgement (R-32 reserves several for a CA), and labelling
from the rules the model backstops would be circular, because the model only ever sees what the
rules could not place. So the stage refused on every tier, and every unmatched ledger was left
Unmapped for the customer to place by hand.

The owner decided Claude should do the labelling in the CA's place.

## Decision

1. **The dataset is ledgers the rules leave for the model, and a test proves it.**
   `packages/ai/evals/ledger-mapping.ts` holds 96 ledgers in six books: flat trial balances from a
   trader, a software services firm, a manufacturer, a partnership's balance sheet side and a
   company's profit and loss side, and an export from another accounting package whose group names
   Tally's defaults do not know. `test/ledger-mapping-dataset.test.ts` runs the real cascade over
   every one and fails if a rule would have placed it, which removes R-29's circularity: none of the
   labels came from the rules. Candidates were drafted first and only the 96 the cascade leaves
   unmatched were kept (41 of 138 were caught by rules and dropped).
2. **Each ledger names every head a careful accountant could defend under Schedule III**, because
   a name alone often leaves two honest answers: Hamali on purchases is a direct cost and on sales
   is freight outward; a partner's current account and drawings both sit in capital. Where the
   right answer is to leave a ledger for the customer — a bare party token, a meaningless name —
   the label accepts only no head. A ledger scores when the model's head is one the label accepts.
   Confidence is not scored: every AI mapping is marked for the customer to confirm.
3. **The labels were fixed before any live run**, committed as `6e0c0ae` ahead of the eval, and
   were not changed after the results. Changing them to lift a score would be choosing the answer
   first (ADR 0066).
4. **The existing prompt v1 was measured unchanged** and passed on every tier:

   | Tier | Model | Score | Cost of the run |
   |---|---|---|---|
   | Efficient | claude-sonnet-5 | 95/96 = 0.9895 | US$0.080 |
   | Professional | claude-sonnet-5 | 94/96 = 0.9791 | US$0.074 |
   | Expert | claude-opus-5 | 96/96 = 1.0000 | US$0.176 |

   All three routes are activated. The three misses, read from the recordings, are both defensible
   readings the labels did not accept: *Website Development Charges* to intangible assets (right
   where the cost is capitalised) on two tiers, and *Work-in-Progress* to change in inventories (the
   profit-and-loss side of the same balance) on one. They are recorded here and not relabelled.
5. **A ledger the model leaves Unmapped is settled, and never asked about again.** Review before
   commit found that activating the stage would have broken the recurring-margin rule. Every
   mapping a run makes is written back as a company rule except Unmapped, which the blueprint keeps
   in `acceptedUnmapped` — and the cascade never read that list. So a bare party token or any
   ledger the model rightly declined came back unmatched every month, and a monthly refresh on
   unchanged structure made an AI call for it. While the stage had no active prompt the call was
   refused before it was made, which is why nothing had noticed. The cascade now takes
   `acceptedUnmapped` as settled: mapped Unmapped from the company's own record, before anything
   is left for the model, and still said on the refresh ("N ledgers could not be matched…").
   `packages/semantic/test/refresh-unmapped.test.ts` follows one such ledger from setup to the next
   month, and the welcome E2E refreshes a flat trial balance with an unplaceable ledger and asserts
   no AI call where the stage is activated.
6. **The recordings are committed as the evidence** (`evals/recordings/ledger_mapping-v1-*.json`),
   and the replay test runs the stage's check over the dataset on every CI run. As for every other
   stage, activation is per database: production needs its own live eval rows before the admin
   console will activate it there (R-28).

## Consequences

- An unmatched ledger is now mapped by the model and marked "Suggested by analysis; please confirm"
  rather than left Unmapped. A book whose ledgers the rules already place makes no AI call, and a
  monthly refresh on unchanged structure still makes none (decision 5), so the recurring margin is
  untouched.
  A mapping call costs about a cent and a half per book at Efficient or Professional.
- The labels are Claude's, not a chartered accountant's. The heads R-32 reserves for a CA (whether
  deposits sit non-current, whether other income is in EBITDA) are unchanged by this and still
  open. A CA reading `ledger-mapping.ts` would strengthen the dataset; it no longer blocks the stage.
- No external API fact is new here: the stage, its schema and the routing were already built and
  verified (ADR [0019](0019-ai-layer.md)); this only measures and activates them.
