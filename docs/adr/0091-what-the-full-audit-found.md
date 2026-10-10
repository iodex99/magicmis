# 0091 — What the full audit found

- **Status:** accepted
- **Date:** 2026-10-11
- **Decided by:** the builder, on the product owner's instruction of 2026-10-11 to "go through the
  whole thing again and see for any issues or lapses or bottlenecks and fix them all, then see what
  can be enhanced and what can be done for a better user experience". Nothing here changes a locked
  decision. What would have is listed at the end, for the owner.
- **Builds on:** [0047](0047-files-kept-chosen-and-opened-by-nobody-unrecorded.md),
  [0057](0057-what-the-end-to-end-audit-found.md), [0069](0069-ledger-mapping-labelled-by-claude.md),
  [0071](0071-a-confirmation-opened-elsewhere.md), [0086](0086-what-a-customer-gets-back-to.md),
  [0090](0090-a-board-shared-by-a-link.md).

Six reviews ran over HEAD `68fcb4a`, read-only: correctness, security, performance, and three on
the experience (the board, the assistant, the public site and account flows; the run and batch
flows; everything around the board). Every finding was checked against the code before it was
changed. The ones fixed are below, grouped by what they cost a customer.

## Figures that were wrong

| Finding | Fix |
|---|---|
| **A corrected or back-dated month never reached the board.** A run's snapshot is stored under its last month but carries every month; the board, chat and the next run all preferred the snapshot of the *latest month*, so May's stale March beat the corrected March for good — and the run that added it was charged. | `boardMetricValues` and `mergeNewestFirst` (engine): the **run made last** speaks for every month it holds. The board, chat, commentary, where to act and the first dashboard all read through it. `jobSession` takes earlier balances from `newestSnapshotPeriod`, the ledger map too. |
| **A store's split figures were merged across runs.** A corrected debtors file that no longer listed a party had the party filled back in from the store it replaced. | A store owns a figure for a whole month, every split of it. |
| **The first month of a setup lost every opening-based figure after the next run.** Earlier months were rebuilt with no opening, and the earliest month has no month before it in the grid. | `PriorBalance` carries the stored movement; `priorFacts` sets opening = closing − movement, which gives the engine back exactly the movement it stored. |
| **Two balance reports for one month doubled every figure**, with the balance checks still green because each half balanced on its own — "TB Mar" and "TB Mar (revised)", two undated files given the same assumed month, a trial balance beside a group summary. | `prepare` counts a month once: a group summary beside a trial balance for the same month is set aside; where reports overlap, a ledger comes from the file added last. Reports covering different ledgers of one month (a trial balance split across sheets) are still read together. The run says what it set aside. |
| **Hiding a month left figures computed from it.** March's revenue is March's closing less February's; unticking February left it on the board. | `monthsBehind` adds the month before for every movement (not a P&L head in its year's first month) and follows a figure's metric inputs. |
| **A text file stopped at 8 MB**, mid-row and silently, while uploads allow far more. | `readCsvGrid` reads the whole file; the preview still reads 8 MB. |

## Charges that were wrong

| Finding | Fix |
|---|---|
| **A routine refresh was priced as a restructure, every month.** Setup with a debtors file, then a month with that month's trial balance alone, counted the missing file as change; and the fingerprints were stored only when the mapping rules changed, so it never stopped. | `compareFingerprints` judges only what this month brings, and only the sheets a run reads figures from: a known kind of file in a new layout, or a balance report of a kind never sent. `rememberFingerprints` keeps the earlier signature of a kind not brought, and the blueprint is written whenever they change. |
| **A fallback to a lower tier's model was charged at the higher price.** Nothing wrote the `delivered_tier` the capture read. | `deliveredTierOf` reads the recorded calls: a call that fell down the chain delivered the highest tier, no higher than the one sold, whose route for that stage uses the model that answered. Jobs and chat messages are captured at that tier's price, and a run says so. |
| **A delivered run could be reported as failed and free.** A failure in the bookkeeping after delivery reached the catch-all, which told a customer who had paid in full that nothing was charged and to try again. | Each step after `completeJob` is attempted and logged by name; none can fail the run. |
| **Two presses ran one job twice** — twice the model calls, each blind to the other's budget. | `claimRun`: a lease written in the statement that checks the state, released when the run returns. Deep step submission is a compare-and-swap, as `processMessage` was (ADR 0057). |
| **A failed card attempt left reconciliation**, so a captured retry on the same order with its webhook lost was never credited. | `reconcileRazorpayPurchases` scans `failed` purchases too. |

## AI calls on an unchanged refresh

| Finding | Fix |
|---|---|
| A ledger first seen in a refresh and declined by the model was never remembered, so every later refresh asked again (what ADR 0069 fixed for setup). | The blueprint is written when `acceptedUnmapped` changes. Only a ledger the model looked at and declined is settled: one it was never asked about, or whose answer an outage lost, is asked again next time. |
| A company whose export needs sheet classification paid for it on every refresh. | `PrepareGuidance.remembered`: a sheet layout the company's runs settled is placed by its signature, from the stored fingerprints, without asking. |

## Security

| Finding | Fix |
|---|---|
| **H1. A zip bomb reached SheetJS.** The guard summed declared sizes; SheetJS inflates every entry to its end, uncapped, in the web server. | `entriesKeepTheirWord` inflates every deflated entry, streaming and dropping the output, and refuses one that grows past its declared size; the counter's inflate is capped too. |
| **M1. Admin sign-in had no address throttle** before a 128 MiB scrypt, and an address off the IP allowlist could lock the owner out by typing their email. | `admin_login_per_ip` before any hashing; refusals for the allowlist or the throttle do not count toward the lockout. |
| **M2. A share link needed no password and told nobody.** | A fresh password check, as an export has (SPEC §8), and a `security.share_created` notice by email and in the inbox. |
| **M3. Two free endpoints decrypt whole files**: counting an upload, and chat's name lookup. | `files_per_account`; a counted upload answers `/complete` from its record. |
| L1–L2. `/s/` wrote a counter row per guess; links and their openings grew without bound, and the opening log was not append-only. | `share_per_ip` before `share_per_link`; `share.max_active_links` (20); the log revoked from every server role (migration 0085); links expired or withdrawn for `share.retention_days` (90) are purged with their openings. |
| L3. A suspended account's links kept working. | `openShare` requires an active account. |
| L4. Upload refusals reached the customer as "Something went wrong" — a `Response` stored inside `idempotent` became `{}`. | Refusals are data; `idempotent` throws on a `Response`. The size refusal says the limit. |
| L5. The year question handed out findings for free. | A stopped run returns no notices until it is charged; so does a quote. |
| L6. Deep's figure exemption let a piece of an identifier through. | A number whose digits sit inside a digit run of the session's text is withheld; only money columns pass the detectors as figures. |
| L7. A reset signed the owner into an account a stranger registered. | An account nobody has signed in to goes to the finish step (ADR 0071). |

## Performance

| Finding | Fix |
|---|---|
| Missing indexes: a chat message's AI cost (every message and Deep round), a job's workbook (polled every four seconds), the overview's workbook count, a hold's ledger rows. | Migration 0086; `report-indexes.test.ts` holds each. |
| ExcelJS and SheetJS — about 500 KB gzipped — shipped to the board, notes, Files and settings, the sample and every shared board, through one value imported from the engine's main entry. | `@magicmis/engine/client`: commentary checks, labels, value arithmetic and the stored value shape, and nothing that reaches DuckDB or a spreadsheet library. |
| ECharts' full build (370 KB gzipped) for bar and line charts. | `echarts-lite`: bar, line, grid, tooltip, legend, canvas. Charts draw without motion under reduced motion. |
| The workspace page decrypted every stored month to list the months, and the dashboard request beside it did it again. | `boardMonths` reads them from the files' record (ADR 0047); the dashboard's reads run side by side. |
| An HMAC per token mention; a quadratic search per trial-balance row. | Tokens remembered per run (the input, including its separator, unchanged); the next non-total row found once from the end. |
| The local store's gigabytes traced into every function. | `outputFileTracingExcludes`. |

Found and **not** fixed here, for a later change with its own tests: each run's store carries every
month, so readers merge up to 24 stores and the cost grows with the square of a company's history
(carrying forward what a run did not recompute, and reading the newest store alone, is the fix; R-77);
Deep chat and the name lookup re-read and re-prepare the latest run's files on every message
(store the session tables and the token map sealed at run completion); the company-key row lock is
held across the KMS unwrap; the commentary batch tick decrypts every queued job; the data export
reads a snapshot per period; email delivery holds a row lock across the provider call; and the
snapshot's ledger cap (200,000) is checked only after the workbook has been rendered.

## The experience

The three experience reviews were acted on area by area; what changed is in the commit that
carries them. The rule each followed: no price step (ADR 0033), running out of credits never loses
work (ADR 0049), copy for a reader anywhere (ADR 0081), and nothing free (locked decision 3).
The ones that change how something works, rather than what it says:

- **A run is followed, not trusted to its one response.** A dropped connection or a gateway
  timeout no longer says nothing was charged: the screen keeps reading the job and says the run is
  still finishing and will be emailed. The run page and the setup page find a run already working
  by its `claimRun` lease, and a quote or a year question still waiting, without `?job=`, so
  coming back never offers the uploader — or a second charge — beside a live run.
- **The price is on the button.** Build shows its credits, each tier shows its own, and the line
  under it gives the dashboard that follows; read from the price book through `priceFor`, never
  written in. No step was added (ADR 0033).
- **The last conversation comes back.** A `chat_thread` cookie, read by the server like the chat's
  other state (ADR 0044), reopens it; "New conversation" clears it. A failed message keeps its
  text and its idempotency key, so sending it again cannot charge twice, and a quote for where to
  act is accepted against where to act — it was being sent to the commentary endpoint.
- **"Kept off on purpose" is not "not placed yet."** Every run re-settles an accepted Unmapped, so
  the ledger map could never tell the owner's choice from a ledger nothing placed. `keptOff` on the
  mapping rules is optional, carried forward by `writeBack` while the ledger stays Unmapped, and
  read by nothing but the map: the cascade still reads `acceptedUnmapped` alone.
- **A pack's worth counts the dashboard.** `packWorth` prices a setup with its first dashboard and
  each month with its dashboard refresh and the memory fee, and `/pricing` and the Wallet now read
  the same function.
- **Help has a page.** `/contact` shows the support address from `legal.contacts` once the owner
  has set it, and says plainly what a customer can do meanwhile; the rail, the footer and every
  "contact support" message lead there.
- **A postal code is optional outside India**, which still requires its six-digit PIN; an invoice
  prints the city alone.

## For the owner

These would change a locked decision or a recorded one, so they were not made (R-88 to R-91):

- **Times in the reader's own time zone** (locked decision 14 says display IST). Every time is now
  labelled IST and dates are written so nobody can read them the other way round.
- **Following the operating system's light or dark setting** before a choice is made (ADR 0034
  reads only the `theme` cookie).
- **Real party names in the ledger map** (ADR 0086 shows tokens), which would be an opening on the
  record (ADR 0047).
- **A priced "rebuild from kept files" run**, so a ledger-map or convention fix reaches months
  already on the board without uploading again (a new action in the price book).
