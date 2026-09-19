# ADR 0048: Three decisions left open by ADR 0047

**Status:** accepted · **Date:** 2026-09-19 · **Decided by** the product owner, who asked for the
best decision on each · **Closes** R-65 · **Extends** ADR
[0047](0047-files-kept-chosen-and-opened-by-nobody-unrecorded.md)

## 1. Kept files are capped, not priced (R-65)

Each company may keep `sources.max_company_bytes` of source files: 2 GiB as a seed, about two
hundred 10 MB day books, and an operator can raise it for a customer who needs more. An upload
that would pass it is refused with what to do about it; deleting a file gives its room back at
once. Files and settings shows what is used.

**Why a cap and not a price.** Stored bytes cost a small fraction of the monthly company memory
fee that already pays for holding a company's data (locked decision 12), so a storage price
would add a line to explain and meter for almost no money, while an uncapped store is a real
exposure: gross margin is the product's first property and one careless or hostile account
could grow without bound. If real storage cost ever says otherwise, the memory fee is where it
belongs, not a new meter. The cap is configuration, never a constant in code (SPEC §0.5).

## 2. A hidden month is hidden everywhere (closes the gap ADR 0047 listed)

ADR 0047 hid unticked files' months from the dashboard and from quick answers, and left Deep
questions and commentary reading them. That was a contradiction the customer would meet within
minutes — every box on the board now leads to the chat — so it is closed rather than explained:

- **Deep questions** query tables built without the hidden months, balances and bills alike.
- **Commentary** cannot be written for a hidden month (the month is not offered, and the server
  refuses it), and a commentary for a visible month never discusses a movement against a hidden
  one: it is built from the same filtered figures as the board.
- Anything that stops a commentary's input being built after its credits are held — a hidden
  month, no MIS for the month, nothing to discuss, an unreadable layout — now fails the job as
  ours and releases the hold at once. Two of those left a hold to lapse before.

The Excel workbook is still unaffected: it is a delivered file of the run that made it.

## 3. Legal sign-off cannot be decided here, so it is made short and hard to break

The terms, privacy notice and processing notice changed with retention. Whether the new wording
is acceptable is a lawyer's decision and stays one: the versions remain `-draft` (R-11, R-12,
R-63) and the launch gate is unchanged. What was decided is how to get there:

- **A review brief**, [docs/compliance/legal-review-brief.md](../compliance/legal-review-brief.md):
  the exact sentences, the fact behind each, where it is enforced, the five questions only a
  lawyer can answer, and the one-line change each possible "no" would need. Every fallback is
  configuration or a single migration, so no answer blocks on engineering.
- **The riskiest sentence is now a build failure.** "No member of our staff has a screen, tool
  or role that opens an uploaded file" is in the terms, so it is a contractual promise. It is
  true today because nothing staff-facing references the code that decrypts a file;
  `packages/jobs/test/no-staff-path.test.ts` fails the build the day that stops being so, and
  says to change the wording first rather than loosen the test. It also pins the read record's
  purposes, none of which is a person.

## Tests

- `packages/jobs/test/sources.test.ts` — the cap refuses past the limit to the byte, counts
  only what is stored now, frees room on deletion, and is per company.
- `packages/jobs/test/commentary.test.ts` — a hidden month is refused with the hold released,
  and written as usual once a file for it is ticked again.
- `packages/jobs/test/no-staff-path.test.ts` — the staff-access guard and the read record's
  purposes.
