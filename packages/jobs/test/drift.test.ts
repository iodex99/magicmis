/** A refresh is a restructure only when what this month brings has changed (ADR 0091). */

import { describe, expect, it } from "vitest";

import { compareFingerprints, rememberFingerprints } from "../src/drift";

const setup = { "bills_receivable:0": "BILLS", "trial_balance:0": "TB" };

describe("compareFingerprints", () => {
  it("does not count a file left out this month", () => {
    const drift = compareFingerprints(setup, { "trial_balance:0": "TB" }, "0.25");
    expect(drift).toMatchObject({
      matched: 1,
      added: 0,
      removed: 1,
      beyondThreshold: false,
    });
  });

  it("does not count a first debtors or payroll file", () => {
    const drift = compareFingerprints(
      { "trial_balance:0": "TB" },
      { "pay_sheet:0": "PAY", "trial_balance:0": "TB" },
      "0.25",
    );
    expect(drift.beyondThreshold).toBe(false);
  });

  it("counts a known kind of file in a new layout", () => {
    const drift = compareFingerprints(setup, { "trial_balance:0": "TB2" }, "0.25");
    expect(drift).toMatchObject({
      added: 1,
      changedDenominator: 1,
      beyondThreshold: true,
    });
  });

  it("does not judge a sheet nothing is read from", () => {
    const drift = compareFingerprints(
      { "generic:0": "NOTES", "trial_balance:0": "TB" },
      { "generic:0": "NOTES2", "trial_balance:0": "TB" },
      "0.25",
    );
    expect(drift).toMatchObject({ matched: 1, added: 0, beyondThreshold: false });
  });

  it("counts a balance report of a kind the company never sent", () => {
    const drift = compareFingerprints(
      { "trial_balance:0": "TB" },
      { "group_summary:0": "GS" },
      "0.25",
    );
    expect(drift.beyondThreshold).toBe(true);
  });
});

describe("rememberFingerprints", () => {
  it("keeps the earlier signature of a kind this run did not bring", () => {
    expect(rememberFingerprints(setup, { "trial_balance:0": "TB2" })).toEqual({
      "bills_receivable:0": "BILLS",
      "trial_balance:0": "TB2",
    });
  });
});
