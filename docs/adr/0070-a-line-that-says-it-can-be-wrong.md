# 0070 — A line that says it can be wrong

- **Status:** accepted
- **Date:** 2026-09-29
- **Decided by:** the product owner ("add a small disclaimer smartly in small font … magicmis can
  make mistakes please check for yourself")

## Context

Every figure is computed by the engine and never written by the model (locked decision 7), but
the product can still be wrong: a ledger placed under the wrong head, a sheet read as the wrong
kind, a sentence of commentary that frames a movement badly. The terms already say so at length,
and the workbook cover and commentary report say "requires professional review". Nothing said it
where the reader actually is.

## Decision

1. **One line, one definition.** `MistakesNote` in `components/ui.tsx` renders
   "Magic MIS can make mistakes." followed by what to do about it, in the small muted type the
   composer's credit note already uses. One component so the wording cannot drift between places.
2. **It always says what to do next, and usually that is to look.** On the board: "Open any figure
   to see the ledgers behind it" — the product's own answer, since every figure opens down to the
   rows it came from. In the chat composer: "Check anything important against your books." Under
   commentary: the figures are computed and the wording drafted, so check it before sharing it. On
   *Where to act*, appended to the existing "not tax, legal or audit advice": weigh each against
   what you know of the business. The commentary report's footer gains the sentence too.
3. **Not in Present.** Present is the accountant showing the board to their own client; there the
   accountant is the reviewer, and a line undermining them on their own screen helps nobody. The
   board hides the note while presenting, and the welcome spec asserts both states.

## Consequences

- The disclaimer is quiet by design: small, muted, one line, and never a banner or a dialog.
- A new place where the product speaks for itself should use `MistakesNote` rather than new words.
