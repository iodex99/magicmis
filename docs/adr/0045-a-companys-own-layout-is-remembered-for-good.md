# ADR 0045: A company's own tables and names are remembered for good

**Status:** accepted · **Date:** 2026-09-19 · **Decided by** the product owner · **Extends** SPEC
§24.2 (dashboard memory), §27 (`chat_edit`) and ADR [0033](0033-one-workspace-no-price-step.md)

## Context

The owner's requirement, in their words: _"the system remembers company wise renamed tables
forever. Every company that is added by the user can have different tables and may have
different names, so it has to remember that."_

Most of this was already true by construction. A company's layout — its MIS template (sheets,
sections, rows and their labels) and its dashboard (cards, titles, order) — lives in that
company's **blueprint**: versioned, append-only (the database refuses `update` and `delete`),
hash-chained, encrypted under the company's own data key, and scoped by `company_id`. Nothing
about a layout is stored per account or globally, so one company's names cannot reach another's.

But "forever" is a claim about every path that writes a blueprint, and reading those paths
found three ways a company's names could be lost without anyone deciding to lose them.

1. **Unreadable was treated as absent.** The session loader read the template with
   `safeParse(...).data ?? null`, and the dashboard reader returned `null` when the stored
   dashboard did not parse. "Null" is what a company with nothing saved looks like, so the run
   reached for the product's standard layout and the dashboard offered **Build the dashboard** —
   and either would then store the default as the next version, over every name the company had
   chosen. Any future schema change that stopped an old layout parsing would have done this
   silently to every company at once.
2. **The template's carry-forward lived in the caller.** `completeJob` carried the dashboard into
   a run's new blueprint version, but took the template from whoever called it. The run read the
   template when it started and wrote it back when it finished, minutes later. A row renamed in
   the chat while a run was in progress was written over by the run's older copy.
3. **Every blueprint write was read-modify-write with no check.** Each writer copies the parts it
   does not change from the version it read. Two writers a moment apart — a dashboard edit and a
   template edit, an edit and a run — and the second put back the first one's part as it was
   before.

## Decisions

### 1. Absent is null; present but unreadable is thrown

One module, `packages/jobs/src/stored-layout.ts`, reads a stored dashboard and a stored template,
and it is the only place that does. `null` means nothing is saved. Something saved that does not
parse throws `DashboardError("unreadable")`. Everything that **interprets** a layout goes through
it: the session loader (which renders the workbook from it), the dashboard, the template edits,
the commentary (which takes its sections from it) and the chat's layout edits.

What an unreadable layout now does, everywhere: **stops the action, changes nothing, charges
nothing.**

- A run fails as a platform fault when it loads the company, before any AI spend, and its hold
  is released.
- A paid dashboard job or commentary refuses, and is failed as ours so the hold is given back at
  once rather than when the reservation would have lapsed (`layout-fault.ts`). The default
  dashboard is only ever stored for a company that has none.
- A chat layout edit ends uncharged without calling the model.
- The dashboard API answers `layout_unreadable` with a message, and the page shows that message
  rather than the offer to build a new dashboard.

The saved version is untouched and immutable, so it can be recovered; the alternative destroyed
the only thing worth recovering. The schema paths that failed are logged (they contain structure,
not the company's data).

The chat's question-answering path loads the session with `layout: "skip"`: it needs keys and
conventions, not a layout, and a layout fault should not stop a question about figures.

**The one place that does not parse is the one that only copies.** The completion step carries
the layout into a run's new version exactly as stored. A copy loses nothing, even of a layout
that no longer parses; refusing there would fail a run after all of its AI spend, with the whole
cost absorbed and no workbook delivered — and would do so for every affected company at once.
The first version of this change parsed there; the review caught it.

### 2. The completion step keeps the layout, read at the moment of writing

`completeJob` takes `layout: "keep" | "replace"`, default `keep`. Under `keep` it reads the
newest blueprint **when it writes**, and carries that version's template, its materiality and
its dashboard into the new one; `blueprint.templateSpec` from the caller is only the layout of a
company that has none yet. `replace` is passed by exactly one action, recreating a reference MIS,
which is the customer asking for a new layout — and even then the dashboard is kept, and the
previous template remains in the version history.

Because the edit history (`editedFrom`, `parentVersion`) is inside what is carried, a rename can
still be undone any number of runs later.

### 3. A blueprint write says which version it was made from

`storeBlueprint` requires `basedOn`: the version the caller read, or `null` if it found none.
Inside the transaction it takes a per-company advisory lock, and refuses with
`BlueprintConflict` if the latest version is no longer that one. It is required rather than
optional so that no future writer can forget it.

- **Edits** (dashboard and template, from the controls or the chat) turn a conflict into the
  existing `stale` answer: reload and try again. An edit that was accepted is never lost; an edit
  that lost the race is told so. An edit reads **once**: the version it checked against
  `baseVersion`, computed the change from, and names as `basedOn` are the same read. Reading
  again to store would let a version that landed in between pass as the base, and `editedFrom`
  would then point undo at the wrong ancestor.
- **Paid jobs** (a run, a dashboard add-on or refresh) do not fail because someone renamed a card
  at the wrong moment: they read the newer version and write again on top of it.

## What "forever" covers, and what ends it

Remembered: through every monthly refresh, restructure, dashboard refresh, sign-out, and across
any number of other companies on the account, each with its own tables and its own names.

Ended only by the customer: renaming it again, undoing it, recreating the layout from a new
reference MIS, or deleting the company — which crypto-shreds its data key, as the privacy
promises require. There is no expiry on a layout.

## Tests

- `packages/engine/test/server.test.ts` — a write from a stale version is refused; of five
  simultaneous writers exactly one gets through and the chain still verifies; one company's
  versions do not count against another's.
- `packages/jobs/test/layout-memory.test.ts` — a renamed row and a renamed card survive two
  later runs that were each handed the pre-rename layout, and can still be undone afterwards;
  three companies on one account each keep their own; only `replace` replaces, and the dashboard
  stays; an unreadable dashboard stops a paid dashboard
  job with nothing stored, nothing charged and the hold released at once; a finishing run
  carries an unreadable template and dashboard through exactly as stored; a rename racing a
  finishing run is kept or refused, never accepted and lost. With the carry-forward switched
  off, three of these fail.
- `packages/jobs/test/commentary.test.ts` — an unreadable template stops a paid commentary before
  any AI call and releases the hold, where it used to be structured by the standard headings.
- `packages/chat/test/server.test.ts` — a layout edit against an unreadable dashboard fails
  uncharged with no call to the model.
- `apps/web/e2e/mis.spec.ts` — in the browser: a company with tables recreated from its own
  reference MIS renames a card, adds the next month (the workbook still has its own sheets),
  pays for the dashboard refresh, reloads — the name is there throughout — while the account's
  other company still shows the standard name. That run changes no mapping rules and so writes no
  blueprint: the browser test proves the reading side and the package tests the writing side.

Not covered by a test of its own: the run's early stop on an unreadable template. It is the shared
strict reader called from the session loader, which has no harness outside the browser tests, and
a browser test cannot corrupt a layout sealed under the company's key.

## Consequences

- The strict reader caught its own first bug: a month pattern that had lost its backslashes made
  every stored dashboard unreadable, and fourteen tests failed at once. Read leniently, the same
  mistake would have shown every customer "Build the dashboard".
- A schema change to the template or the dashboard must now come with a migration of stored
  layouts, or a reader that accepts the old shape. That was always true; it is now enforced
  rather than hidden.
- One advisory lock per blueprint write, held for the length of one insert.
