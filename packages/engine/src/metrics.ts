/**
 * Metric library (SPEC §20). Deterministic, decimal-safe, computed from the head cube.
 *
 * Conventions (ADR 0020):
 *  - P&L metrics use the month's movement, presented in the head's normal direction (income and
 *    expenses both positive when normal).
 *  - Balance-sheet metrics use the month's closing, presented in the normal direction.
 *  - EBITDA = revenue − direct costs − employee cost − other opex. Other income is excluded from
 *    EBITDA and added between EBITDA and PBT: PBT = EBITDA + other income − D&A − finance − exceptional.
 *  - DSO / DPO / inventory days use the month's revenue or direct costs and the days in that month.
 *  - A head with no ledgers in a period that has data is 0; a period with no data is missing.
 */

import { daysInMonth } from "@magicmis/core/time";
import {
  addMonths,
  financialYearOf,
  periodParts,
  periodRange,
  type PeriodId,
} from "@magicmis/core/time";
import { head as headDef } from "@magicmis/semantic";

import type { HeadCube } from "./compute";
import {
  add,
  divide,
  none,
  num,
  sub,
  toValue,
  type MetricInput,
  type MetricValue,
  type Num,
  type Unit,
} from "./values";

interface Evaluated {
  readonly n: Num;
  readonly unit: Unit;
  readonly formula: string;
  readonly inputs: readonly MetricInput[];
}

type Def = (ctx: PeriodContext) => Evaluated;

class PeriodContext {
  private readonly memo = new Map<string, Evaluated>();
  constructor(
    readonly cube: HeadCube,
    readonly period: PeriodId,
    private readonly defs: Readonly<Record<string, Def>>,
  ) {}

  private hasData(): boolean {
    return this.cube.periods.includes(this.period);
  }

  /** P&L head movement in the normal direction. */
  pl(code: string): Evaluated {
    const inputs: MetricInput[] = [];
    if (!this.hasData())
      return { n: none("missing_data"), unit: "paise", formula: code, inputs };
    const v = this.cube.get(code, this.period);
    inputs.push({
      kind: "head",
      head: code,
      period: this.period,
      field: "movement",
      ledgers: v?.ledgers ?? 0,
    });
    if (v === null)
      return { n: num(0n), unit: "paise", formula: `movement(${code})`, inputs };
    if (v.movement === null)
      return {
        n: none("missing_data"),
        unit: "paise",
        formula: `movement(${code})`,
        inputs,
      };
    const sign = headDef(code).normalBalance === "credit" ? -1n : 1n;
    return {
      n: num(v.movement * sign),
      unit: "paise",
      formula: `movement(${code})`,
      inputs,
    };
  }

  /** Balance-sheet head closing in the normal direction. */
  bs(code: string): Evaluated {
    const inputs: MetricInput[] = [];
    if (!this.hasData())
      return { n: none("missing_data"), unit: "paise", formula: code, inputs };
    const v = this.cube.get(code, this.period);
    inputs.push({
      kind: "head",
      head: code,
      period: this.period,
      field: "closing",
      ledgers: v?.ledgers ?? 0,
    });
    const sign = headDef(code).normalBalance === "credit" ? -1n : 1n;
    return {
      n: num((v?.closing ?? 0n) * sign),
      unit: "paise",
      formula: `closing(${code})`,
      inputs,
    };
  }

  metric(id: string): Evaluated {
    const cached = this.memo.get(id);
    if (cached !== undefined) return cached;
    const def = this.defs[id];
    if (def === undefined) throw new RangeError(`unknown metric ${id}`);
    const e = def(this);
    this.memo.set(id, e);
    return e;
  }

  /** A reference to another metric, as an input. */
  ref(id: string): { n: Num; input: MetricInput } {
    return {
      n: this.metric(id).n,
      input: { kind: "metric", metricId: id, period: this.period },
    };
  }
}

const money = (n: Num, formula: string, inputs: MetricInput[]): Evaluated => ({
  n,
  unit: "paise",
  formula,
  inputs,
});
const alias =
  (code: string, label: string, kind: "pl" | "bs"): Def =>
  (c) => {
    const e = kind === "pl" ? c.pl(code) : c.bs(code);
    return { ...e, formula: `${label} = ${e.formula}` };
  };

function combine(
  c: PeriodContext,
  formula: string,
  terms: [sign: 1 | -1, id: string][],
): Evaluated {
  let total: Num = num(0n);
  const inputs: MetricInput[] = [];
  for (const [sign, id] of terms) {
    const r = c.ref(id);
    inputs.push(r.input);
    total = sign === 1 ? add(total, r.n) : sub(total, r.n);
  }
  return money(total, formula, inputs);
}

function ratioOf(
  c: PeriodContext,
  formula: string,
  top: string,
  bottom: string,
  unit: "percent" | "ratio",
): Evaluated {
  const a = c.ref(top);
  const b = c.ref(bottom);
  return {
    n: divide(a.n, b.n, unit === "percent" ? 100n : 1n),
    unit,
    formula,
    inputs: [a.input, b.input],
  };
}

function daysOf(
  c: PeriodContext,
  formula: string,
  balance: string,
  flow: string,
): Evaluated {
  const { year, month } = periodParts(c.period);
  const a = c.ref(balance);
  const b = c.ref(flow);
  return {
    n: divide(a.n, b.n, BigInt(daysInMonth(year, month))),
    unit: "days",
    formula,
    inputs: [a.input, b.input],
  };
}

export const METRIC_DEFS: Readonly<Record<string, Def>> = {
  revenue: alias("REV", "Revenue from operations", "pl"),
  direct_costs: alias("COGS", "Direct costs", "pl"),
  gross_profit: (c) =>
    combine(c, "Gross profit = revenue − direct costs", [
      [1, "revenue"],
      [-1, "direct_costs"],
    ]),
  gross_margin_pct: (c) =>
    ratioOf(
      c,
      "Gross margin % = gross profit ÷ revenue × 100",
      "gross_profit",
      "revenue",
      "percent",
    ),
  employee_cost: alias("EMP", "Employee cost", "pl"),
  employee_cost_pct: (c) =>
    ratioOf(
      c,
      "Employee cost % = employee cost ÷ revenue × 100",
      "employee_cost",
      "revenue",
      "percent",
    ),
  other_opex: alias("OPEX", "Other operating expenses", "pl"),
  other_income: alias("OTH_INC", "Other income", "pl"),
  ebitda: (c) =>
    combine(c, "EBITDA = revenue − direct costs − employee cost − other opex", [
      [1, "revenue"],
      [-1, "direct_costs"],
      [-1, "employee_cost"],
      [-1, "other_opex"],
    ]),
  ebitda_pct: (c) =>
    ratioOf(c, "EBITDA % = EBITDA ÷ revenue × 100", "ebitda", "revenue", "percent"),
  depreciation: alias("DA", "Depreciation and amortisation", "pl"),
  finance_cost: alias("FIN", "Finance costs", "pl"),
  exceptional_items: alias("EXC", "Exceptional items", "pl"),
  pbt: (c) =>
    combine(
      c,
      "PBT = EBITDA + other income − depreciation − finance cost − exceptional items",
      [
        [1, "ebitda"],
        [1, "other_income"],
        [-1, "depreciation"],
        [-1, "finance_cost"],
        [-1, "exceptional_items"],
      ],
    ),
  tax: alias("TAX", "Tax expense", "pl"),
  pat: (c) =>
    combine(c, "PAT = PBT − tax", [
      [1, "pbt"],
      [-1, "tax"],
    ]),
  pat_pct: (c) => ratioOf(c, "PAT % = PAT ÷ revenue × 100", "pat", "revenue", "percent"),
  receivables: alias("CA_RECEIVABLES", "Trade receivables", "bs"),
  payables: alias("CL_PAYABLES", "Trade payables", "bs"),
  inventory: alias("CA_INVENTORY", "Inventories", "bs"),
  cash_and_bank: alias("CA_CASH", "Cash and bank balances", "bs"),
  current_assets: alias("CA", "Current assets", "bs"),
  current_liabilities: alias("CL", "Current liabilities", "bs"),
  working_capital: (c) =>
    combine(c, "Working capital = current assets − current liabilities", [
      [1, "current_assets"],
      [-1, "current_liabilities"],
    ]),
  current_ratio: (c) =>
    ratioOf(
      c,
      "Current ratio = current assets ÷ current liabilities",
      "current_assets",
      "current_liabilities",
      "ratio",
    ),
  quick_assets: (c) =>
    combine(c, "Quick assets = current assets − inventories", [
      [1, "current_assets"],
      [-1, "inventory"],
    ]),
  quick_ratio: (c) =>
    ratioOf(
      c,
      "Quick ratio = (current assets − inventories) ÷ current liabilities",
      "quick_assets",
      "current_liabilities",
      "ratio",
    ),
  dso: (c) =>
    daysOf(
      c,
      "DSO = trade receivables ÷ revenue × days in month",
      "receivables",
      "revenue",
    ),
  dpo: (c) =>
    daysOf(
      c,
      "DPO = trade payables ÷ direct costs × days in month",
      "payables",
      "direct_costs",
    ),
  inventory_days: (c) =>
    daysOf(
      c,
      "Inventory days = inventories ÷ direct costs × days in month",
      "inventory",
      "direct_costs",
    ),
  cash_conversion_cycle: (c) => {
    const dso = c.ref("dso");
    const inv = c.ref("inventory_days");
    const dpo = c.ref("dpo");
    return {
      n: sub(add(dso.n, inv.n), dpo.n),
      unit: "days",
      formula: "Cash conversion cycle = DSO + inventory days − DPO",
      inputs: [dso.input, inv.input, dpo.input],
    };
  },
};

/** Money flow metrics that accumulate for YTD. */
export const FLOW_METRICS = new Set([
  "revenue",
  "direct_costs",
  "gross_profit",
  "employee_cost",
  "other_opex",
  "other_income",
  "ebitda",
  "depreciation",
  "finance_cost",
  "exceptional_items",
  "pbt",
  "tax",
  "pat",
]);

/** Percentages whose YTD is recomputed from YTD components, never summed. */
const PCT_COMPONENTS: Readonly<Record<string, [string, string]>> = {
  gross_margin_pct: ["gross_profit", "revenue"],
  employee_cost_pct: ["employee_cost", "revenue"],
  ebitda_pct: ["ebitda", "revenue"],
  pat_pct: ["pat", "revenue"],
};

export class MetricEngine {
  private readonly contexts = new Map<string, PeriodContext>();
  constructor(readonly cube: HeadCube) {}

  private ctx(period: PeriodId): PeriodContext {
    let c = this.contexts.get(period);
    if (c === undefined) {
      c = new PeriodContext(this.cube, period, METRIC_DEFS);
      this.contexts.set(period, c);
    }
    return c;
  }

  evaluate(metricId: string, period: PeriodId): MetricValue {
    const e = this.ctx(period).metric(metricId);
    return {
      metricId,
      period,
      dims: {},
      ...toValue(e.n, e.unit),
      unit: e.unit,
      formula: e.formula,
      inputs: e.inputs,
    };
  }

  private raw(metricId: string, period: PeriodId): Evaluated {
    return this.ctx(period).metric(metricId);
  }

  private ytdNum(metricId: string, period: PeriodId): Num {
    const fy = financialYearOf(period, this.cube.fyStartMonth);
    let total: Num = num(0n);
    for (const p of periodRange(fy.start, period)) {
      if (!this.cube.periods.includes(p)) return none("missing_data");
      total = add(total, this.raw(metricId, p).n);
    }
    return total;
  }

  /** Comparisons: mom/yoy abs and %, ytd, ly_ytd, variance vs previous period. */
  comparisons(
    metricId: string,
    period: PeriodId,
    kinds: readonly ("mom" | "yoy" | "ytd" | "ly_ytd" | "variance")[],
  ): MetricValue[] {
    const base = this.raw(metricId, period);
    const out: MetricValue[] = [];
    const push = (
      suffix: string,
      n: Num,
      unit: Unit,
      formula: string,
      inputs: MetricInput[],
    ) =>
      out.push({
        metricId: `${metricId}.${suffix}`,
        period,
        dims: {},
        ...toValue(n, unit),
        unit,
        formula,
        inputs,
      });
    const change = (other: PeriodId, suffix: string, label: string) => {
      const prior = this.cube.periods.includes(other)
        ? this.raw(metricId, other).n
        : none("no_prior_period");
      const inputs: MetricInput[] = [
        { kind: "metric", metricId, period },
        { kind: "metric", metricId, period: other },
      ];
      const diffUnit: Unit = base.unit === "paise" ? "paise" : base.unit;
      push(
        `${suffix}_abs`,
        sub(base.n, prior),
        diffUnit,
        `${label} change = current − ${label === "YoY" ? "same month last year" : "previous month"}`,
        inputs,
      );
      if (base.unit === "paise") {
        const absPrior: Num = prior.ok ? num(prior.v < 0n ? -prior.v : prior.v) : prior;
        push(
          `${suffix}_pct`,
          divide(sub(base.n, prior), absPrior, 100n),
          "percent",
          `${label} change % = change ÷ |prior| × 100`,
          inputs,
        );
      }
    };
    for (const k of kinds) {
      if (k === "mom") change(addMonths(period, -1), "mom", "MoM");
      if (k === "yoy") change(addMonths(period, -12), "yoy", "YoY");
      if (k === "variance") {
        const prev = addMonths(period, -1);
        const prior = this.cube.periods.includes(prev)
          ? this.raw(metricId, prev).n
          : none("no_prior_period");
        push(
          "variance",
          sub(base.n, prior),
          base.unit,
          "Variance = current − previous period",
          [
            { kind: "metric", metricId, period },
            { kind: "metric", metricId, period: prev },
          ],
        );
      }
      if (k === "ytd" || k === "ly_ytd") {
        const at = k === "ytd" ? period : addMonths(period, -12);
        const label = k === "ytd" ? "YTD" : "Last year YTD";
        const components = PCT_COMPONENTS[metricId];
        if (FLOW_METRICS.has(metricId)) {
          push(
            k,
            this.ytdNum(metricId, at),
            "paise",
            `${label} = sum of monthly ${metricId} from FY start`,
            [{ kind: "metric", metricId, period: at }],
          );
        } else if (components !== undefined) {
          const [top, bottom] = components;
          push(
            k,
            divide(this.ytdNum(top, at), this.ytdNum(bottom, at), 100n),
            "percent",
            `${label} = YTD ${top} ÷ YTD ${bottom} × 100`,
            [
              { kind: "metric", metricId: `${top}.${k}`, period },
              { kind: "metric", metricId: `${bottom}.${k}`, period },
            ],
          );
        }
      }
    }
    return out;
  }
}

/** Every library metric for every loaded period, plus the requested comparisons. */
export function computeMetricStore(
  cube: HeadCube,
  metrics: readonly {
    id: string;
    comparisons: readonly ("mom" | "yoy" | "ytd" | "ly_ytd" | "variance")[];
  }[],
): MetricValue[] {
  const engine = new MetricEngine(cube);
  const out: MetricValue[] = [];
  for (const period of cube.periods) {
    for (const m of metrics) {
      out.push(engine.evaluate(m.id, period));
      out.push(...engine.comparisons(m.id, period, m.comparisons));
    }
  }
  return out;
}
