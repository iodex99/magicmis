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

`packages/ai/evals/deep.ts` drives each item as the server does:

- `chatDeepRound` for the model's turn;
- `guardSql` with the Deep figure rule (below);
- the production `chatTables`, `loadChatTables` and `runChatQuery` over DuckDB, with a real
  `Redactor`, for the rows.

It repeats until the model answers.

The books are the three synthetic fixture companies plus a fourth: the trading company scaled 35
times, so that its figures run to crores. Each is shaped as production shapes a Deep session:

- only closing balances;
- heads from the mapping cascade;
- party ledgers as tokens;
- pending bills that add up to the party balances;
- only the months a question names.

There are 63 items:

- 48 answerable questions: balances, a month's expense, sales, what customers and suppliers owe,
  the top debtor, the largest pending supplier bill, counts, and ageing;
- 10 off-topic questions, including injections;
- 5 about these books that the books cannot answer.

Every expected value is computed from the ledgers in code, never with SQL. An oracle run pushes
each item's own query through the real guard and DuckDB and must score 1.0000 in CI.

An answer is scored by what the customer would see:

- the scope must be right;
- money must match exactly, sign included, in a cell production shows as money
  (`isPaiseColumn`);
- a count must sit in a cell production does not show as money;
- a party is found in the text or a cell;
- an unanswerable question must cite no amount at all.

Each Deep message gets the production AI cost cap: its price times `max_ai_cost_ratio`. Migration
0071 sets the threshold at **0.90**, before any run, and it was not moved.

### What the runs found, in the product

1. **Every party answer failed.** v1 told the model to write `PARTY_…` tokens "as they appear".
   They contain hex digits, so the answer check refused every one, 12 of 12. The fix is to cite the
   cell that holds the party.
2. **The arithmetic was left to the customer.** Asked for a month, the model fetched two closing
   balances and wrote "the difference between these two figures". It cannot write digits.
3. **Money was shown wrongly.** "`{{…}}` paise" was written after a cell the page already formats.
   Money columns were named so production showed raw paise.
4. **Scope.** "Sales in March" was called off-topic when those months simply are not loaded. It is
   in scope, and the answer should say the data does not show it.
5. **The session tables misdescribed themselves.** They offered opening, debit and credit columns
   a Deep session never fills.

### What review found, after v3 scored 1.000

The code review of the first version found things the scores had hidden:

6. **A number the model typed could reach an answer (critical).** The guard accepted a query
   that reads no table. v1 ran `SELECT (-369578700) - (-208719400)`, copying two balances out of an
   earlier result, and cited the cell. That is locked decision 7 broken, with lineage that looks
   sound.
   - Fix: `guardSql` takes a `figures` rule on the Deep path. A query must read a session table,
     and any number above `DEEP_FREE_NUMBER` (1,000) must be one the customer typed
     (`typedNumbers` reads 5 lakh, 2.5 crore and 1,50,000 in rupees and in paise).
   - Enforced in the chat server and in the eval.
7. **Six to ten crore reached customers as `MOBILE_…` tokens.** The query runner redacted every
   cell. An amount in that range is ten digits in paise starting 6–9, which is the shape of an
   Indian mobile number.
   - Fix: a numeric cell now skips the identifier detectors unless its digits occur in the
     session's own text (`textDigitRuns`), so a number cast out of a ledger name is still redacted.
   - The crore book tests it.
8. **Answers naming another month were refused.** Production passes only the months a question
   names, and the answer check accepted only those.
   - Fix: a `{{p:YYYY-MM}}` placeholder is now accepted by its form, as the renderer already
     accepted it.
9. **The model did month arithmetic, and it breaks.** It was wrong across a financial-year
   boundary, where April less March subtracts a whole year. It was also wrong around a month the
   customer hid.
   - Fix: the session tables now carry `month_paise`, computed by `chatTables` with the company's
     own year start by the engine's rule. It is null when the month before is missing, so a year
     to date is never passed off as a month.
10. **The eval was generous.** A flat rent's first year to date equalled any month's figure. The
    scorer ignored sign. An unanswerable question could cite an invented amount.
    - Fix: all three are closed and tested.

### The runs

| Prompt | Dataset | Professional | Efficient | Expert |
|---|---|---|---|---|
| v1 | first | 0.650 (39/60) | — | — |
| v2 | first | 0.883 (53/60) | — | — |
| v3 | first, lenient | 1.000 | 1.000 | 1.000 |
| **v4** | **corrected, 63 items** | **0.984 (62/63), $0.35** | **1.000 (63/63), $0.32** | 41 of 41 correct, then the API account ran out of credit |

- **v4** tells the model to use `month_paise`, to show income and what is owed as positive
  figures, and never to type a figure from an earlier result.
- **Its one miss** was a sign slip: Professional negated a receivables total for one company,
  following "negate a credit balance" onto a debit. The next prompt should say which balances are
  already positive. It was not written into the repository, because it could not be measured.
- **Expert.** Its v4 run stopped at item 42 when the Anthropic account's credit ran out, so it is
  recorded at 0.651 and the gate refuses it. `go-live` evaluates it again with a funded key.

### The price (R-42)

Deep costs **$0.0056 a question** at Professional on v4: about ₹0.55 against 99 credits, or
**0.6% of the price**. v3 at Expert cost $0.018 a question against 248 credits, or 0.7%. Both are
far under the 20% cap, so the prices stand.

### The estimator (R-30)

The recordings measured the constants without a call. Migrations 0072 and 0073 apply them:

- **Characters per token** are now per stage: sheet recognition 2.7, commentary 2.2, column
  mapping and reference layout 2.0, ledger mapping 1.9, and 1.9 for anything not yet measured.
  The seed's 2.46 under-counted the mapping stages. A single figure of 2.0 would have
  over-counted sheet recognition by a third and quoted big setups early.
- **Output per input** is per stage, from 0.05 to 0.46, in place of one 0.35.
- 0073 merges into the current value, so an operator's own change is kept.

## Consequences

- `go-live` evaluates and switches on `chat_deep` like every other stage. Expert waits on a live
  run with credit behind it.
- The eval borrows `pipeline`'s chat code and `ingest`'s test DuckDB by path, because
  `pipeline` depends on `ai`. `packages/ai/turbo.json` declares those files as inputs, so a change
  to them reruns the AI tests instead of replaying a cached pass.
- **Known limits:**
  - The eval sends no facts pack, while production sends up to 40.
  - Every book's year starts in April.

## Tests

- **`packages/sql-guard`:** a table-less query and a copied figure are refused; typed thresholds
  in lakhs and crores are allowed.
- **`packages/pipeline`, `chat-figures.test.ts`:**
  - `month_paise` at the year's first month and across a missing month;
  - seventy-three crore is shown as a figure;
  - a number inside a ledger name is still redacted.
- **`packages/ai`:**
  - the oracle scores 1.0000 through the real guard, tables and redactor;
  - the scorer checks sign, and the rule that an unanswerable question cites no amount;
  - month items cannot be passed by any closing balance;
  - the crore book's figures have the mobile-number shape;
  - bills add up to balances;
  - the fixtures' fuzzy threshold matches the database;
  - per-stage estimator figures are read;
  - only the eval reaches `chatDeepRound`.
