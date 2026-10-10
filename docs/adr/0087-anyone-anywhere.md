# 0087 — Anyone, anywhere: prompts that assume no country, and the rest of the list

- **Status:** accepted
- **Date:** 2026-10-10
- **Decided by:** the product owner, who said the product is "not just restricted to india, or ca
  firms, any one can use it", then "yes now do everything" to the remaining items on the list of
  improvements, re-read for anyone anywhere. The decisions inside each item are the builder's.
- **Builds on:** [0030](0030-worldwide-two-currencies.md),
  [0034](0034-one-currency-boardroom-reports-dark-mode.md),
  [0035](0035-year-mismatch-commentary-report-chat-admin-dark.md),
  [0046](0046-a-dashboard-built-by-chatting-and-presented-live.md),
  [0062](0062-where-to-act.md), [0066](0066-a-limit-the-model-is-never-told.md),
  [0081](0081-the-words-every-market-types.md), [0086](0086-what-a-customer-gets-back-to.md).

Two of the eighteen items were not built, because each needs a locked decision changed: §17
says what each would take.

## 1. Prompts that assume no country

An audit after the owner's note found eight live prompts written for an Indian chartered
accountant: "an Indian MIS", "the CA", Tally named as the source, lakhs as the only scale. A
customer in Leeds or Austin was answered as if they were one. Every one now has a new version
whose first lines say who it serves — a company's owner, finance team or accountant — and one
sentence that holds for all of them:

> The company may be anywhere in the world and use any accounting system; do not assume a
> country, a tax system or a professional title unless the data shows one.

New versions: `sheet_classification` v3, `column_mapping` v2, `ledger_mapping` v2,
`reference_layout` v2, `commentary` v2 (then v4, §14), `chat_quick` v3, `chat_deep` v6 ("minor
units": a `_paise` column holds hundredths of the company's own currency) and `board_actions` v5
(which also carries §14's language; a v4 without it was drafted and never measured, so it was
deleted rather than left on disk). Nothing about what a prompt may output changed, and each has its own live eval
before it is switched on (ADR 0066).

**The evals were made to look like the world as well.** A score on Indian data says nothing about
a QuickBooks export from Ohio. The datasets now rotate each item's company through rupees in
lakhs, dollars in millions and pounds in full figures (`MARKETS`); `evals/global-sheets.ts` adds
eight synthetic US and UK sheets — trial balances, aged debtors and creditors, a payroll register
— labelled by construction and put first in sheet recognition; the ledger-mapping eval gains two
books written the way US and UK/Australian charts of accounts are (13 and 16 ledgers whose labels
were fixed before the run, as ADR 0069 requires, and four rows the rules already place removed,
because a ledger the rules catch is one the model never sees); `chat_quick` gains four questions
asked the way an owner outside India asks them; and commentary and where to act are asked in each
of the languages of §14 in turn.

| Stage | Version | Efficient | Professional | Expert | Bar |
|---|---|---|---|---|---|
| sheet_classification | v3 | 1.0000 | 1.0000 | 1.0000 | 0.95 |
| column_mapping | v2 | 0.9478 | 0.9079 | 0.9141 | 0.90 |
| ledger_mapping | v2 (125 items) | 0.9840 | 0.9920 | 0.9920 | 0.85 |
| reference_layout | v2 | 0.9714 | 0.9714 | 0.9714 | 0.85 |
| commentary | v2 | 1.0000 | 1.0000 | 1.0000 | 0.98 |
| chat_quick | v3 | 0.9333 | 1.0000 | 1.0000 | 0.92 |
| chat_deep | v6 | 0.9841 | 1.0000 | 0.9523 | 0.90 |
| board_actions | v5 | see §14 | | | 0.98 |

## 2. Files from anywhere are read

Two faults surfaced once the evals held non-Indian files. A header row whose period cells were
dates above the amounts (a QuickBooks "Jan 2026" column) was not recognised as a header, so the
sheet was read as having none: `periodHeading` now lets such a cell count as a label. And only the
rupee was stripped from amounts, so `$1,250.00`, `£ 980`, `1,250.00 USD` and the rest of the
world's money read as text: the currency pattern now takes the common symbols and ISO codes on
either side of the number. The security review found that pattern, and the Dr/Cr one beside it
that predates it, took time quadratic in a run of spaces — one crafted cell held a paid run until
it timed out, uncaptured — so both now match without the leading space and trim after; a test reads
a cell of a quarter of a million spaces well inside a second.

**Checked, and already right:** the United States writes dates month-first. Each date column is
read in the order its own values prove, and the company's `date_order` decides only when they are
ambiguous (ADR 0031); a company added from the United States is pre-filled month-first. CLAUDE.md
called the date order "a display choice only", which it has not been since ADR 0031, and now says
so.

## 3. The month picker offers every month

A first setup over thirteen months stores one snapshot holding all thirteen, and the picker listed
the months that had a snapshot — one — while the charts drew the rest. The board now offers every
month its figures cover (`insights.ts`), and so does the sample company.

## 4. The cash flow is on the board and in the chat

ADR 0086 put the cash flow in the workbook only. Its three totals and the net change are now in
the metric library, so a dashboard change, the first-dashboard choice and a question can use them;
the working-capital lines it is built from stay on their sheet (`onBoard: false`), because a board
of "(increase) in other current assets" helps nobody.

The library is part of what three stages are sent — the first board's layout, a dashboard or
template change in the chat, and a recreated reference MIS — so each was measured again on it, by
a process that loaded the new list. (The go-live run had started before the list changed and holds
its modules for the whole run, so its own figures for these stages do not count as that.)

| Stage | Version | Efficient | Professional | Expert | Bar |
|---|---|---|---|---|---|
| chat_edit | v4 | 1.0000 | 0.9814 | 0.9814 | 0.95 |
| dashboard_layout | v2 | 1.0000 | 1.0000 | 1.0000 | 0.95 |
| reference_layout | v2 | 0.9714 | 0.9714 | 0.9714 | 0.85 |

`chat_edit` first read 0.9629, 0.9444 and 0.9814 live, professional under its bar. Its recordings
showed why: two items asked for what the board already shows — the trend already runs from the
start of the financial year, and no box compares with anything — and both tiers answered, in
words, that nothing needed changing, which is the right answer (an in-scope edit with no
operations, ADR 0046). Both had been labelled with the pointer a change would touch, so the right
answer scored wrong and a redundant replace scored right. They are now labelled "no change", the
table is the live recordings replayed against them, and the one item the correction turned the
other way — expert "turning off" a comparison that was never on — counts against it.
Professional's remaining miss is real: it refused a previous-month comparison on the
working-capital table.

## 5. Statutory layouts

The workbook adds a balance sheet and a profit and loss in the layout the company's framework
uses, after the MIS sheets: **Schedule III** (India, Division I), the **Companies Act formats**
(UK, Format 1), a classified balance sheet and multi-step income statement under **US GAAP**, or
**IAS 1** (by nature) everywhere else. It is a reporting convention like the others: new
companies take it from their currency (rupees Schedule III, pounds the UK formats, dollars US GAAP,
anything else IFRS), existing companies were given the same default by migration 0081, the owner
can change it or choose none, and no run writes it.

Every line is a signed sum of canonical heads, written as SUMIFS over the Data sheet like every
other cell and held to V11; totals are cell arithmetic over the lines above them. Nothing is a
balancing figure: reserves (retained earnings, the profit and loss account) carry the year's
profit not yet closed into them — the closing balance of every profit-and-loss ledger — and
unmapped balances stand on the assets side in their own line, so the two sides agree exactly
whenever the trial balances balance. The tests hold all four layouts, on two fixture companies,
to HyperFormula, the V11 evaluator, sides that agree, and a profit line equal to the engine's PAT;
a property test holds the same on random books (shared with the cash flow's, ADR 0086) in every
month, the year to date included, in every layout. "Other" lines are a parent head less its named
children, so a ledger mapped to a parent is never dropped. A recreated MIS keeps its own sheet
names, and Excel compares names without case, so a statement whose name one of them already holds,
in any case, steps aside to "(2)" rather than failing every run of that company.

It is built in the renderer from heads, not as template sections bound to library metrics, for a
reason that matters to margin: the metric library is part of what four AI stages are sent, and
twenty new line metrics would have changed inputs that had just been measured. Each sheet's
subtitle says it is from the books, for management, not a filed statement. **TODO(review) R-86**
covers all four layouts' labels and grouping, which follow each published format but have not
been checked by a qualified reviewer; IFRS 18 replaces IAS 1's presentation from 2027.

## 6. The preparer's name and mark

Whoever prepares a company's MIS — accountant, bookkeeper, the company's own finance team — can
show their business name and logo beside the company's in Present and on the workbook's cover
(Settings, migration 0077). Off by default, because an owner presenting their own business is not
its preparer. The logo is sealed under the account's key, so erasing the account leaves it
unreadable, and the purge clears it.

## 7. Presenter notes

Present has a second screen, `/app/companies/:id/notes`, for the presenter's own display: it
follows the month the board is showing over a `BroadcastChannel` (same browser, nothing sent
anywhere) and shows where to act for that month first, then the commentary. Nothing on it reaches
the room's screen. Present itself is unchanged: still no `MistakesNote`, for the reason ADR 0070
gives.

## 8. The checks in plain words

Every run checks its figures a dozen ways, and the board said nothing about it. Under the month
picker the board now says, in a sentence, what passed — the books balance, every balance landed
somewhere, the months join — or what to look at when something did not (`check-words.ts`), read
from the snapshot's stored outcomes. A check's figure is never stored or shown (SPEC §9), so the
words carry none.

## 9. Help with the export, where it is needed

The run screen has "Which file do I export?", one answer per accounting system in the words its
public guide already uses, linking to that guide (`export-help.ts`). It names no menu path the
guides do not, so the two cannot drift.

## 10. An inbox

Every notice the worker emails is also in the app, newest first, with an unread count on the rail
(migration 0078). Each is rendered by the same template as its email — the templates moved from the
worker to `packages/jobs/src/notice-templates.ts` so both can — and sends its reader to the same
page. It is marked read by a POST once the page is on screen, up to the newest notice it showed,
never as a side effect of the page being fetched: any site can start a GET, and marking on render
let one clear the unread count, sign-in notices included, unseen. The POST takes a JSON body, so
another origin's form cannot send it without a preflight.

## 11. Alerts on a company's own figures

"Tell me when cash falls below this", "when debtor days go above that", set on Files and settings
(migration 0079, RLS through `app.owns`). They are checked when a run completes, against the
figures it has just computed — no model, no charge, so a refresh on unchanged structure still
makes no AI call — and the notice says how many fired, never a figure (SPEC §29). The board shows
which. Whether one fires is decided in one place (`render-dashboard/alerts.ts`), compared as the
engine stores values — integers for money, six decimal places otherwise, never a float, held by a
property test for each — so the notice and the board cannot disagree. The notice is sent only once
the board shows the month, because it sends its reader there to see which. The table ties each
alert to its company and that company's own account by one foreign key, the count of ten is taken
under a lock on the company, and a purged company takes none.

## 12. Pin a chat answer to the board

A quick answer that cites the engine's figures can be kept: "Pin to board" adds a comparison box
of those figures, this month against last. It is the board's own "add a box" — no model, no
charge, a new version Undo takes back — and it is not offered for a Deep answer, whose cells are a
query's and not the board's.

## 13. Every company at a glance, and month end for several at once

For anyone keeping several companies — clients, subsidiaries, a part-time finance director's
businesses — `/app` lists them with where each stands: due (its last month has closed without
figures), how its last run went, and how many of its latest checks failed, the companies due first.
One query, reading states and check outcomes only; nothing is decrypted to draw it.

`/app/batch` takes every company's files at once. Each file is matched to a company by its name
alone, compared with the company's name and the names of the files it was given before
(`batch-match.ts`), because nothing else may be known before upload: a file is sealed under its
company's key as it arrives. Nothing uploads until each file has a company the person confirmed.
Then each company runs in turn as its own priced job with its own hold; a short wallet is topped up
in place and the batch carries on, with the files already uploaded rather than a second copy, and
a quote or the year question is left on that company's page. A company any of whose files could
not be added stops before anything is held, naming them: a refresh on part of what the person
confirmed would be charged and look complete.

## 14. Commentary in the reader's language

A company can have its commentary and where to act written in English, Spanish, French, German,
Portuguese, Italian, Dutch, Arabic or Hindi (migration 0080, `commentary_language`). It is a
convention set on Files and settings. The model receives it as one line of the data, built from a
code the server chose from a fixed list — never text a customer typed — and the system prompt
(commentary v4, board_actions v5) says what to do with it. The figures are untouched: they are
placeholders the engine fills, and the placeholder check refuses any Unicode digit, Arabic-Indic
and Devanagari included. `urgency` stays a code in every language.

**Japanese and Chinese were built and withdrawn** on the code review's finding. Both also write
numbers as ideographs — 三百万, 百分之十二, 一か月 — which are letters to Unicode, not digits, and
which no check can tell from the same characters in ordinary words (一致, 一般). The live
recordings had the model writing 一 for "one month" in both, and the check passing it. A figure the
model wrote reaching the reader breaks locked decision 7, so they are not offered until that can be
checked.

The first measurement was not what it said. Commentary v3 still told the model to write
"management-report English" a few lines above the instruction to write in the named language, so
v4 says "management-report prose" and is the version switched on. And board_actions v5 had been
switched on by the go-live run, which loaded its dataset before the items were given a language:
all 162 of its recorded answers were English. Both were measured again in a fresh process, every
item in one of the nine languages in turn:

| Stage | Version | Efficient | Professional | Expert | Bar |
|---|---|---|---|---|---|
| commentary | v4 | 1.0000 | 1.0000 | 1.0000 | 0.98 |
| board_actions | v5 | 1.0000 | 1.0000 | 1.0000 | 0.98 |

## 15. The sample company, in the reader's own money

The sample (ADR 0086) is an invented business, so its currency is a label: a reader is now shown
it in the currency and grouping a company they added would start with — pounds in millions in
London, rupees in lakhs in Mumbai — with every figure the number the engine computed. Its words
were recorded through the India-framed prompts and said "the CA"; it was recorded again through the
new ones (commentary v4, board_actions v5, at Professional) and now asks "the finance team" and "the
accountant", and a test fails if its text names a rupee, a lakh, GST or a CA. Its month picker
offers all thirteen months, as a company's own board now does (§3).

## Reviews

A security audit and a code review read the whole change before it was committed. The audit found
nothing above low; every low finding was fixed and is described where it belongs above: the
quadratic amount pattern (§2), the inbox marked read by a GET (§10), alerts on a purged company,
the cap under parallel requests and the account–company pair (§11), and batch re-uploads and
deleted files steering matches (§13). The data export now carries the alerts, the preparer setting
and the new conventions. The code review found two things that blocked: Japanese and Chinese
numerals passing the figure check (§14), and the sample not yet recorded again (§15). It also found
the measurements that were not what they claimed (§4, §14), the case-blind sheet-name clash (§5)
and the batch charging on part of its files (§13), all fixed, and asked for property tests for the
statements and the alerts, which were added.

## 16. Migrations

0077 preparer brand · 0078 inbox read state · 0079 company alerts · 0080 commentary language ·
0081 statutory layout.

## 17. Not built: two items that need a locked decision changed

- **A client keeps a copy, or a link to share** (item 16). Locked decision 1 and §3 rule out client
  portals and share links, and ADR 0046 removed every export of the board and the commentary.
  Building it means amending both: deciding what a recipient may see (a frozen snapshot, not a live
  board), how long a link lives, whether opening one is on the owner's record the way a file's
  opening is (ADR 0047), and whether it may carry the preparer's mark.
- **Staff logins** (item 18). Locked decision 2 is one login per account with no team members,
  roles or shared access, and the database rules forbid any table that implies one. A firm with
  staff would need accounts that act for another account, roles, an audit trail per person, and a
  session rule other than "a new login ends the previous one". That is a different product
  boundary, and the owner's to draw.

## Sources

No external API was used for anything new here. The statutory layouts follow: the Companies Act
2013, Schedule III, Division I; the Large and Medium-sized Companies and Groups (Accounts and
Reports) Regulations 2008 (SI 2008/410), Schedule 1, Formats 1; the FASB Codification topics
210 and 225 for a classified balance sheet and income statement; and IAS 1 paragraphs 54, 82 and
102. Each is marked for review (R-86).
