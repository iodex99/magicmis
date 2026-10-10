# 0090 — A board shared by a link

- **Status:** accepted
- **Date:** 2026-10-10
- **Decided by:** the product owner, who answered ADR 0087 §17 with "we can have a share link".
  That amends **locked decision 2** (no shared access of any kind) and **SPEC §3** (no client
  portals or share links) for exactly what is described here and nothing wider. The decisions
  inside it are the builder's, and each is listed below so it can be changed.
- **Builds on:** [0046](0046-a-dashboard-built-by-chatting-and-presented-live.md),
  [0047](0047-files-kept-chosen-and-opened-by-nobody-unrecorded.md),
  [0048](0048-decisions-on-kept-files-cap-hidden-months-legal-brief.md),
  [0086](0086-what-a-customer-gets-back-to.md), [0087](0087-anyone-anywhere.md).

## What a link is

The board's **Share** button makes a link to a **read-only copy of the board as it stands now**,
as of the month on screen, for anyone who holds the link — no account, no sign-in — until it
expires or its owner withdraws it. With it, when the owner chooses, go the commentary and where to
act written for that month.

A reader sees what the sample company shows (ADR 0086): the boxes, Range, Compare, Present, and
every figure's working in its lineage. They get **no chat, no files, no workbooks, no ledger map,
no alerts, and nothing that changes the board**. Still not offered: a second login, a team, a
role, a client portal, or a link that edits anything — locked decision 2 holds for all of those.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Live board or copy | **A copy, frozen when the link is made** | What the owner looked at is what the reader sees. A later run, an unticked file or a box moved does not change a link already sent. |
| Which months | **Up to and including the month shared** | A March board sent in April shows March as its latest month. |
| How long | **The owner chooses; 30 days offered, 90 at most** (`share.default_days`, `share.max_days`, admin-editable) | Long enough for a board meeting cycle, short enough that a forgotten link lapses. |
| Withdrawing | **At once, from Files and settings** | A withdrawn, expired or wrong link shows the same 404 page, so a guess learns nothing. |
| Openings | **Every opening recorded before the board is decrypted**; the owner sees the count and the last time | The rule ADR 0047 set for files. Nothing about the reader is kept: there is no account to name. |
| Where it is kept | **Sealed under the company's own key** (purpose `share_snapshot`) | Deleting the company destroys every copy it shared, and the purge removes the rows. |
| The link's secret | **32 random bytes; only its SHA-256 is stored** | A database read cannot rebuild a link. The create route marks its answer as holding a secret, so the idempotency store keeps no copy, and a retried request is told the link was made rather than shown it. |
| What is left out of the copy | **The files behind it, the owner's alerts, and upload ids in each figure's lineage** | They are the owner's, and a reader has no file to open. Hidden months are already gone (ADR 0048). |
| Logos | **Carried inside the copy as data** | The page needs no request to anything of the account's. |
| A link opened in a loop | **`share_per_link`, 60 openings per rate-limit window, counted against the link's fingerprint** | Every opening unwraps the company's key and writes a row; past the limit the page says to try again shortly and decrypts nothing. |
| Charge | **None** | It shows figures and words already paid for, and asks nothing new of the engine or the model (locked decision 3 is about analysis, and this makes none). |
| Search and referrers | **`noindex`, `no-store`, `Referrer-Policy: no-referrer`** on `/s/` | The address is the key: it must not be cached, indexed, or sent on to a site the reader clicks to. |
| Phones | **The desktop-only message, as everywhere** | Locked decision 13 was not changed. A reader on a phone is asked to open it on a computer. |

## Built

- Migration 0084: `share_links` (the sealed board, the hash, the month, the dates) and
  `share_link_views` (append-only), both under forced row-level security through `app.owns`, the
  company referenced together with its account; and the two config keys.
- `packages/jobs/src/shares.ts`: make, list, withdraw and open, with tests against a real database
  for the secret not being stored, openings counted, and nothing opening once wrong, expired,
  withdrawn or its company deleted.
- `apps/web/src/lib/server/shares.ts` builds the copy from the owner's own payloads;
  `POST/GET/DELETE /api/companies/:id/shares`; the public page `/s/:token`; the **Share** drawer on
  the board; **Shared links** on Files and settings. The data export lists each link and every
  opening.
- A browser test makes a link, opens it in a browser with no session, checks the headers, finds the
  opening counted, withdraws it and gets the 404.

## Legal

The terms already make sharing an output the customer's act — "You are responsible for reviewing
every output before you rely on it, share it or issue it to anyone else" — and the privacy notice's
"we share information only with these service providers" is about us, not the customer. Nothing in
version 1.3 is contradicted, so it does not move. Whether the documents should name the feature is
listed for the legal review (R-87).
