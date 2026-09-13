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
  version: 1,
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
