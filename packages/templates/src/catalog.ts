/**
 * Library metrics a template row may bind to (SPEC §19, §22), with their display unit and the
 * row labels Indian MIS workbooks commonly use for them. The labels drive deterministic binding
 * of a reference MIS before any AI is involved; a test keeps the ids identical to the engine's
 * metric definitions.
 */

export type CatalogUnit = "money" | "percent" | "ratio" | "days";

export interface CatalogMetric {
  readonly id: string;
  readonly label: string;
  readonly unit: CatalogUnit;
  /** Normalised labels (see `normaliseLabel`) that bind to this metric without AI. */
  readonly synonyms: readonly string[];
}

const c = (
  id: string,
  label: string,
  unit: CatalogUnit,
  synonyms: string[],
): CatalogMetric => ({
  id,
  label,
  unit,
  synonyms,
});

export const METRIC_CATALOG: readonly CatalogMetric[] = [
  c("revenue", "Revenue from operations", "money", [
    "revenue from operations",
    "revenue",
    "sales",
    "net sales",
    "sales net",
    "turnover",
    "income from operations",
    "operating revenue",
    "total revenue from operations",
  ]),
  c("direct_costs", "Direct costs", "money", [
    "direct costs",
    "direct cost",
    "cost of goods sold",
    "cogs",
    "cost of sales",
    "cost of materials consumed",
    "purchases and direct expenses",
  ]),
  c("gross_profit", "Gross profit", "money", ["gross profit", "gross margin"]),
  c("gross_margin_pct", "Gross margin %", "percent", [
    "gross margin %",
    "gross margin percent",
    "gp %",
    "gross profit %",
  ]),
  c("employee_cost", "Employee cost", "money", [
    "employee cost",
    "employee costs",
    "employee benefits expense",
    "employee benefit expenses",
    "salaries and wages",
    "staff cost",
    "payroll cost",
  ]),
  c("employee_cost_pct", "Employee cost %", "percent", [
    "employee cost %",
    "staff cost %",
  ]),
  c("other_opex", "Other operating expenses", "money", [
    "other operating expenses",
    "other expenses",
    "operating expenses",
    "administrative expenses",
    "overheads",
  ]),
  c("other_income", "Other income", "money", ["other income", "non operating income"]),
  c("ebitda", "EBITDA", "money", ["ebitda", "operating profit", "operating ebitda"]),
  c("ebitda_pct", "EBITDA %", "percent", [
    "ebitda %",
    "ebitda margin",
    "ebitda margin %",
  ]),
  c("depreciation", "Depreciation and amortisation", "money", [
    "depreciation and amortisation",
    "depreciation and amortization",
    "depreciation",
    "depreciation and amortisation expense",
  ]),
  c("finance_cost", "Finance costs", "money", [
    "finance costs",
    "finance cost",
    "interest",
    "interest expense",
    "interest and finance charges",
  ]),
  c("exceptional_items", "Exceptional items", "money", ["exceptional items"]),
  c("pbt", "Profit before tax", "money", [
    "profit before tax",
    "pbt",
    "net profit before tax",
  ]),
  c("tax", "Tax expense", "money", [
    "tax expense",
    "tax",
    "income tax",
    "provision for tax",
  ]),
  c("pat", "Profit after tax", "money", [
    "profit after tax",
    "pat",
    "net profit",
    "net profit after tax",
    "profit for the period",
  ]),
  c("pat_pct", "PAT %", "percent", [
    "pat %",
    "net profit %",
    "net margin",
    "net margin %",
  ]),
  c("receivables", "Trade receivables", "money", [
    "trade receivables",
    "receivables",
    "sundry debtors",
    "debtors",
  ]),
  c("payables", "Trade payables", "money", [
    "trade payables",
    "payables",
    "sundry creditors",
    "creditors",
  ]),
  c("inventory", "Inventories", "money", [
    "inventories",
    "inventory",
    "stock",
    "closing stock",
  ]),
  c("cash_and_bank", "Cash and bank balances", "money", [
    "cash and bank balances",
    "cash and bank",
    "cash and cash equivalents",
    "cash bank",
  ]),
  c("current_assets", "Current assets", "money", [
    "current assets",
    "total current assets",
  ]),
  c("current_liabilities", "Current liabilities", "money", [
    "current liabilities",
    "total current liabilities",
  ]),
  c("working_capital", "Working capital", "money", [
    "working capital",
    "net working capital",
  ]),
  c("current_ratio", "Current ratio", "ratio", ["current ratio"]),
  c("quick_assets", "Quick assets", "money", ["quick assets"]),
  c("quick_ratio", "Quick ratio", "ratio", ["quick ratio", "acid test ratio"]),
  c("dso", "Debtor days", "days", [
    "debtor days",
    "dso",
    "debtor days dso",
    "receivable days",
  ]),
  c("dpo", "Creditor days", "days", [
    "creditor days",
    "dpo",
    "creditor days dpo",
    "payable days",
  ]),
  c("inventory_days", "Inventory days", "days", ["inventory days", "stock days"]),
  c("cash_conversion_cycle", "Cash conversion cycle", "days", [
    "cash conversion cycle",
    "cash conversion cycle days",
  ]),
];

export const catalogMetric = (id: string): CatalogMetric | undefined =>
  METRIC_CATALOG.find((m) => m.id === id);

/**
 * Label normalisation for binding: lower case, "&" as "and", "%" kept as a word, bracketed
 * numbering and punctuation removed, whitespace collapsed.
 */
export function normaliseLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/%/gu, " % ")
    .replace(/^\s*(\(?[a-z0-9]{1,3}[.)])\s+/u, " ")
    .replace(/[^\p{L}\p{N}%\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
