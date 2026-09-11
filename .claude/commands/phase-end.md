---
name: phase-end
description: Close a build phase — verify, review, document, then stop for review.
argument-hint: [phase-number]
---

Close phase $ARGUMENTS, following SPEC §0.2 and §0.7.

1. **Green gate.** Run typecheck, lint and the full test suite. A phase is not complete
   while any of them fails. Report real output — if something fails, say so and fix it;
   do not close the phase around it.
2. **Review.** Run the `code-reviewer` agent over the phase diff. If this phase touched
   data, auth, billing or the AI layer, run `security-auditor` too. Resolve every
   CRITICAL before continuing.
3. **ADRs.** For every decision taken this phase, write `docs/adr/NNNN-title.md` —
   including **the documentation URL and verification date** for every external fact
   relied on (SPEC §0.4).
4. **Summary.** Append to `docs/plans/phase-$ARGUMENTS.md`:
   - what was built, and anything planned that was not built, with the reason
   - decisions taken, linked to their ADRs
   - every new dependency with one line of justification (SPEC §0.10)
   - **every `TODO(review)` raised this phase, listed out** (SPEC §0.6)
   - what phase $ARGUMENTS+1 now depends on
5. **Confirm the invariants still hold.** No business number hardcoded; no free path;
   no Claude-authored number reaching an output; no raw data leaving the browser; every
   new customer table has `account_id` and RLS.
6. Update `CLAUDE.md` — mark the phase done, set the next phase.
7. Commit in small conventional commits.
8. **Stop and wait for my review before starting the next phase.**
