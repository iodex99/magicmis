import { checkTrialBalance, gateOutcome, type CheckResult } from "@magicmis/engine";
import type { PeriodId } from "@magicmis/core/time";
import { describe, expect, it } from "vitest";

import { deliverWithWarnings } from "../src/run";

describe("deliverWithWarnings (ADR 0031)", () => {
  it("turns a data problem into a warning, so the workbook is still delivered", () => {
    const unbalanced = checkTrialBalance(
      [
        {
          ledgerKey: "cash",
          name: "Cash",
          groupPath: [],
          period: "2026-03" as PeriodId,
          opening: null,
          debit: null,
          credit: null,
          closing: 100_00n,
          source: { fileId: "f", sheet: "s", sourceRow: 2 },
        },
      ],
      0n,
    );
    expect(unbalanced).toMatchObject({ status: "fail", severity: "blocking" });
    const [delivered] = deliverWithWarnings([unbalanced]);
    expect(delivered).toMatchObject({
      id: "V3",
      status: "fail",
      severity: "warning",
      message: unbalanced.message,
    });
    expect(gateOutcome(deliverWithWarnings([unbalanced]))).toEqual({ ok: true });
  });

  it("still blocks our own faults", () => {
    const ours: CheckResult = {
      id: "V1",
      status: "fail",
      severity: "blocking",
      failureClass: "platform_fault",
      message: "Some source balances did not reach any MIS head.",
      fix: "",
      amounts: {},
      details: [],
    };
    expect(gateOutcome(deliverWithWarnings([ours]))).toMatchObject({
      ok: false,
      failureClass: "platform_fault",
    });
  });
});
