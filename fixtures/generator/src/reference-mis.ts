/**
 * A synthetic reference MIS workbook (SPEC §0.8, §22): the kind of monthly MIS a CA firm already
 * sends its client, with its own sheet order, labels, section headers, bold and indented rows,
 * month-wise and comparison columns, subtotal formulas and lakh number formats. Written with
 * ExcelJS because the layout depends on cell styles. The numbers are fictional and are never read
 * by the extractor. Ground truth says how each row should bind.
 */

import ExcelJS from "exceljs";

export type ExpectedBinding =
  | { readonly kind: "heading" }
  | { readonly kind: "metric"; readonly metric: string; readonly by: "rule" | "ai" }
  | { readonly kind: "subtotal"; readonly of: readonly string[]; readonly by: "rule" }
  | { readonly kind: "unavailable" };

interface RowDef {
  readonly label: string;
  readonly bold?: boolean;
  readonly indent?: number;
  readonly values?: "number" | { readonly sumOf: readonly [1 | -1, string][] };
  readonly expected: ExpectedBinding;
}

export interface ReferenceSheetDef {
  readonly name: string;
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly RowDef[];
}

const LAKH_FORMAT = "#,##,##0.00;(#,##,##0.00)";

export const REFERENCE_MIS_SHEETS: readonly ReferenceSheetDef[] = [
  {
    name: "P&L Summary",
    title: "Synthetic Hardware Traders - Monthly MIS",
    headers: ["Apr-26", "May-26", "Current Month", "Previous Month", "Variance", "Var %", "YTD"],
    rows: [
      { label: "INCOME", bold: true, expected: { kind: "heading" } },
      { label: "Sales", indent: 1, values: "number", expected: { kind: "metric", metric: "revenue", by: "rule" } },
      { label: "Other Income", indent: 1, values: "number", expected: { kind: "metric", metric: "other_income", by: "rule" } },
      {
        label: "Total Income",
        bold: true,
        values: { sumOf: [[1, "Sales"], [1, "Other Income"]] },
        expected: { kind: "subtotal", of: ["Sales", "Other Income"], by: "rule" },
      },
      { label: "EXPENSES", bold: true, expected: { kind: "heading" } },
      { label: "Cost of Goods Sold", indent: 1, values: "number", expected: { kind: "metric", metric: "direct_costs", by: "rule" } },
      { label: "Staff Salaries & Welfare", indent: 1, values: "number", expected: { kind: "metric", metric: "employee_cost", by: "ai" } },
      { label: "Other Expenses", indent: 1, values: "number", expected: { kind: "metric", metric: "other_opex", by: "rule" } },
      {
        label: "Total Expenses",
        bold: true,
        values: { sumOf: [[1, "Cost of Goods Sold"], [1, "Staff Salaries & Welfare"], [1, "Other Expenses"]] },
        expected: { kind: "subtotal", of: ["Cost of Goods Sold", "Staff Salaries & Welfare", "Other Expenses"], by: "rule" },
      },
      { label: "EBITDA", bold: true, values: "number", expected: { kind: "metric", metric: "ebitda", by: "rule" } },
      { label: "Depreciation", indent: 1, values: "number", expected: { kind: "metric", metric: "depreciation", by: "rule" } },
      { label: "Interest", indent: 1, values: "number", expected: { kind: "metric", metric: "finance_cost", by: "rule" } },
      { label: "Profit Before Tax", bold: true, values: "number", expected: { kind: "metric", metric: "pbt", by: "rule" } },
      { label: "Provision for Tax", indent: 1, values: "number", expected: { kind: "metric", metric: "tax", by: "rule" } },
      { label: "Net Profit", bold: true, values: "number", expected: { kind: "metric", metric: "pat", by: "rule" } },
      { label: "Net Profit %", indent: 1, values: "number", expected: { kind: "metric", metric: "pat_pct", by: "rule" } },
      { label: "Marketing spend vs budget", values: "number", expected: { kind: "unavailable" } },
    ],
  },
  {
    name: "Working Capital",
    title: "Working capital position",
    headers: ["Current Month", "Previous Month"],
    rows: [
      { label: "Sundry Debtors", values: "number", expected: { kind: "metric", metric: "receivables", by: "rule" } },
      { label: "Closing Stock", values: "number", expected: { kind: "metric", metric: "inventory", by: "rule" } },
      { label: "Sundry Creditors", values: "number", expected: { kind: "metric", metric: "payables", by: "rule" } },
      { label: "Net Working Capital", bold: true, values: "number", expected: { kind: "metric", metric: "working_capital", by: "rule" } },
      { label: "Debtor Days", values: "number", expected: { kind: "metric", metric: "dso", by: "rule" } },
      { label: "Creditor Days", values: "number", expected: { kind: "metric", metric: "dpo", by: "rule" } },
      { label: "Order book", values: "number", expected: { kind: "unavailable" } },
    ],
  },
];

const colLetter = (n: number) => String.fromCharCode(64 + n);

/** The reference MIS as .xlsx bytes. */
export async function referenceMisWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  let seed = 7;
  const next = () => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed % 90_000_000;
  };
  for (const sheet of REFERENCE_MIS_SHEETS) {
    const ws = wb.addWorksheet(sheet.name);
    ws.getCell(1, 1).value = sheet.title;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.getCell(3, 1).value = "Particulars";
    ws.getCell(3, 1).font = { bold: true };
    sheet.headers.forEach((h, i) => {
      const cell = ws.getCell(3, i + 2);
      cell.value = h;
      cell.font = { bold: true };
    });
    const rowOf = new Map<string, number>();
    sheet.rows.forEach((r, i) => {
      const row = 4 + i;
      rowOf.set(r.label, row);
      const label = ws.getCell(row, 1);
      label.value = r.label;
      if (r.bold === true) label.font = { bold: true };
      if (r.indent !== undefined) label.alignment = { indent: r.indent };
      const values = r.values;
      if (values === undefined) return;
      sheet.headers.forEach((_h, ci) => {
        const col = ci + 2;
        const cell = ws.getCell(row, col);
        cell.numFmt = LAKH_FORMAT;
        if (values === "number") {
          cell.value = next() / 100;
        } else {
          const formula = values.sumOf
            .map(([sign, l], k) => `${k === 0 ? (sign === 1 ? "" : "-") : sign === 1 ? "+" : "-"}${colLetter(col)}${(rowOf.get(l) ?? 0).toString()}`)
            .join("");
          cell.value = { formula, result: 0 };
        }
      });
    });
    ws.getColumn(1).width = 32;
  }
  // A hidden working sheet: flagged by the extractor, never part of the layout.
  const hidden = wb.addWorksheet("Workings");
  hidden.state = "hidden";
  hidden.getCell(1, 1).value = "scratch";
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
