# 0089 — Sonnet 5.5 in place of Sonnet 5, and a decision answered with its figures

- **Status:** accepted
- **Date:** 2026-10-10
- **Decided by:** the product owner, who answered ADR 0088's two open points: "answer it with the
  figures" and, for Sonnet 5.5, "do it".
- **Builds on:** [0066](0066-a-limit-the-model-is-never-told.md),
  [0069](0069-ledger-mapping-labelled-by-claude.md), [0083](0083-haiku-5-5.md),
  [0088](0088-opus-5-5.md).

## 1. A decision about the company is answered with its figures

ADR 0088 found Opus 5.5 answering "Should we hire two more salespeople?", "Is it a good idea to
take a working capital loan?" and "What is my company worth?" in scope: saying the MIS cannot make
the decision, then giving the figures that bear on it. The labels said to decline, and they stood.
The owner has now decided that this is the answer wanted.

**Decision.** Quick chat v4 and Deep chat v7 say so in the system prompt, the only place an
instruction is read (ADR 0066):

> A question asking for a decision about this company — whether to hire, borrow, invest its cash,
> cut or raise a cost, or what the company is worth — is **in_scope**. Say in one sentence that
> the decision is the reader's and that this MIS cannot make it, then give the figures ... that
> bear on it, and stop there: recommend nothing, choose no course, and judge no option better than
> another.

What stays out of scope is narrowed rather than widened: "general advice" became **advice that is
not about this company**, and an **audit** opinion joined the tax and legal ones. Nothing about
figures changed: every number in such an answer is still a placeholder the engine fills.

**Labels.** This is a change to what the right answer is, made by the owner, so four quick-chat
items move to in scope — investing the surplus cash, hiring, a working capital loan and what the
company is worth — each marked with this decision. Tax, legal and audit opinions, a personal tax
question, another company and everything unrelated stay out. Deep chat gains three decision
questions, labelled in scope and answered with at least one of the books' own amounts. The
quick-chat labels were fixed before the runs below; the Deep label's first wording said the
opposite of this rule and was corrected after the run, as §3 says.

## 2. Sonnet 5.5

Verified on 2026-10-10 from the official documentation (SPEC §0.4):

- Models overview — https://platform.claude.com/docs/en/about-claude/models/overview
- Pricing — https://platform.claude.com/docs/en/about-claude/pricing
- Migration guide — https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide

| | Sonnet 5 | Sonnet 5.5 |
|---|---|---|
| Model ID | `claude-sonnet-5` | `claude-sonnet-5-5` (fixed, no date suffix) |
| Input / output per MTok | $2 / $10 | $2 / $10 |
| Cache write 5 m / 1 h, read | $2.50 / $4, $0.20 | $2.50 / $4, $0.10 (0.05×) |
| Thinking | adaptive by default; `disabled` accepted | adaptive by default; `disabled` is a 400 (`between_tools` is the lowest) |
| Default effort | — | `high`, levels recalibrated |
| Forced tool use | accepted | **`tool_choice` `any` and `tool` are a 400** |
| Thinking blocks | — | reads Sonnet 5's and Haiku 5.5's, not Opus 5.5's; the API drops what it cannot read |

**Decision.** Migration 0083 adds Sonnet 5.5 to the registry and moves every route that named
Sonnet 5 to it: seventeen as the model, on all three tiers, each with its activation cleared until
a live eval on the new model passed; and the eight Opus 5.5 routes, where it is the fallback,
swapped in place. Effort and `max_tokens` are kept, as 0082 kept them. Sonnet 5 never sent a
`disabled` thinking setting here, so that change needs nothing. **Forced tool use does**: Deep
chat runs on Sonnet on Efficient and Professional, so `modelAcceptsForcedTool` now names both 5.5
models, and Deep sends `auto` to either (ADR 0088). A five-conversation live probe on Sonnet 5.5
before the full run: ten calls, all accepted, all correct, 119 to 167 output tokens each.

## 3. Measured

One `go-live` pass, every route on its newest prompt:

| Stage | Tier | Model | Prompt | Score | Bar |
|---|---|---|---|---|---|
| sheet_classification | expert | Sonnet 5.5 | v3 | 1.0000 | 0.95 |
| column_mapping | professional | Sonnet 5.5 | v2 | 0.9417 | 0.90 |
| ledger_mapping | efficient | Sonnet 5.5 | v2 | 0.9840 | 0.85 |
| ledger_mapping | professional | Sonnet 5.5 | v2 | 0.9920 | 0.85 |
| reference_layout | efficient | Sonnet 5.5 | v2 | 0.9714 | 0.85 |
| reference_layout | professional | Sonnet 5.5 | v2 | 0.9714 | 0.85 |
| commentary | efficient | Sonnet 5.5 | v4 | 1.0000 | 0.98 |
| commentary | professional | Sonnet 5.5 | v4 | 1.0000 | 0.98 |
| chat_quick | efficient | Haiku 5.5 | v4 | 0.9500 | 0.92 |
| chat_quick | professional | Sonnet 5.5 | v4 | 0.9833 | 0.92 |
| chat_quick | expert | Opus 5.5 | v4 | 1.0000 | 0.92 |
| chat_deep | efficient | Sonnet 5.5 | v7 | 0.9696 | 0.90 |
| chat_deep | professional | Sonnet 5.5 | v7 | 0.9696 | 0.90 |
| chat_deep | expert | Opus 5.5 | v7 | 0.9848 | 0.90 |
| chat_edit | efficient | Sonnet 5.5 | v4 | 1.0000 | 0.95 |
| chat_edit | professional | Sonnet 5.5 | v4 | 0.9629 | 0.95 |
| chat_edit | expert | Sonnet 5.5 | v4 | 0.9629 | 0.95 |
| dashboard_layout | efficient | Sonnet 5.5 | v2 | 1.0000 | 0.95 |
| dashboard_layout | professional | Sonnet 5.5 | v2 | 1.0000 | 0.95 |
| board_actions | professional | Sonnet 5.5 | v5 | 1.0000 | 0.98 |

Quick chat on Opus 5.5 went from 0.9500 to 1.0000 with v4: the three items it lost in ADR 0088 are
the ones this decision changed.

Every route passed and is switched on.

**Deep chat's decision items were first labelled wrong, by the builder, and are corrected.** In
Deep's scorer an in-scope item with nothing expected means "an answer citing no amount at all" —
the rule for a question the books cannot answer — and the three decision questions were written
that way. So the live run marked down exactly the answers this decision asks for: Opus 5.5 said
the decision was the reader's and gave the figures, and lost all three (0.9393). The label now
says what the rule says — `decision: true`, in scope with at least one of the books' own amounts,
whichever bear on it — and the Deep scores above are the same live recordings replayed against it.
What still misses is real: on Efficient and Professional, Sonnet 5.5 met "What is the business
worth?" by saying the valuation is the reader's and offering to pull the balances rather than
giving them; and every tier cited a bank balance for a Chennai branch account that does not
exist. The activation does not depend on the correction: the first scores (0.9545, 0.9545,
0.9393) already cleared 0.90.

## Not changed

Haiku 5.5 stays wherever it is. Sonnet 5's registry row stays, for the calls priced against it;
applied migrations, earlier ADRs and the recordings made on Sonnet 5 stay as written.
