/**
 * Built-in template for this build: Monthly Financial MIS (SPEC §22). Cover and index are added by
 * the renderer; ageing and payroll sections appear only when their reports are present.
 */

import { templateSpecSchema, type TemplateSpec } from "./spec";

const m = (
  id: string,
  label: string,
  metric: string,
  extra: { indent?: number; emphasis?: boolean } = {},
) => ({
  kind: "metric" as const,
  id,
  label,
  metric,
  indent: extra.indent ?? 0,
  emphasis: extra.emphasis ?? false,
  showIfNonZero: false,
});

const COMPARISONS = [
  "current",
  "previous",
  "mom_abs",
  "mom_pct",
  "same_month_ly",
  "yoy_abs",
  "yoy_pct",
  "ytd",
  "ly_ytd",
] as const;

export const MONTHLY_FINANCIAL_MIS: TemplateSpec = templateSpecSchema.parse({
  schemaVersion: 1,
  id: "monthly_financial_mis",
  name: "Monthly Financial MIS",
  // 2: the Cash flow sheet (ADR 0086).
  version: 2,
  numberFormat: { style: "lakhs_crores", decimals: 2, negativesInBrackets: true },
  sections: [
    {
      id: "pnl",
      title: "Profit and loss",
      sheet: "P&L",
      requires: ["balances"],
      columns: ["fy_months", ...COMPARISONS],
      rows: [
        m("revenue", "Revenue from operations", "revenue", { emphasis: true }),
        m("direct_costs", "Direct costs", "direct_costs"),
        m("gross_profit", "Gross profit", "gross_profit", { emphasis: true }),
        m("gross_margin_pct", "Gross margin %", "gross_margin_pct", { indent: 1 }),
        m("employee_cost", "Employee cost", "employee_cost"),
        m("other_opex", "Other operating expenses", "other_opex"),
        m("ebitda", "EBITDA", "ebitda", { emphasis: true }),
        m("ebitda_pct", "EBITDA %", "ebitda_pct", { indent: 1 }),
        m("other_income", "Other income", "other_income"),
        m("depreciation", "Depreciation and amortisation", "depreciation"),
        m("finance_cost", "Finance costs", "finance_cost"),
        m("pbt", "Profit before tax", "pbt", { emphasis: true }),
        m("tax", "Tax expense", "tax"),
        m("pat", "Profit after tax", "pat", { emphasis: true }),
        m("pat_pct", "PAT %", "pat_pct", { indent: 1 }),
      ],
    },
    {
      id: "ratios",
      title: "Key ratios",
      sheet: "Ratios",
      requires: ["balances"],
      columns: ["current", "previous", "same_month_ly"],
      rows: [
        m("current_ratio", "Current ratio", "current_ratio"),
        m("quick_ratio", "Quick ratio", "quick_ratio"),
        m("dso", "Debtor days (DSO)", "dso"),
        m("dpo", "Creditor days (DPO)", "dpo"),
        m("inventory_days", "Inventory days", "inventory_days"),
        m(
          "cash_conversion_cycle",
          "Cash conversion cycle (days)",
          "cash_conversion_cycle",
        ),
      ],
    },
    {
      id: "balance_sheet",
      title: "Balance sheet summary",
      sheet: "Balance sheet",
      requires: ["balances"],
      columns: ["current", "previous", "same_month_ly"],
      rows: [
        m("current_assets", "Current assets", "current_assets", { emphasis: true }),
        m("receivables", "Trade receivables", "receivables", { indent: 1 }),
        m("inventory", "Inventories", "inventory", { indent: 1 }),
        m("cash_and_bank", "Cash and bank balances", "cash_and_bank", { indent: 1 }),
        m("current_liabilities", "Current liabilities", "current_liabilities", {
          emphasis: true,
        }),
        m("payables", "Trade payables", "payables", { indent: 1 }),
        m("working_capital", "Working capital", "working_capital", { emphasis: true }),
      ],
    },
    {
      // ADR 0086: the indirect method, from the books' own movements. Every line is computed,
      // so the three sections add up to the change in cash and bank — the last three rows show
      // it — and nothing on the sheet is a balancing figure.
      id: "cash_flow",
      title: "Cash flow",
      sheet: "Cash flow",
      requires: ["balances"],
      columns: ["fy_months", "ytd"],
      rows: [
        { kind: "heading", id: "operating", label: "Operating activities" },
        m("pat", "Profit after tax", "pat"),
        m("depreciation", "Add: depreciation and amortisation", "depreciation", {
          indent: 1,
        }),
        m("receivables", "(Increase) / decrease in trade receivables", "cf_receivables", {
          indent: 1,
        }),
        m("inventory", "(Increase) / decrease in inventories", "cf_inventory", {
          indent: 1,
        }),
        m(
          "other_current_assets",
          "(Increase) / decrease in other current assets",
          "cf_other_current_assets",
          { indent: 1 },
        ),
        m("payables", "Increase / (decrease) in trade payables", "cf_payables", {
          indent: 1,
        }),
        m(
          "other_current_liabilities",
          "Increase / (decrease) in other current liabilities",
          "cf_other_current_liabilities",
          { indent: 1 },
        ),
        m("unmapped", "Change in unmapped balances", "cf_unmapped", { indent: 1 }),
        m("operating_total", "Cash from operating activities", "cf_operating", {
          emphasis: true,
        }),
        { kind: "heading", id: "investing", label: "Investing activities" },
        m("fixed_assets", "Fixed assets bought, net of disposals", "cf_fixed_assets", {
          indent: 1,
        }),
        m(
          "investments",
          "Investments, deposits and other non-current assets",
          "cf_investments",
          { indent: 1 },
        ),
        m("investing_total", "Cash from investing activities", "cf_investing", {
          emphasis: true,
        }),
        { kind: "heading", id: "financing", label: "Financing activities" },
        m("borrowings", "Borrowings raised / (repaid)", "cf_borrowings", { indent: 1 }),
        m("other_long_term", "Other long-term liabilities", "cf_other_long_term", {
          indent: 1,
        }),
        m("capital", "Capital introduced / (withdrawn)", "cf_equity", { indent: 1 }),
        m("financing_total", "Cash from financing activities", "cf_financing", {
          emphasis: true,
        }),
        m("net", "Net change in cash and bank", "cf_net", { emphasis: true }),
        m("opening_cash", "Cash and bank at the start of the month", "cash_opening"),
        m("closing_cash", "Cash and bank at the end of the month", "cash_and_bank", {
          emphasis: true,
        }),
      ],
    },
    {
      id: "receivables_ageing",
      title: "Receivables ageing",
      sheet: "Receivables ageing",
      requires: ["bills_receivable"],
      columns: ["current"],
      rows: [
        {
          kind: "heading",
          id: "ageing_note",
          label: "Pending bills by days from bill date",
        },
      ],
    },
    {
      id: "payables_ageing",
      title: "Payables ageing",
      sheet: "Payables ageing",
      requires: ["bills_payable"],
      columns: ["current"],
      rows: [
        {
          kind: "heading",
          id: "ageing_note",
          label: "Pending bills by days from bill date",
        },
      ],
    },
    {
      id: "payroll",
      title: "Payroll cost summary",
      sheet: "Payroll",
      requires: ["pay_sheet"],
      columns: ["current"],
      rows: [{ kind: "heading", id: "payroll_note", label: "Headcount and gross pay" }],
    },
  ],
  notes: [
    "Figures are computed from the files you supplied and rounded for display; totals are computed from unrounded values.",
    "Prepared from data provided by the user; requires professional review.",
  ],
  defaultDashboard: null,
  defaultCommentarySections: ["Performance", "Margins", "Working capital"],
  materiality: { pct: "0.05", absPaise: "0" },
});

export const BUILT_IN_TEMPLATES: readonly TemplateSpec[] = [MONTHLY_FINANCIAL_MIS];

/** Version 1 exactly as companies stored it, so an untouched copy can be recognised. */
const VERSION_1: TemplateSpec = templateSpecSchema.parse({
  ...MONTHLY_FINANCIAL_MIS,
  version: 1,
  sections: MONTHLY_FINANCIAL_MIS.sections.filter((s) => s.id !== "cash_flow"),
});

/**
 * The template a run renders for a company (ADR 0086). A company keeps the template stored in its
 * blueprint — a recreated reference MIS, or a built-in one it has changed, is its own — except
 * that an untouched copy of an earlier built-in version is brought up to the current one, so a
 * company set up before the Cash flow sheet existed gets it on its next run. "Untouched" is exact
 * equality with that version as it was shipped: any change at all, and the company's copy stands.
 */
export function templateForRun(stored: TemplateSpec | null): TemplateSpec {
  if (stored === null) return MONTHLY_FINANCIAL_MIS;
  const same = (a: TemplateSpec, b: TemplateSpec) =>
    JSON.stringify(templateSpecSchema.parse(a)) === JSON.stringify(b);
  return same(stored, VERSION_1) ? MONTHLY_FINANCIAL_MIS : stored;
}
