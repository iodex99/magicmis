/**
 * V11 (SPEC §21, §24.1): every generated formula evaluates to the engine's value — money to the
 * paisa, decimals to the 6th place — before the workbook is released. Blocking, platform fault.
 */

import type { CheckResult } from "@magicmis/engine";
import type ExcelJS from "exceljs";

import { Evaluator, FormulaError, type CellSource, type Scalar } from "./evaluate";
import type { Expectation } from "./workbook";

export function workbookCells(wb: ExcelJS.Workbook): CellSource {
  return {
    get(sheet, row, col) {
      const ws = wb.getWorksheet(sheet);
      if (ws === undefined) throw new FormulaError(`no sheet ${sheet}`);
      const v = ws.getCell(row, col).value;
      if (v === null || v === undefined) return undefined;
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean")
        return v;
      if (typeof v === "object" && "formula" in v && typeof v.formula === "string")
        return { formula: v.formula };
      if (typeof v === "object" && "text" in v && typeof v.text === "string")
        return v.text;
      return undefined;
    },
  };
}

/** A float from the sheet as a scaled integer, for exact comparison with engine strings. */
function scaled(v: number, places: number): bigint {
  const fixed = v.toFixed(places);
  const neg = fixed.startsWith("-");
  const digits = fixed.replace("-", "").replace(".", "");
  const n = BigInt(digits);
  return neg ? -n : n;
}

export function matches(actual: Scalar, e: Expectation): boolean {
  if (e.value === null) return actual === "";
  if (typeof actual !== "number") return false;
  if (e.unit === "paise") return scaled(actual * 100, 0) === BigInt(e.value);
  const [whole = "0", frac = ""] = e.value.replace("-", "").split(".");
  const expected =
    BigInt(`${whole}${frac.padEnd(6, "0")}`) * (e.value.startsWith("-") ? -1n : 1n);
  const diff = scaled(actual, 6) - expected;
  // The engine rounds half-even at 6 places; the sheet computes in floating point.
  return diff >= -1n && diff <= 1n;
}

export function verifyWorkbook(
  wb: ExcelJS.Workbook,
  expectations: readonly Expectation[],
): CheckResult {
  const evaluator = new Evaluator(workbookCells(wb));
  const failures: { label: string; amounts: Record<string, string> }[] = [];
  for (const e of expectations) {
    let actual: Scalar;
    try {
      actual = evaluator.cell(e.sheet, e.row, e.col);
    } catch (error) {
      failures.push({
        label: `${e.sheet} ${e.metricId}`,
        amounts: { error: error instanceof Error ? error.message : "error" },
      });
      continue;
    }
    if (!matches(actual, e)) {
      failures.push({
        label: `${e.sheet} ${e.metricId}`,
        amounts: { engine: e.value ?? "", workbook: String(actual) },
      });
    }
  }
  const failed = failures.length > 0;
  return {
    id: "V11",
    status: failed ? "fail" : "pass",
    severity: "blocking",
    failureClass: "platform_fault",
    message: failed
      ? "Some workbook formulas do not reproduce the computed figures. This is our error."
      : `All ${expectations.length.toString()} workbook formulas reproduce the computed figures.`,
    fix: failed ? "No action is needed from you; the job will not be charged." : "",
    amounts: { formulas_checked: expectations.length.toString() },
    details: failures.slice(0, 50),
  };
}
