/**
 * The checks on a suggestion Claude wrote (ADR 0062).
 *
 * The model is allowed to have an opinion about what the board should do. It is not allowed to
 * have an opinion about a figure — every number in a suggestion has to be a placeholder the
 * engine fills from the books. These are the checks that hold it to that, and they run before
 * anything is stored or shown.
 */

import { describe, expect, it } from "vitest";

import {
  checkBoardActions,
  type BoardActionsInput,
  type BoardActionsOutput,
} from "../src/board-actions";

const input: BoardActionsInput = {
  factsPack: {
    period: "2026-04",
    facts: [
      { id: "m:revenue@2026-04", label: "Revenue", text: "₹1.20 Cr" },
      { id: "mv:receivables.mom@2026-04:pct", label: "Receivables MoM", text: "18.0%" },
    ],
    dimensions: [{ id: "d:PARTY_9f3a1c2e", label: "Largest customer" }],
    periods: ["p:2026-04"],
    warnings: [],
  },
  allowlist: [],
  maxActions: 5,
};

const action = (over: Partial<BoardActionsOutput["actions"][number]> = {}) => ({
  heading: "Collections are slipping",
  because: "Receivables rose {{mv:receivables.mom@2026-04:pct}} in {{p:2026-04}}.",
  todo: "Agree a chase list with the accounts team for the oldest balances.",
  urgency: "now" as const,
  ...over,
});

const out = (
  actions: BoardActionsOutput["actions"],
  summary = "One thing to fix and one to watch.",
): BoardActionsOutput => ({ summary, actions });

describe("suggestions the board can act on", () => {
  it("accepts one whose figures are placeholders over facts that exist", () => {
    expect(checkBoardActions(input, out([action()]))).toEqual([]);
  });

  it("refuses a figure the model wrote itself", () => {
    // The whole of locked decision 7 in one case: the model may say collections slipped, but the
    // amount by which they slipped is the engine's to compute.
    const problems = checkBoardActions(
      input,
      out([action({ because: "Receivables rose 18% in April." })]),
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("refuses a figure written as a word, and one in the action itself", () => {
    expect(
      checkBoardActions(input, out([action({ because: "Receivables rose 18 percent." })]))
        .length,
    ).toBeGreaterThan(0);
    expect(
      checkBoardActions(
        input,
        out([action({ todo: "Cut overheads by 10% before the next board." })]),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("refuses a placeholder for a fact this company does not have", () => {
    const problems = checkBoardActions(
      input,
      out([action({ because: "Stock is up {{m:inventory@2026-04}}." })]),
    );
    expect(problems.join(" ")).toContain("inventory");
  });

  it("checks the summary and the heading, not only the body", () => {
    expect(
      checkBoardActions(input, out([action()], "Revenue was ₹1.20 Cr.")).length,
    ).toBeGreaterThan(0);
    expect(
      checkBoardActions(input, out([action({ heading: "Debtors up 18%" })])).length,
    ).toBeGreaterThan(0);
  });

  it("refuses an observation with nothing to do, and more actions than were asked for", () => {
    expect(checkBoardActions(input, out([action({ todo: "   " })])).join(" ")).toContain(
      "not what to do",
    );
    const many = Array.from({ length: 6 }, () => action());
    expect(checkBoardActions({ ...input, maxActions: 3 }, out(many)).join(" ")).toContain(
      "asked for at most",
    );
  });
});
