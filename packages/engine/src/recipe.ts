/**
 * Recipe DSL (SPEC §20). Declarative data stored (encrypted) in the blueprint and compiled to
 * DuckDB SQL by `compile.ts`. AI never writes SQL for the engine; nothing here is free-form SQL.
 */

import { z } from "zod";

export const SOURCE_ROLES = [
  "trial_balance",
  "group_summary",
  "profit_and_loss",
  "balance_sheet",
  "day_book",
  "sales_register",
  "purchase_register",
  "ledger_vouchers",
  "bills_receivable",
  "bills_payable",
  "stock_summary",
  "pay_sheet",
] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];

const header = z.string().min(1).max(200);

export const recipeSourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/u),
  role: z.enum(SOURCE_ROLES),
  /** Header signature from `@magicmis/ingest` fingerprinting; matched next month. */
  sheetSignature: z.string().min(1).max(200),
  /** Column bindings by header text (SPEC §4: never positions). */
  columns: z
    .object({
      particulars: header,
      date: header,
      ledger: header,
      group: header,
      party: header,
      amount: header,
      debit: header,
      credit: header,
      opening: header,
      closing: header,
      quantity: header,
      voucherNo: header,
      voucherType: header,
    })
    .partial(),
  /** Debit positive unless the export prints credits as positive in a single column. */
  sign: z.enum(["debit_positive", "credit_positive", "dr_cr_suffix", "split_columns"]),
});

export const recipeFilterSchema = z.object({
  kind: z.enum(["exclude_ledger", "exclude_group"]),
  /** Ledger key or normalised group name. */
  match: z.string().min(1).max(2000),
  reason: z.string().min(1).max(200),
});

export const dimensionSchema = z.object({
  id: z.enum([
    "party",
    "product",
    "customer",
    "region",
    "channel",
    "salesperson",
    "branch",
    "designation",
  ]),
  source: z.string(),
  column: header,
});

export const METRIC_IDS = [
  "revenue",
  "direct_costs",
  "gross_profit",
  "gross_margin_pct",
  "employee_cost",
  "employee_cost_pct",
  "other_opex",
  "other_income",
  "ebitda",
  "ebitda_pct",
  "depreciation",
  "finance_cost",
  "exceptional_items",
  "pbt",
  "tax",
  "pat",
  "pat_pct",
  "receivables",
  "payables",
  "inventory",
  "cash_and_bank",
  "current_assets",
  "current_liabilities",
  "working_capital",
  "current_ratio",
  "quick_ratio",
  "dso",
  "dpo",
  "inventory_days",
  "cash_conversion_cycle",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export const recipeSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(recipeSourceSchema).min(1).max(100),
  filters: z.array(recipeFilterSchema).max(500).default([]),
  /** Mapping rules live beside the recipe in the blueprint; the recipe names their version. */
  mappingRulesVersion: z.number().int().positive(),
  period: z.object({
    fyStartMonth: z.number().int().min(1).max(12),
    granularity: z.literal("month"),
  }),
  dimensions: z.array(dimensionSchema).max(20).default([]),
  metrics: z
    .array(
      z.object({
        id: z.enum(METRIC_IDS),
        comparisons: z
          .array(z.enum(["mom", "yoy", "ytd", "ly_ytd", "variance"]))
          .default([]),
      }),
    )
    .min(1),
});
export type Recipe = z.infer<typeof recipeSchema>;
