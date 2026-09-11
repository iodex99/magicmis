---
name: phase-start
description: Begin a build phase — write the plan, then wait for approval.
argument-hint: [phase-number]
---

Begin phase $ARGUMENTS, following SPEC §0.2.

1. Read `docs/SPEC.md` §34 for phase $ARGUMENTS's scope, including its **Acceptance**
   line — that is the phase's exit condition.
2. Read `CLAUDE.md`, the previous phase's summary, and every ADR that bears on this work.
3. Identify every external fact this phase depends on — Anthropic API shapes, model IDs
   and prices, Supabase regions and features, Razorpay endpoints and webhook events,
   SheetJS / DuckDB-WASM / ExcelJS / ECharts APIs, GST rules. List them as things to
   **verify against official documentation before implementing** (SPEC §0.4).
4. Write `docs/plans/phase-$ARGUMENTS.md`:
   - tasks, in dependency order
   - files to be created or changed, by path
   - tests to be written, naming the property and concurrency tests explicitly
   - external facts to verify, each with the doc URL you will check
   - new dependencies proposed, each with one line of justification
   - open questions for me
   - which locked decisions (SPEC §2) this phase touches, and how each is upheld
5. Update the **Current phase** section of `CLAUDE.md`.
6. Then build it. SPEC §0.2 and §34 put the review gate at the **end** of a phase, not
   after the plan — so do not stop here. Stop at `/phase-end $ARGUMENTS`.

   The exception: if the plan surfaces a conflict with a locked decision (SPEC §2),
   stop and ask. §0.3 forbids working around one silently.
