import { checkTrialBalance, gateOutcome, type CheckResult } from "@magicmis/engine";
import type { PeriodId } from "@magicmis/core/time";
import { describe, expect, it } from "vitest";

import { applyNormalSides, deliverWithWarnings } from "../src/run";

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

describe("applyNormalSides (ADR 0031)", () => {
  const fact = (name: string, closing: bigint) => ({
    ledgerKey: name.toLowerCase(),
    name,
    groupPath: [],
    period: "2026-03" as PeriodId,
    opening: null,
    debit: null,
    credit: null,
    closing,
    source: { fileId: "f", sheet: "s", sourceRow: 2 },
  });
  const mapped = (ledgerKey: string, head: string) => ({
    ledgerKey,
    head,
    source: "global_exact" as const,
    confidence: "high" as const,
    needsReview: false,
    reason: null,
  });

  it("gives unsigned balances the side of the head they map to, and leaves stated sides alone", () => {
    const out = applyNormalSides(
      [fact("Sales", 5000n), fact("Rent", 2000n), fact("Capital", 900n)],
      [
        mapped("sales", "REV_PRODUCTS"),
        mapped("rent", "OPEX_RENT"),
        mapped("capital", "REV_PRODUCTS"),
      ],
      new Set(["sales|2026-03", "rent|2026-03"]),
    );
    expect(out.map((f) => f.closing)).toEqual([-5000n, 2000n, 900n]);
  });
});
