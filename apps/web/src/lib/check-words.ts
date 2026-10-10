/**
 * The engine's checks in plain words (ADR 0087).
 *
 * Every run checks its figures a dozen ways before anything is delivered (SPEC §21), and until now
 * the board said nothing about it: the evidence that the books balance and every balance landed
 * somewhere was on the workbook's Checks sheet, as V-numbers. These are the sentences a reader
 * can trust a board by — what was proved when it passed, and what to look at when it did not.
 */

export type CheckWords = { readonly passed: string; readonly look: string };

export const CHECK_WORDS: Readonly<Record<string, CheckWords>> = {
  V1: {
    passed: "Every balance in the files is on a line of the MIS",
    look: "Some balances could not be placed on a line and are shown as Unmapped",
  },
  V2: {
    passed: "The MIS totals match the statements in the files",
    look: "The MIS totals differ from the statements in the files",
  },
  V3: {
    passed: "The trial balance balances: debits equal credits",
    look: "The trial balance does not balance",
  },
  V4: {
    passed: "Every group total in the files equals the ledgers under it",
    look: "A group total in the files differs from the ledgers under it",
  },
  V5: {
    passed: "The balance sheet balances",
    look: "The balance sheet does not balance",
  },
  V6: {
    passed: "Profit agrees with the profit and loss in the files",
    look: "Profit differs from the profit and loss in the files",
  },
  V7: {
    passed:
      "Earlier months are as they were last reported, and this one carries on from them",
    look: "An earlier month has changed since it was last reported",
  },
  V8: {
    passed: "Every month expected is here, and none twice",
    look: "A month is missing or was loaded twice",
  },
  V9: {
    passed: "No transaction appears in two files",
    look: "The same transaction appears in more than one file",
  },
  V10: {
    passed: "Every line runs in its usual direction",
    look: "A line runs against its usual direction, such as cash below nothing",
  },
  V11: {
    passed: "Every formula in the workbook recalculates to the figure shown",
    look: "A workbook formula does not recalculate to the figure shown",
  },
};

export interface CheckSummary {
  readonly id: string;
  readonly status: "pass" | "fail" | "not_applicable";
  readonly severity: "blocking" | "warning";
}

/** What a reader sees: the passes and the things to look at, each in words, in the engine's order. */
export function checkLines(checks: readonly CheckSummary[]): {
  passed: string[];
  look: { id: string; text: string }[];
} {
  const order = (id: string) => Number.parseInt(id.replace(/^V/u, ""), 10);
  const known = [...checks]
    .filter((c) => CHECK_WORDS[c.id] !== undefined && c.status !== "not_applicable")
    .sort((a, b) => order(a.id) - order(b.id));
  return {
    passed: known
      .filter((c) => c.status === "pass")
      .map((c) => CHECK_WORDS[c.id]?.passed ?? c.id),
    look: known
      .filter((c) => c.status === "fail")
      .map((c) => ({ id: c.id, text: CHECK_WORDS[c.id]?.look ?? c.id })),
  };
}
