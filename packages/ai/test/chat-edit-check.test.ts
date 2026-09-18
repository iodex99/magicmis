/**
 * ADR 0046: what the chat may and may not put on a dashboard. The check is what sends the model
 * back for its one repair, so it is where "the model never writes a figure" is held for layout
 * changes. Pure: no database, no transport.
 */

import { DEFAULT_DASHBOARD } from "@magicmis/render-dashboard";
import { METRIC_CATALOG } from "@magicmis/templates";
import { describe, expect, it } from "vitest";

import { chatEditStageSpec, type ChatEditOutput } from "../src/chat-stages";

const metrics = METRIC_CATALOG.map((m) => ({ id: m.id, label: m.label, unit: m.unit }));
const input = (request: string) => ({
  target: "dashboard" as const,
  spec: DEFAULT_DASHBOARD,
  metrics,
  summary: null,
  history: [],
  request,
});
const add = (path: string, value: unknown): ChatEditOutput["operations"][number] => ({
  op: "add",
  path,
  from: null,
  value_json: JSON.stringify(value),
});
const proposal = (
  operations: ChatEditOutput["operations"],
  summary = "Adds a box.",
): ChatEditOutput => ({ scope: "in_scope", summary, operations });
const check = (request: string, out: ChatEditOutput) =>
  chatEditStageSpec.check?.(input(request), out) ?? [];

const box = (over: Record<string, unknown>) => ({
  id: "cmp_sales",
  kind: "comparison",
  title: "Sales against last year",
  metrics: ["revenue", "gross_profit"],
  dimension: null,
  periods: { kind: "current" },
  layout: { x: 0, y: 10, w: 6, h: 4 },
  drilldown: { kind: "lineage" },
  compare: "last_year",
  ...over,
});
const formula = (expr: unknown, over: Record<string, unknown> = {}) => ({
  id: "calc_staff_share",
  label: "Staff cost share",
  unit: "percent",
  expr,
  ...over,
});
const share = {
  op: "mul",
  args: [
    { op: "div", args: [{ metric: "employee_cost" }, { metric: "revenue" }] },
    { const: "100" },
  ],
};

describe("what the chat may put on a dashboard", () => {
  it("a comparison box, a trend against last year, and a formula shown in a card", () => {
    expect(
      check("compare sales with last year", proposal([add("/widgets/-", box({}))])),
    ).toEqual([]);
    expect(
      check(
        "show staff cost as a share of revenue",
        proposal([
          add("/calculated/-", formula(share)),
          add(
            "/widgets/-",
            box({
              id: "kpi_staff_share",
              kind: "kpi_card",
              title: "Staff cost share",
              metrics: ["calc_staff_share", "calc_staff_share.mom_abs"],
              compare: "none",
              layout: { x: 0, y: 10, w: 3, h: 2 },
            }),
          ),
        ]),
      ),
    ).toEqual([]);
  });

  it("not a metric nothing computes, in a box or inside a formula", () => {
    expect(
      check(
        "add headcount",
        proposal([add("/widgets/-", box({ metrics: ["headcount"] }))]),
      ),
    ).toEqual([expect.stringContaining("metric headcount is not allowed")]);
    expect(
      check(
        "revenue per head",
        proposal([
          add(
            "/calculated/-",
            formula({
              op: "div",
              args: [{ metric: "revenue" }, { metric: "headcount" }],
            }),
          ),
        ]),
      ),
    ).toEqual([expect.stringContaining("metric headcount is not allowed")]);
    // A formula's id in a box, with no formula behind it.
    expect(
      check("x", proposal([add("/widgets/-", box({ metrics: ["calc_nowhere"] }))])).join(
        " ",
      ),
    ).toContain("no formula");
  });

  it("not a figure in a title or a label, unless the customer typed those digits", () => {
    const titled = (title: string) => proposal([add("/widgets/-", box({ title }))]);
    expect(check("add a sales box", titled("Sales of 7.4 crore"))).toEqual([
      expect.stringContaining("only digits the customer typed"),
    ]);
    expect(check("call it FY 2026 sales", titled("FY 2026 sales"))).toEqual([]);
    expect(
      check(
        "rename the first card",
        proposal([
          { op: "replace", path: "/widgets/0/title", from: null, value_json: '"Top 5"' },
        ]),
      ),
    ).toEqual([expect.stringContaining("only digits the customer typed")]);
    expect(
      check(
        "staff share",
        proposal([add("/calculated/-", formula(share, { label: "Share 25" }))]),
      ),
    ).toEqual([expect.stringContaining("only digits the customer typed")]);
    expect(
      check("add a box", proposal([add("/widgets/-", box({}))], "Adds 1 box.")),
    ).toEqual(["summary: must not contain digits"]);
  });

  it("not a number of its own inside a formula: structural constants and the customer's only", () => {
    const less = (c: string) =>
      proposal([
        add(
          "/calculated/-",
          formula(
            { op: "sub", args: [{ metric: "revenue" }, { const: c }] },
            { unit: "money" },
          ),
        ),
      ]);
    expect(check("revenue less a provision", less("5000000"))).toEqual([
      expect.stringContaining("constant 5000000"),
    ]);
    expect(check("revenue less 50,00,000 of provision", less("5000000"))).toEqual([]);
    expect(check("revenue less 2.50 of rounding", less("2.5"))).toEqual([]);
    // Annualising, percentages and day counts need no permission.
    for (const c of ["12", "100", "365", "30"])
      expect(check("annualise revenue", less(c))).toEqual([]);
  });

  it("not a figure of its own assembled from permitted constants, or hung on a metric it ignores", () => {
    // The reviewer's attack: every leaf is structural, a metric appears, nothing has a digit
    // in a title — and the board would have shown a number the model chose.
    const target = formula(
      {
        op: "add",
        args: [
          {
            op: "mul",
            args: [
              { metric: "revenue" },
              { op: "sub", args: [{ const: "1" }, { const: "1" }] },
            ],
          },
          {
            op: "mul",
            args: [
              { op: "mul", args: [{ const: "365" }, { const: "12" }] },
              { const: "100" },
            ],
          },
        ],
      },
      { id: "calc_target", label: "Monthly target", unit: "money" },
    );
    const problems = check("add a target box", proposal([add("/calculated/-", target)]));
    expect(problems.join(" ")).toContain("out of constants alone");
    expect(problems.join(" ")).toContain("does not depend on the company's figures");
    expect(
      check(
        "add a days box",
        proposal([
          add(
            "/calculated/-",
            formula(
              {
                op: "add",
                args: [
                  { op: "sub", args: [{ metric: "revenue" }, { metric: "revenue" }] },
                  { const: "365" },
                ],
              },
              { unit: "days" },
            ),
          ),
        ]),
      ),
    ).toEqual([expect.stringContaining("does not depend on the company's figures")]);
  });

  it("judges only what the change brings in: a metric the catalog has since dropped does not freeze the dashboard", () => {
    const spec = {
      ...DEFAULT_DASHBOARD,
      widgets: DEFAULT_DASHBOARD.widgets.map((w, i) =>
        i === 1 ? { ...w, metrics: ["a_metric_since_removed"] } : w,
      ),
    };
    const rename: ChatEditOutput = proposal(
      [{ op: "replace", path: "/widgets/0/title", from: null, value_json: '"Sales"' }],
      "Renames the first card.",
    );
    expect(chatEditStageSpec.check?.({ ...input("rename it"), spec }, rename)).toEqual(
      [],
    );
    // But the change itself may not bring in another.
    const brought =
      chatEditStageSpec.check?.(
        { ...input("add headcount"), spec },
        proposal([add("/widgets/-", box({ metrics: ["headcount"] }))]),
      ) ?? [];
    expect(brought.join(" ")).toContain("metric headcount is not allowed");
  });

  it("not operations that leave the dashboard invalid", () => {
    expect(
      check(
        "add a box",
        proposal([add("/widgets/-", box({ layout: { x: 8, y: 0, w: 6, h: 4 } }))]),
      ).join(" "),
    ).toContain("patch:");
    expect(
      check("add a box", proposal([add("/widgets/-", box({ id: "kpi_revenue" }))])).join(
        " ",
      ),
    ).toContain("duplicate widget id");
  });
});
