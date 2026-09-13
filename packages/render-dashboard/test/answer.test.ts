import type { PeriodId } from "@magicmis/core/time";
import type { MetricValue } from "@magicmis/engine";
import { describe, expect, it } from "vitest";

import { renderAnswer } from "../src/answer";

const v = (
  metricId: string,
  value: string,
  unit: MetricValue["unit"] = "paise",
): MetricValue => ({
  metricId,
  period: "2026-05" as PeriodId,
  dims: {},
  value,
  nullReason: null,
  unit,
  formula: "",
  inputs: [],
});

const format = {
  money: (p: string) => `₹${p}p`,
  decimal: (x: string) => `${x}%`,
  period: (p: string) => `P${p}`,
  name: (t: string) => (t === "PARTY_1a2b3c4d5e6f" ? "Asha Traders" : null),
};
const query = {
  ref: "q1",
  sql: "SELECT ledger, closing_paise FROM balances",
  purpose: "largest debtor",
  tables: ["balances"],
  result: {
    status: "ok" as const,
    columns: ["ledger", "closing_paise"],
    rows: [["PARTY_1a2b3c4d5e6f", "900000"]],
  },
};

describe("renderAnswer", () => {
  it("substitutes metric, variance, period and query-cell placeholders with lineage", () => {
    const r = renderAnswer(
      [
        {
          text: "Revenue was {{m:revenue@2026-05}} ({{mv:revenue.mom@2026-05:pct}}) in {{p:2026-05}}; the largest debtor is {{q:q1:0:ledger}} at {{q:q1:0:closing_paise}}.",
        },
      ],
      [v("revenue", "1200"), v("revenue.mom_pct", "2.5", "percent")],
      [query],
      [],
      format,
    );
    if (!r.ok) throw new Error(r.problems.join("; "));
    const values = r.paragraphs[0]?.filter((s) => s.kind === "value");
    expect(values).toEqual([
      {
        kind: "value",
        display: "₹1200p",
        metricKey: "revenue@2026-05",
        queryRef: null,
        hint: null,
      },
      {
        kind: "value",
        display: "2.5%",
        metricKey: "revenue.mom_pct@2026-05",
        queryRef: null,
        hint: null,
      },
      { kind: "value", display: "P2026-05", metricKey: null, queryRef: null, hint: null },
      {
        kind: "value",
        display: "Asha Traders",
        metricKey: null,
        queryRef: "q1",
        hint: null,
      },
      { kind: "value", display: "₹900000p", metricKey: null, queryRef: "q1", hint: null },
    ]);
  });

  it("refuses digits, unknown metrics and query cells outside the result", () => {
    const check = (text: string) =>
      renderAnswer([{ text }], [v("revenue", "1")], [query], [], format).ok;
    expect(check("Revenue rose 12%.")).toBe(false);
    expect(check("{{m:ebitda@2026-05}}")).toBe(false);
    expect(check("{{q:q1:5:ledger}}")).toBe(false);
    expect(check("{{q:q2:0:ledger}}")).toBe(false);
    expect(check("{{q:q1:0:secret}}")).toBe(false);
    expect(check("Revenue was {{m:revenue@2026-05}}.")).toBe(true);
  });
});
