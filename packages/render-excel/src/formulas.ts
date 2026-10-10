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
  | { readonly kind: "ccc" }
  /** Cash released by heads' movements: Σ sign × −movement (ADR 0086). */
  | { readonly kind: "release"; readonly terms: readonly (readonly [1 | -1, string])[] }
  /** A closed year's profit as it moves into capital: movement − change in closing, every ledger. */
  | { readonly kind: "carried" }
  /** A balance-sheet head at the start of the month: closing − movement. */
  | { readonly kind: "opening"; readonly head: string };

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
  cf_receivables: { kind: "release", terms: [[1, "CA_RECEIVABLES"]] },
  cf_inventory: { kind: "release", terms: [[1, "CA_INVENTORY"]] },
  cf_other_current_assets: {
    kind: "release",
    terms: [
      [1, "CA"],
      [-1, "CA_CASH"],
      [-1, "CA_RECEIVABLES"],
      [-1, "CA_INVENTORY"],
    ],
  },
  cf_payables: { kind: "release", terms: [[1, "CL_PAYABLES"]] },
  cf_other_current_liabilities: {
    kind: "release",
    terms: [
      [1, "CL"],
      [-1, "CL_PAYABLES"],
      [-1, "CL_BORROWINGS"],
    ],
  },
  cf_unmapped: { kind: "release", terms: [[1, "UNMAPPED"]] },
  cf_operating: {
    kind: "sum",
    terms: [
      [1, "pat"],
      [1, "depreciation"],
      [1, "cf_receivables"],
      [1, "cf_inventory"],
      [1, "cf_other_current_assets"],
      [1, "cf_payables"],
      [1, "cf_other_current_liabilities"],
      [1, "cf_unmapped"],
    ],
  },
  cf_net_block: {
    kind: "release",
    terms: [
      [1, "NCA_PPE"],
      [1, "NCA_INTANGIBLES"],
    ],
  },
  cf_fixed_assets: {
    kind: "sum",
    terms: [
      [1, "cf_net_block"],
      [-1, "depreciation"],
    ],
  },
  cf_investments: {
    kind: "release",
    terms: [
      [1, "NCA"],
      [-1, "NCA_PPE"],
      [-1, "NCA_INTANGIBLES"],
    ],
  },
  cf_investing: {
    kind: "sum",
    terms: [
      [1, "cf_fixed_assets"],
      [1, "cf_investments"],
    ],
  },
  cf_borrowings: {
    kind: "release",
    terms: [
      [1, "NCL_BORROWINGS"],
      [1, "CL_BORROWINGS"],
    ],
  },
  cf_other_long_term: {
    kind: "release",
    terms: [
      [1, "NCL"],
      [-1, "NCL_BORROWINGS"],
    ],
  },
  cf_capital_movement: { kind: "release", terms: [[1, "EQ"]] },
  cf_profit_carried: { kind: "carried" },
  cf_equity: {
    kind: "sum",
    terms: [
      [1, "cf_capital_movement"],
      [1, "cf_profit_carried"],
    ],
  },
  cf_financing: {
    kind: "sum",
    terms: [
      [1, "cf_borrowings"],
      [1, "cf_other_long_term"],
      [1, "cf_equity"],
    ],
  },
  cf_net: {
    kind: "sum",
    terms: [
      [1, "cf_operating"],
      [1, "cf_investing"],
      [1, "cf_financing"],
    ],
  },
  cash_opening: { kind: "opening", head: "CA_CASH" },
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
  if (d.kind === "pl" || d.kind === "release" || d.kind === "carried") return true;
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
    case "release": {
      // Each term's movement for the month, or from the year's start to the month.
      const parts = d.terms.map(
        ([sign, code]) =>
          `${sign === 1 ? "-" : "+"}${movementSum(data, col, `"*/${code}/*"`)}`,
      );
      return `(${parts.join("")})/100`;
    }
    case "carried": {
      // Every ledger's movement less its change in closing: a year's restart, and nothing else.
      const closing = (index: string) =>
        `SUMIFS(${data.col("amount_paise")},${data.col("period_index")},${index},${data.col("measure")},"closing")`;
      const start = col.kind === "period" ? col.indexCell : col.fyCell;
      return `(${movementSum(data, col, null)}-${closing(col.indexCell)}+${closing(`${start}-1`)})/100`;
    }
    case "opening": {
      if (col.kind === "ytd") return null;
      const sign = head(d.head).normalBalance === "credit" ? "-" : "";
      const path = `"*/${d.head}/*"`;
      return `${sign}(SUMIFS(${data.col("amount_paise")},${data.col("period_index")},${col.indexCell},${data.col("head_path")},${path},${data.col("measure")},"closing")-${movementSum(data, col, path)})/100`;
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

/**
 * The movement under a head path (or every ledger, for null) in a month, or from the year's
 * start to the month in a year-to-date column. In paise, so the caller divides once.
 */
export function movementSum(
  data: DataRange,
  col: ColumnContext,
  path: string | null,
): string {
  const head = path === null ? "" : `,${data.col("head_path")},${path}`;
  return col.kind === "period"
    ? `SUMIFS(${data.col("amount_paise")},${data.col("period_index")},${col.indexCell}${head},${data.col("measure")},"movement")`
    : `SUMIFS(${data.col("amount_paise")},${data.col("fy_start_index")},${col.fyCell},${data.col("period_index")},"<="&${col.indexCell}${head},${data.col("measure")},"movement")`;
}
