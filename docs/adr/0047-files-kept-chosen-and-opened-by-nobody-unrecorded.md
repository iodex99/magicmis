# ADR 0047: Add a file; files kept, chosen for the dashboard, and opened by nobody unrecorded

**Status:** accepted · **Date:** 2026-09-19 · **Decided by** the product owner · **Amends** ADR
[0032](0032-server-side-processing.md) (retention) and ADR
[0033](0033-one-workspace-no-price-step.md) (what is on the workspace) · **Extends** ADR
[0046](0046-a-dashboard-built-by-chatting-and-presented-live.md)

## Context

The owner, in their words:

1. _"Instead of saying 'add a month' we can say 'add a file'. The file automatically gets read
   and processed … and gets updated on the dashboard. Now we give the user to choose (like
   tickboxes for the uploaded file), meaning data from only the ticked files will be shown on
   the dashboard. The adding files steps can be removed (additional ones): once a file is
   uploaded and a button is clicked it gets processed by the AI. Also we need to store every
   file (make provision for that), but we shouldn't have access to it; we need to convince
   people that we don't have access and the files are encrypted and we can't read it, only they
   can read it through their account."_
2. _"All the boxes on the dashboard shall have CTA, as we have 'investigate' button; it should
   be everywhere."_
3. _"Other than the actual necessary boxes, the actual presentable data, every other box like
   workbooks, activity etc shall be clubbed and moved somewhere, easily accessible but not on
   dashboard. The reporting convention box can be moved up and can be laid out in a much better
   way."_

## Decisions

### 1. "Add a file", one button, and the dashboard follows

The rail, the workspace header, the company list and the run page say **Add a file**. The run
page lost its three-step indicator and is one screen: a drop zone and one button. The button
reads the files, builds the workbook and **puts the figures on the dashboard**.

Until now a run delivered a workbook and the dashboard then offered a second paid button — Build
the first time, Refresh after — to let the new month in. **That second press is removed; its
charge is not.** `bringDashboardUpToDate` runs after a completed run and delivers
`dashboard_addon` (first time) or `dashboard_refresh` through the same held-and-captured path as
when the customer pressed it, at the price-book price. Locked decisions 3 and 5 stand: nothing
is delivered without a captured charge, and no price is hardcoded. The run's receipt lists the
dashboard's charge beside the run's own.

**Every completed run refreshes the board and is charged for it**, whether or not the latest
month moved: a back-dated file puts new figures on the board just as a new month does, and
treating "the latest month is unchanged" as "nothing to do" delivered them uncharged (the review
found this; it predates this change but "add a file" makes it routine). A retried run resumes
the dashboard job it already has rather than deciding afresh, and whatever stops it after the
credits are held fails that job as ours, releasing them at once.

It never fails the run. A workbook that was delivered and charged stays delivered: if the wallet
cannot cover the dashboard, or anything else stops it, the dashboard keeps the month it had and
shows its own Refresh, exactly as before. If the owner wants the dashboard bundled into the
run's price, that is a price-book change, not a code change.

### 2. Files are kept

`sources.retention_days` is now `0`, which means **no expiry**: a file stays until its owner
deletes it or deletes the company. The key is unchanged so an operator who must set a period
can, and the purge still honours one. Files already held lost their expiry too.

This reverses the retention half of ADR 0032 and touches what locked decision 8 (as amended)
says about purging, so the privacy notice and the processing notice changed and their versions
moved (`1.2-draft`), and so did the terms', whose security clause promised deletion "on a fixed
schedule": every account accepts the new processing notice before its next upload.
The published pages read the setting and say whichever is true. Legal sign-off on the new
wording is outstanding (R-11, R-12, R-63).

"Data Vault" is on SPEC §3's out-of-scope list. This is not that: there is no browsing, search,
sharing or versioning of documents — only the files a company's MIS was built from, kept where
they already were.

### 3. "We can't read it": what is claimed, and what is not

The owner asked for customers to be convinced that we have no access and cannot read their
files. **The second half cannot be claimed truthfully, and is not.** Files are processed on the
server (ADR 0032), so the service must be able to decrypt one to run it; "we cannot read your
files" is true only of a design where the customer holds the key, and that design cannot
compute an MIS on the server. A false security claim to accounting firms is a liability, not a
selling point.

What is true, and is what the product now says everywhere:

- Each file is sealed under its company's own key **before** it is stored. Storage holds
  ciphertext.
- **No person on our side can open one.** There is no screen, tool or staff role that reads an
  uploaded file. This was checked, not assumed: nothing in the admin console or the worker
  references uploads or their bytes, and the admin break-glass view (ADR 0025) opens computed
  MIS data only, never a file.
- A file is decrypted only in memory, by a run or a question its owner starts, or by the owner's
  own download.
- Deleting a company destroys its key, which leaves everything sealed under it unreadable — to
  us as well.

And one thing was **built** so that the claim can be checked rather than believed:
`source_upload_reads`. Every decryption writes a row first — which file, when, and why
(`intake`, `pricing`, `run`, `chat`, `download`). The table is append-only at the database, its
`purpose` has no value for a member of staff because no such path exists, and the customer sees
it beside each file: "Opened 4 times · last for a run you started". "Only they can read it
through their account" is also made literal: the owner can download any file back, byte for
byte, and that too is on the record. **A session alone does not take a file out**: like the
account data export (SPEC §8) a download needs the password confirmed afresh and is rate
limited per account, because raw client books are the most sensitive thing the service holds
and no route could hand them over before this one. Asking whether a download is allowed
decrypts nothing, so the record holds only real downloads.

The claim names every reason a file is opened — counting its sheets on arrival, sizing and
running a run, answering a question, the owner's download — because the record beside it does,
and a claim shorter than its own evidence reads as a lie.

A design in which we genuinely could not decrypt (a key derived from the customer's password,
released to the server only while they are signed in) was considered and not built: a forgotten
password would destroy the company's data, Google or Apple sign-in has no password to derive
from, and scheduled work could not run. It is the honest route to the stronger claim if the
owner wants it, and it is a product decision with those costs, not a wording change.

### 4. Ticking files on and off the dashboard

A run records which months each file fed (`source_uploads.periods`, from the pipeline's own
per-report provenance). Each file has a tick (`on_dashboard`). The dashboard leaves out the
months fed **only** by unticked files: a month any ticked file vouches for stays, and so does a
month no stored file accounts for — there is no tick to honour.

Hiding a month is not only dropping its figures. `visibleValues` (engine) shows a figure only if
**no month it was computed from is hidden**: May's change on a hidden April goes, and so does a
year-to-date total that includes April (a year-to-date names only its end month as an input, so
the rule walks the financial year). Left in, they would state something about data the customer
asked not to see and can no longer check. Formulas (ADR 0046) are evaluated after the filter, so
they follow.

**Deleting a file does not change what is hidden.** The bytes go; the row, its months and its
tick stay, and the dashboard still lists it (as deleted) so its months can be shown again on
purpose. Otherwise unticking a bad April and then deleting it to be safe would bring April's
figures back with no file left to check them against. With every file unticked the board says
so and offers the files list; it does not try to chart an empty month.

**The chat follows the same rule.** `companyMetricValues` applies the same filter, so a quick
answer never quotes a month, or a change on a month, that the board beside it has left out.

**Nothing is recomputed, deleted or charged.** The stored figures are exact and stay; ticking
the file again brings every one back. It is a view filter over figures already paid for, like a
layout edit (SPEC §24.2), so it is free. The ticks live in the dashboard's toolbar (**Files**,
"13 of 14") and on Files and settings; when months are hidden the board says which and why.

The Excel workbook is not affected: it is a delivered file, built from the run that made it.

### 5. Every box leads to the chat

Every box, not only the KPI cards, ends in two actions: **Investigate** (a Deep question about
why its figures moved, naming up to three of them) and **Change** (opens Build with
`Change the "…" box:` written). Both only write the message; nothing is sent or charged until
the customer presses send. They are hidden while presenting and while editing the layout.

### 6. The workspace is the board; the rest has its own page

The workspace now holds the dashboard and the chat and nothing else. **Files and settings**
(`/app/companies/:id/manage`), reached from the workspace header and the rail, holds in order:
reporting conventions, the files, workbooks, activity and charges, delete company. ADR 0033's
"no separate tabs" was about not splitting the *work* (dashboard, chat, commentary) across pages;
it still is not.

Reporting conventions moved to the top of that page and are laid out as four settings that each
show, live, what the current choice does — "Your year runs April to March", "1,234,567.89 is
shown as ₹12,34,567.89", "03/04 in a file is read as 3 April" — because a setting nobody can
picture is a setting left wrong, and the financial year is the one that bites (ADR 0035). On a
company not yet set up they are shown open, above the fold, before the first build.

## Tests

- `packages/jobs/test/sources.test.ts` — a file however old is not purged; an operator's period
  still purges; a deleted company's ciphertext is still cleared; every read is logged with its
  purpose, a refused cross-account read logs nothing, `'staff'` is not a purpose the database
  accepts, and the log refuses update and delete; a month is hidden only when every file that
  fed it is unticked, per company, and another account cannot tick a file.
- `packages/engine/test/visible.test.ts` — hiding a month hides its changes and the year-to-date
  totals that include it, in April and January financial years, and unhiding restores all.
- `apps/web/e2e/mis.spec.ts` — one press charges the run and the dashboard separately and the
  board shows the new month with no Build or Refresh button; every box has both actions and they
  write the right message in the right mode; unticking May's file removes May from the board and
  says so, survives a reload, changes no snapshot and no balance, and ticking restores it; the
  workspace no longer carries the moved panels; Files and settings shows live convention
  examples, workbooks and activity; the owner's download equals the uploaded bytes and appears in
  the file's record; no read has a purpose outside the five; nothing has an expiry.
- `apps/web/e2e/privacy.spec.ts` — another account can neither download nor tick a file.

## Known and left

- ~~Deep questions and commentary still read hidden months.~~ Closed by ADR 0048: a hidden
  month is hidden everywhere.
- **The read log is not in the account data export yet**, and the processing register now
  describes it. **R-66.**
- A year-to-date figure is hidden when its own end month is hidden even where it does not
  depend on it (`ly_ytd`). Over-hiding, the safe direction.

## Consequences

- Storage now grows without bound per company. There is no quota yet; the memory fee (locked
  decision 12) is the natural place to price it. **R-65.**
- The legal notices changed ahead of legal review. **R-11, R-12, R-63** now cover "kept until
  deleted" and the staff-access statement; a data-protection review (R-50) should read this ADR.
- A customer's first setup now charges the run and the dashboard add-on in one press. The
  receipt says so; the price book still sets both.
- `loadUploadBytes` requires a purpose. A new reader of files cannot forget to be on the record.
