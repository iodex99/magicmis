# 0077 — Deep chat, measured

- **Status:** accepted
- **Date:** 2026-09-30
- **Decided by:** the product owner — "fix both the deep chat and excel number formats and other
  things that can be done which are pending"
- **Closes:** R-44 (Deep evals), R-42 (chat prices against AI cost), R-30 (estimator constants).

## Context

Deep chat answers a question by querying the company's ledgers. The model writes SQL, the
server runs it, and the answer cites result cells. It had one prompt, never measured, because
the eval harness only knew stages that are one structured call; Deep is a tool loop. With no eval
there was no threshold, and the activation gate refuses a stage without one. So in a real
database, every Deep and Investigate message failed and released its hold.

## Decision

### An eval that plays the whole conversation

`packages/ai/evals/deep.ts` drives each item the way the server does:

- `chatDeepRound` for the model's turn;
- the real SQL guard for a refused query;
- the production `loadChatTables` and `runChatQuery` over DuckDB for the rows.

It repeats until the model answers.

The books are the three synthetic fixture companies, shaped as production shapes a Deep session:
- one row per ledger per month, holding only the closing balance;
- heads from the mapping cascade;
- party ledgers as tokens;
- pending bills that add up to the party balances.

There are 60 items:
- 45 answerable questions, covering balances, a month's income or expense, sales, what
  customers and suppliers owe, the top debtor, the largest pending supplier bill, counts, and
  receivables older than 90 days;
- 10 off-topic questions, including injections;
- 5 about these books that the books cannot answer.

Every expected value is computed from the ledgers in code, never with SQL. An oracle run pushes
each item's own query through the real guard and DuckDB and must score 1.0000 in CI, which
proves every answer is reachable.

An answer is scored by what the customer would see:
- **Scope** must be right.
- **Money:** a money figure counts only as an integer cell under a column that production shows
  as money (`isPaiseColumn`, now exported for this).
- **Counts:** a count counts only under a column it does not.
- **Names:** a party name counts in the text or in a cell.

Each Deep message has the same AI cost cap as in production: its price times
`max_ai_cost_ratio`. Recordings keep every call of a conversation, keyed on the whole
conversation, because every round of an item shares the same first message.

Migration 0071 sets the threshold at **0.90**. It was set before any run and was not moved.

### What the runs found

| Prompt | Professional | What failed |
|---|---|---|
| v1 | 0.650 (39/60), $0.47 | party answers never passed; arithmetic left to the reader; a unit after money; money columns production does not show as money; "not in the data" answered as off-topic |
| v2 | 0.883 (53/60), $0.47 | a month's figure cited from a year-to-date cell; "June 2025" written as text; an answer citing a query never run |
| v3 | **1.000 (60/60)**, $0.39 | — |

v3 on the other tiers: **Efficient 1.000 (60/60), $0.37** on the same model; **Expert 1.000 (60/60), $1.08** on Opus. Each tier is switched on by the gate from its own live run.

In more detail:

1. **Every party answer failed in production.** v1 told the model it could write `PARTY_…`
   tokens "as they appear". They contain hex digits, so the answer check refused every one, 12
   out of 12, even after the repair round. v2 has the model cite the cell that holds the party
   instead.
2. **The arithmetic was left to the customer.** Asked what changed in June, the model fetched
   two closing balances and wrote "the difference between these two figures", because it may not
   write digits. From v2 the figure is computed in SQL and cited as one cell. v3 adds: run
   another query when a result holds only the pieces, and check that the cited cell holds what
   was asked.
3. **Money shown wrongly.** The model wrote "`{{…}}` paise" after a cell that the page already
   formats as money. It also named money columns such as `total_overdue` and `ytd_june`, which
   production shows as raw paise. From v2, money aliases end in `_paise`, counts' aliases never
   do, and no unit is written after a money cell.
4. **Scope.** v1 called "sales in March", headcount and stock units off-topic. They are about
   these books, so they are in scope and answered with "the data does not show this". This is
   the same fix `chat_quick` v2 made.
5. **The tables misdescribed themselves.** A Deep session holds only closing balances, and an
   income or expense closing is the year to date, but the tables told the model it had opening,
   debit and credit columns. `SESSION_TABLES` now says those three are always null and what a
   closing means.

Two corrections were to the eval, not the model, and each is noted where it was made:

- The generated bills did not add up to the party balances. A test now holds them together.
- "Which indirect expense is the largest" was read, reasonably, as other expenses without
  salaries or depreciation. It now names the Indirect Expenses group. No threshold moved and no
  item was dropped.

### The price (R-42)

v3 costs **$0.0065 per question** at Professional: about ₹0.64 at the operating rate, against
99 credits. That is **0.65% of the price**. At Expert it costs $0.018, about ₹1.79, against
248 credits: 0.72%. Both are far under the 20% cap, so the price stands.

### The estimator (R-30)

The same recordings measured the estimator's constants without a single call; migration 0072
applies them:

- **Characters per token:** 2.00 to 2.76 across stages. The seed's 2.46 under-counted column and
  ledger mapping by 15–19%, so the setting is now 2.0.
- **Output per input:** 0.05 for sheet recognition up to 0.45 for commentary, against one seeded
  0.35. It is now per stage.

## Consequences

- `pnpm --filter @magicmis/ai go-live` now evaluates and switches on `chat_deep` like every
  other stage. Its runs use `runDeepEval`.
- A new Deep prompt is judged by the same 60 conversations and the same bar.
- Known limit: the model is never told the company's financial-year start (ADR 0035). A month's
  income or expense computed across a year boundary, such as April less March for an April year,
  would subtract the wrong month. None of the books cross one, and no question asks for it.

## Tests

- `packages/ai/test/evals.test.ts`:
  - the oracle scores 1.0000 through the real guard and DuckDB;
  - the scorer fails a money cell divided into rupees, and a count under a money-looking name;
  - the bills add up to the balances;
  - the dataset clears the 50-item floor.
