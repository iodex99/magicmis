/**
 * Excel formulas for library metrics (SPEC §24.1): SUMIFS over the Data sheet plus simple
 * arithmetic, mirroring `@magicmis/engine`'s metric definitions one for one (a test enforces the
 * same set). Division is guarded; an empty string stands for "no value", as the engine's null does.
 */

import { head } from "@magicmis/semantic";

import { DATA_COLUMNS } from "./data";

type XDef =
  | { readonly kind: "pl"; readonly head: string }
  | { readonly kind: "bs"; readonly head: string }
  | { readonly kind: "sum"; readonly terms: readonly (readonly [1 | -1, string])[] }
  | {
      readonly kind: "ratio";
      readonly num: string;
      readonly den: string;
      readonly times: 100 | 1;
    }
  | { readonly kind: "days"; readonly num: string; readonly den: string }
  | { readonly kind: "ccc" };

export const FORMULA_DEFS: Readonly<Record<string, XDef>> = {
  revenue: { kind: "pl", head: "REV" },
  direct_costs: { kind: "pl", head: "COGS" },
  gross_profit: {
    kind: "sum",
    terms: [
      [1, "revenue"],
      [-1, "direct_costs"],
    ],
  },
  gross_margin_pct: { kind: "ratio", num: "gross_profit", den: "revenue", times: 100 },
  employee_cost: { kind: "pl", head: "EMP" },
  employee_cost_pct: { kind: "ratio", num: "employee_cost", den: "revenue", times: 100 },
  other_opex: { kind: "pl", head: "OPEX" },
  other_income: { kind: "pl", head: "OTH_INC" },
  ebitda: {
    kind: "sum",
    terms: [
      [1, "revenue"],
      [-1, "direct_costs"],
      [-1, "employee_cost"],
      [-1, "other_opex"],
    ],
  },
  ebitda_pct: { kind: "ratio", num: "ebitda", den: "revenue", times: 100 },
  depreciation: { kind: "pl", head: "DA" },
  finance_cost: { kind: "pl", head: "FIN" },
  exceptional_items: { kind: "pl", head: "EXC" },
  pbt: {
    kind: "sum",
    terms: [
      [1, "ebitda"],
      [1, "other_income"],
      [-1, "depreciation"],
      [-1, "finance_cost"],
      [-1, "exceptional_items"],
    ],
  },
  tax: { kind: "pl", head: "TAX" },
  pat: {
    kind: "sum",
    terms: [
      [1, "pbt"],
      [-1, "tax"],
    ],
  },
  pat_pct: { kind: "ratio", num: "pat", den: "revenue", times: 100 },
  receivables: { kind: "bs", head: "CA_RECEIVABLES" },
  payables: { kind: "bs", head: "CL_PAYABLES" },
  inventory: { kind: "bs", head: "CA_INVENTORY" },
  cash_and_bank: { kind: "bs", head: "CA_CASH" },
  current_assets: { kind: "bs", head: "CA" },
  current_liabilities: { kind: "bs", head: "CL" },
  working_capital: {
    kind: "sum",
    terms: [
      [1, "current_assets"],
      [-1, "current_liabilities"],
    ],
  },
  current_ratio: {
    kind: "ratio",
    num: "current_assets",
    den: "current_liabilities",
    times: 1,
  },
  quick_assets: {
    kind: "sum",
    terms: [
      [1, "current_assets"],
      [-1, "inventory"],
    ],
  },
  quick_ratio: {
    kind: "ratio",
    num: "quick_assets",
    den: "current_liabilities",
    times: 1,
  },
  dso: { kind: "days", num: "receivables", den: "revenue" },
  dpo: { kind: "days", num: "payables", den: "direct_costs" },
  inventory_days: { kind: "days", num: "inventory", den: "direct_costs" },
  cash_conversion_cycle: { kind: "ccc" },
};

export type MetricUnitKind = "money" | "ratio" | "days";

export function unitKind(metricId: string): MetricUnitKind {
  const d = FORMULA_DEFS[metricId];
  if (d === undefined) throw new RangeError(`no formula for ${metricId}`);
  if (d.kind === "ratio") return "ratio";
  if (d.kind === "days" || d.kind === "ccc") return "days";
  return "money";
}

/** Whether a metric accumulates over the year (P&L flows). */
export function isFlow(metricId: string): boolean {
  const d = FORMULA_DEFS[metricId];
  if (d === undefined) return false;
  if (d.kind === "pl") return true;
  if (d.kind === "sum") return d.terms.every(([, id]) => isFlow(id));
  if (d.kind === "ratio") return isFlow(d.num) && isFlow(d.den);
  return false;
}

export interface ColumnContext {
  /** "period": one month; "ytd": FY start to the month. */
  readonly kind: "period" | "ytd";
  /** Cell holding the numeric period index for this column, e.g. `C$3`. */
  readonly indexCell: string;
  /** Cell holding the FY start index, e.g. `C$4`. */
  readonly fyCell: string;
  /** Calendar days in the month (period columns only). */
  readonly days: number;
}

export class DataRange {
  constructor(private readonly lastRow: number) {}
  col(name: (typeof DATA_COLUMNS)[number]): string {
    const letter = String.fromCharCode(65 + DATA_COLUMNS.indexOf(name));
    return `Data!$${letter}$2:$${letter}$${Math.max(2, this.lastRow).toString()}`;
  }
}

/**
 * The formula body (no leading "=") for a metric in a column, or null where the metric has no
 * meaning (a balance-sheet value over a year to date). `rowRef` returns a cell in the same column
 * when the metric has its own row on the sheet, so the workbook reads like the report.
 */
export function metricExpression(
  metricId: string,
  col: ColumnContext,
  data: DataRange,
  rowRef: (metricId: string) => string | null,
): string | null {
  const ref = (id: string): string | null =>
    rowRef(id) ?? wrap(metricExpression(id, col, data, rowRef));
  const d = FORMULA_DEFS[metricId];
  if (d === undefined) throw new RangeError(`no formula for ${metricId}`);
  switch (d.kind) {
    case "pl": {
      const sign = head(d.head).normalBalance === "credit" ? "-" : "";
      const path = `"*/${d.head}/*"`;
      const sum =
        col.kind === "period"
          ? `SUMIFS(${data.col("amount_paise")},${data.col("period_index")},${col.indexCell},${data.col("head_path")},${path},${data.col("measure")},"movement")`
          : `SUMIFS(${data.col("amount_paise")},${data.col("fy_start_index")},${col.fyCell},${data.col("period_index")},"<="&${col.indexCell},${data.col("head_path")},${path},${data.col("measure")},"movement")`;
      return `${sign}${sum}/100`;
    }
    case "bs": {
      if (col.kind === "ytd") return null;
      const sign = head(d.head).normalBalance === "credit" ? "-" : "";
      return `${sign}SUMIFS(${data.col("amount_paise")},${data.col("period_index")},${col.indexCell},${data.col("head_path")},"*/${d.head}/*",${data.col("measure")},"closing")/100`;
    }
    case "sum": {
      const parts: string[] = [];
      for (const [sign, id] of d.terms) {
        const r = ref(id);
        if (r === null) return null;
        parts.push(
          `${parts.length === 0 ? (sign === 1 ? "" : "-") : sign === 1 ? "+" : "-"}${r}`,
        );
      }
      return parts.join("");
    }
    case "ratio": {
      const n = ref(d.num);
      const den = ref(d.den);
      if (n === null || den === null) return null;
      return `IF(${den}=0,"",${n}/${den}${d.times === 100 ? "*100" : ""})`;
    }
    case "days": {
      if (col.kind === "ytd") return null;
      const n = ref(d.num);
      const den = ref(d.den);
      if (n === null || den === null) return null;
      return `IF(${den}=0,"",${n}/${den}*${col.days.toString()})`;
    }
    case "ccc": {
      if (col.kind === "ytd") return null;
      const [a, b, c] = [ref("dso"), ref("inventory_days"), ref("dpo")];
      if (a === null || b === null || c === null) return null;
      return `IF(OR(${a}="",${b}="",${c}=""),"",${a}+${b}-${c})`;
    }
  }
}

const wrap = (e: string | null): string | null => (e === null ? null : `(${e})`);
