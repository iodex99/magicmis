/**
 * Statutory statements (ADR 0087): the balance sheet and profit and loss in the layout the
 * company's law or accounting framework uses — Schedule III in India, the Companies Act formats in
 * the United Kingdom, a classified balance sheet and multi-step income statement under US GAAP,
 * and IAS 1 everywhere else.
 *
 * Every line is a signed sum of canonical heads, written as SUMIFS over the Data sheet like every
 * other report cell and paired with the value computed here from the same cube for V11. Totals are
 * cell arithmetic over the lines above them, so a reader can trace each one. Nothing is a balancing
 * figure: reserves carry the year's profit not yet closed into them (the closing balance of every
 * profit-and-loss ledger), unmapped balances sit on the assets side in their own line, and the two
 * sides agree whenever the trial balances balance.
 *
 * TODO(review) R-86: the labels and the grouping follow each framework's published format but have
 * not been checked against the statute or standard by a qualified reviewer, and a management
 * workbook is not a filed statement — the cover says so for every sheet.
 */

import type { StatutoryFormat } from "@magicmis/core/reporting-conventions";
import {
  addMonths,
  financialYearOf,
  periodRange,
  type PeriodId,
} from "@magicmis/core/time";
import type { HeadCube } from "@magicmis/engine";

import { movementSum, type ColumnContext, type DataRange } from "./formulas";

/** A head and the sign it is summed with, debit-positive as the cube holds it. */
type Term = readonly [1 | -1, string];

export type StatutoryRow =
  | { readonly kind: "heading"; readonly id: string; readonly label: string }
  | {
      readonly kind: "line";
      readonly id: string;
      readonly label: string;
      readonly terms: readonly Term[];
      /** Credit balances read as positive: equity, liabilities and income. */
      readonly credit: boolean;
      readonly indent: number;
    }
  | {
      readonly kind: "total";
      readonly id: string;
      readonly label: string;
      /** Rows above it, by id, and the sign each is added with. */
      readonly of: readonly (readonly [1 | -1, string])[];
      readonly indent: number;
      readonly emphasis: boolean;
    };

export interface StatutoryStatement {
  readonly id: "balance_sheet" | "profit_and_loss";
  readonly sheet: string;
  readonly title: string;
  /** A balance sheet reads closing balances; a profit and loss, the movement. */
  readonly measure: "closing" | "movement";
  readonly rows: readonly StatutoryRow[];
}

const heading = (id: string, label: string): StatutoryRow => ({
  kind: "heading",
  id,
  label,
});
const cr = (
  id: string,
  label: string,
  terms: readonly Term[],
  indent = 1,
): StatutoryRow => ({
  kind: "line",
  id,
  label,
  terms,
  credit: true,
  indent,
});
const dr = (
  id: string,
  label: string,
  terms: readonly Term[],
  indent = 1,
): StatutoryRow => ({
  kind: "line",
  id,
  label,
  terms,
  credit: false,
  indent,
});
const total = (
  id: string,
  label: string,
  of: readonly (readonly [1 | -1, string])[],
  emphasis = false,
  indent = 0,
): StatutoryRow => ({ kind: "total", id, label, of, indent, emphasis });
const plus = (...ids: string[]) => ids.map((id) => [1, id] as const);

/** One head. */
const only = (code: string): Term[] => [[1, code]];
/** A parent head less some of its children: whatever else is mapped beneath it. */
const rest = (code: string, ...children: string[]): Term[] => [
  [1, code],
  ...children.map((c) => [-1, c] as const),
];

/** Reserves with the year's profit not yet closed into them: the closing of every P&L ledger. */
const RESERVES: Term[] = [...rest("EQ", "EQ_CAPITAL"), [1, "PL"]];
const UNMAPPED = (indent: number) =>
  dr("unmapped", "Unmapped balances (to be mapped)", only("UNMAPPED"), indent);

const SCHEDULE_III: readonly StatutoryStatement[] = [
  {
    id: "balance_sheet",
    sheet: "Schedule III balance sheet",
    title: "Balance sheet (Schedule III)",
    measure: "closing",
    rows: [
      heading("equity_and_liabilities", "Equity and liabilities"),
      heading("shareholders_funds", "Shareholders' funds"),
      cr("share_capital", "Share capital", only("EQ_CAPITAL")),
      cr("reserves", "Reserves and surplus, with profit for the year to date", RESERVES),
      total(
        "shareholders_total",
        "Total shareholders' funds",
        plus("share_capital", "reserves"),
      ),
      heading("non_current_liabilities", "Non-current liabilities"),
      cr("lt_borrowings", "Long-term borrowings", only("NCL_BORROWINGS")),
      cr("lt_other", "Other long-term liabilities", rest("NCL", "NCL_BORROWINGS")),
      total(
        "ncl_total",
        "Total non-current liabilities",
        plus("lt_borrowings", "lt_other"),
      ),
      heading("current_liabilities", "Current liabilities"),
      cr("st_borrowings", "Short-term borrowings", only("CL_BORROWINGS")),
      cr("trade_payables", "Trade payables", only("CL_PAYABLES")),
      cr(
        "other_cl",
        "Other current liabilities",
        rest("CL", "CL_BORROWINGS", "CL_PAYABLES", "CL_PROVISIONS"),
      ),
      cr("st_provisions", "Short-term provisions", only("CL_PROVISIONS")),
      total(
        "cl_total",
        "Total current liabilities",
        plus("st_borrowings", "trade_payables", "other_cl", "st_provisions"),
      ),
      total(
        "equity_and_liabilities_total",
        "Total equity and liabilities",
        plus("shareholders_total", "ncl_total", "cl_total"),
        true,
      ),
      heading("assets", "Assets"),
      heading("non_current_assets", "Non-current assets"),
      dr("ppe", "Property, plant and equipment", only("NCA_PPE")),
      dr("intangibles", "Intangible assets", only("NCA_INTANGIBLES")),
      dr("nc_investments", "Non-current investments", only("NCA_INVESTMENTS")),
      dr("lt_loans", "Long-term loans and advances", only("NCA_DEPOSITS")),
      dr(
        "other_nca",
        "Other non-current assets",
        rest("NCA", "NCA_PPE", "NCA_INTANGIBLES", "NCA_INVESTMENTS", "NCA_DEPOSITS"),
      ),
      total(
        "nca_total",
        "Total non-current assets",
        plus("ppe", "intangibles", "nc_investments", "lt_loans", "other_nca"),
      ),
      heading("current_assets", "Current assets"),
      dr("inventories", "Inventories", only("CA_INVENTORY")),
      dr("trade_receivables", "Trade receivables", only("CA_RECEIVABLES")),
      dr("cash", "Cash and cash equivalents", only("CA_CASH")),
      dr("st_loans", "Short-term loans and advances", only("CA_LOANS_ADV")),
      dr(
        "other_ca",
        "Other current assets",
        rest("CA", "CA_INVENTORY", "CA_RECEIVABLES", "CA_CASH", "CA_LOANS_ADV"),
      ),
      total(
        "ca_total",
        "Total current assets",
        plus("inventories", "trade_receivables", "cash", "st_loans", "other_ca"),
      ),
      UNMAPPED(0),
      total(
        "assets_total",
        "Total assets",
        plus("nca_total", "ca_total", "unmapped"),
        true,
      ),
    ],
  },
  {
    id: "profit_and_loss",
    sheet: "Schedule III profit and loss",
    title: "Statement of profit and loss (Schedule III)",
    measure: "movement",
    rows: [
      cr("revenue", "Revenue from operations", only("REV"), 0),
      cr("other_income", "Other income", only("OTH_INC"), 0),
      total("total_income", "Total income", plus("revenue", "other_income"), true),
      heading("expenses", "Expenses"),
      dr("materials", "Cost of materials consumed", only("COGS_MATERIALS")),
      dr("purchases", "Purchases of stock-in-trade", only("COGS_PURCHASES")),
      dr(
        "inventory_change",
        "Changes in inventories of finished goods, work-in-progress and stock-in-trade",
        only("COGS_INV_CHANGE"),
      ),
      dr("employee", "Employee benefits expense", only("EMP")),
      dr("finance", "Finance costs", only("FIN")),
      dr("depreciation", "Depreciation and amortisation expense", only("DA")),
      dr("other_expenses", "Other expenses", [
        [1, "OPEX"],
        ...rest("COGS", "COGS_MATERIALS", "COGS_PURCHASES", "COGS_INV_CHANGE"),
      ]),
      total(
        "total_expenses",
        "Total expenses",
        plus(
          "materials",
          "purchases",
          "inventory_change",
          "employee",
          "finance",
          "depreciation",
          "other_expenses",
        ),
        true,
      ),
      total("before_exceptional", "Profit before exceptional items and tax", [
        [1, "total_income"],
        [-1, "total_expenses"],
      ]),
      dr("exceptional", "Exceptional items", only("EXC"), 0),
      total("pbt", "Profit before tax", [
        [1, "before_exceptional"],
        [-1, "exceptional"],
      ]),
      heading("tax_expense", "Tax expense"),
      dr("current_tax", "Current tax", rest("TAX", "TAX_DEFERRED")),
      dr("deferred_tax", "Deferred tax", only("TAX_DEFERRED")),
      total(
        "profit",
        "Profit for the period",
        [
          [1, "pbt"],
          [-1, "current_tax"],
          [-1, "deferred_tax"],
        ],
        true,
      ),
    ],
  },
];

const UK: readonly StatutoryStatement[] = [
  {
    id: "balance_sheet",
    sheet: "Balance sheet (Format 1)",
    title: "Balance sheet (Companies Act, Format 1)",
    measure: "closing",
    rows: [
      heading("fixed_assets", "Fixed assets"),
      dr("intangibles", "Intangible assets", only("NCA_INTANGIBLES")),
      dr("tangibles", "Tangible assets", only("NCA_PPE")),
      dr("investments", "Investments", only("NCA_INVESTMENTS")),
      total(
        "fixed_total",
        "Total fixed assets",
        plus("intangibles", "tangibles", "investments"),
      ),
      heading("current_assets", "Current assets"),
      dr("stocks", "Stocks", only("CA_INVENTORY")),
      dr(
        "debtors_within",
        "Debtors: due within one year",
        rest("CA", "CA_INVENTORY", "CA_CASH"),
      ),
      dr(
        "debtors_after",
        "Debtors: due after more than one year",
        rest("NCA", "NCA_INTANGIBLES", "NCA_PPE", "NCA_INVESTMENTS"),
      ),
      dr("cash", "Cash at bank and in hand", only("CA_CASH")),
      total(
        "ca_total",
        "Total current assets",
        plus("stocks", "debtors_within", "debtors_after", "cash"),
      ),
      cr(
        "creditors_within",
        "Creditors: amounts falling due within one year",
        only("CL"),
        0,
      ),
      total("net_current_assets", "Net current assets (liabilities)", [
        [1, "ca_total"],
        [-1, "creditors_within"],
      ]),
      total(
        "total_less_current",
        "Total assets less current liabilities",
        plus("fixed_total", "net_current_assets"),
      ),
      cr(
        "creditors_after",
        "Creditors: amounts falling due after more than one year",
        only("NCL"),
        0,
      ),
      UNMAPPED(0),
      total(
        "net_assets",
        "Net assets",
        [
          [1, "total_less_current"],
          [-1, "creditors_after"],
          [1, "unmapped"],
        ],
        true,
      ),
      heading("capital_and_reserves", "Capital and reserves"),
      cr("share_capital", "Called up share capital", only("EQ_CAPITAL")),
      cr(
        "pl_reserve",
        "Profit and loss account, with profit for the year to date",
        RESERVES,
      ),
      total(
        "shareholders_funds",
        "Shareholders' funds",
        plus("share_capital", "pl_reserve"),
        true,
      ),
    ],
  },
  {
    id: "profit_and_loss",
    sheet: "Profit and loss (Format 1)",
    title: "Profit and loss account (Companies Act, Format 1)",
    measure: "movement",
    rows: [
      cr("turnover", "Turnover", only("REV"), 0),
      dr("cost_of_sales", "Cost of sales", only("COGS"), 0),
      total("gross_profit", "Gross profit", [
        [1, "turnover"],
        [-1, "cost_of_sales"],
      ]),
      dr("administrative", "Administrative expenses", [
        [1, "EMP"],
        [1, "OPEX"],
        [1, "DA"],
      ]),
      cr(
        "other_operating_income",
        "Other operating income",
        rest("OTH_INC", "OTH_INC_INTEREST"),
      ),
      total("operating_profit", "Operating profit", [
        [1, "gross_profit"],
        [-1, "administrative"],
        [1, "other_operating_income"],
      ]),
      cr(
        "interest_receivable",
        "Interest receivable and similar income",
        only("OTH_INC_INTEREST"),
      ),
      dr("interest_payable", "Interest payable and similar expenses", only("FIN")),
      dr("exceptional", "Exceptional items", only("EXC")),
      total(
        "pbt",
        "Profit before taxation",
        [
          [1, "operating_profit"],
          [1, "interest_receivable"],
          [-1, "interest_payable"],
          [-1, "exceptional"],
        ],
        true,
      ),
      dr("tax", "Tax on profit", only("TAX"), 0),
      total(
        "profit",
        "Profit for the financial year",
        [
          [1, "pbt"],
          [-1, "tax"],
        ],
        true,
      ),
    ],
  },
];

const US_GAAP: readonly StatutoryStatement[] = [
  {
    id: "balance_sheet",
    sheet: "Balance sheet (US GAAP)",
    title: "Classified balance sheet (US GAAP)",
    measure: "closing",
    rows: [
      heading("assets", "Assets"),
      heading("current_assets", "Current assets"),
      dr("cash", "Cash and cash equivalents", only("CA_CASH")),
      dr("receivables", "Accounts receivable, net", only("CA_RECEIVABLES")),
      dr("inventories", "Inventories", only("CA_INVENTORY")),
      dr(
        "other_ca",
        "Prepaid expenses and other current assets",
        rest("CA", "CA_CASH", "CA_RECEIVABLES", "CA_INVENTORY"),
      ),
      total(
        "ca_total",
        "Total current assets",
        plus("cash", "receivables", "inventories", "other_ca"),
      ),
      dr("ppe", "Property and equipment, net", only("NCA_PPE"), 0),
      dr("intangibles", "Intangible assets, net", only("NCA_INTANGIBLES"), 0),
      dr("investments", "Investments", only("NCA_INVESTMENTS"), 0),
      dr(
        "other_assets",
        "Other assets",
        rest("NCA", "NCA_PPE", "NCA_INTANGIBLES", "NCA_INVESTMENTS"),
        0,
      ),
      UNMAPPED(0),
      total(
        "assets_total",
        "Total assets",
        plus("ca_total", "ppe", "intangibles", "investments", "other_assets", "unmapped"),
        true,
      ),
      heading("liabilities_and_equity", "Liabilities and equity"),
      heading("current_liabilities", "Current liabilities"),
      cr("payables", "Accounts payable", only("CL_PAYABLES")),
      cr("st_debt", "Short-term debt", only("CL_BORROWINGS")),
      cr(
        "accrued",
        "Accrued expenses and other current liabilities",
        rest("CL", "CL_PAYABLES", "CL_BORROWINGS"),
      ),
      total(
        "cl_total",
        "Total current liabilities",
        plus("payables", "st_debt", "accrued"),
      ),
      cr("lt_debt", "Long-term debt", only("NCL_BORROWINGS"), 0),
      cr("other_ltl", "Other long-term liabilities", rest("NCL", "NCL_BORROWINGS"), 0),
      total(
        "liabilities_total",
        "Total liabilities",
        plus("cl_total", "lt_debt", "other_ltl"),
      ),
      heading("equity", "Equity"),
      cr("paid_in", "Paid-in capital", only("EQ_CAPITAL")),
      cr("retained", "Retained earnings, with net income for the year to date", RESERVES),
      total("equity_total", "Total equity", plus("paid_in", "retained")),
      total(
        "liabilities_and_equity_total",
        "Total liabilities and equity",
        plus("liabilities_total", "equity_total"),
        true,
      ),
    ],
  },
  {
    id: "profit_and_loss",
    sheet: "Income statement (US GAAP)",
    title: "Income statement (US GAAP)",
    measure: "movement",
    rows: [
      cr("revenue", "Revenue", only("REV"), 0),
      dr("cost_of_revenue", "Cost of revenue", only("COGS"), 0),
      total("gross_profit", "Gross profit", [
        [1, "revenue"],
        [-1, "cost_of_revenue"],
      ]),
      heading("operating_expenses", "Operating expenses"),
      dr("salaries", "Salaries and benefits", only("EMP")),
      dr("depreciation", "Depreciation and amortization", only("DA")),
      dr("other_opex", "Other operating expenses", only("OPEX")),
      total(
        "opex_total",
        "Total operating expenses",
        plus("salaries", "depreciation", "other_opex"),
      ),
      total("operating_income", "Operating income", [
        [1, "gross_profit"],
        [-1, "opex_total"],
      ]),
      dr("interest", "Interest expense", only("FIN"), 0),
      cr("other_income", "Other income", only("OTH_INC"), 0),
      dr("unusual", "Unusual or infrequent items", only("EXC"), 0),
      total(
        "pre_tax",
        "Income before income taxes",
        [
          [1, "operating_income"],
          [-1, "interest"],
          [1, "other_income"],
          [-1, "unusual"],
        ],
        true,
      ),
      dr("income_tax", "Income tax expense", only("TAX"), 0),
      total(
        "net_income",
        "Net income",
        [
          [1, "pre_tax"],
          [-1, "income_tax"],
        ],
        true,
      ),
    ],
  },
];

const IFRS: readonly StatutoryStatement[] = [
  {
    id: "balance_sheet",
    sheet: "Financial position (IFRS)",
    title: "Statement of financial position (IAS 1)",
    measure: "closing",
    rows: [
      heading("assets", "Assets"),
      heading("non_current_assets", "Non-current assets"),
      dr("ppe", "Property, plant and equipment", only("NCA_PPE")),
      dr("intangibles", "Intangible assets", only("NCA_INTANGIBLES")),
      dr("investments", "Investments", only("NCA_INVESTMENTS")),
      dr(
        "other_nca",
        "Other non-current assets",
        rest("NCA", "NCA_PPE", "NCA_INTANGIBLES", "NCA_INVESTMENTS"),
      ),
      total(
        "nca_total",
        "Total non-current assets",
        plus("ppe", "intangibles", "investments", "other_nca"),
      ),
      heading("current_assets", "Current assets"),
      dr("inventories", "Inventories", only("CA_INVENTORY")),
      dr(
        "receivables",
        "Trade and other receivables",
        rest("CA", "CA_INVENTORY", "CA_CASH"),
      ),
      dr("cash", "Cash and cash equivalents", only("CA_CASH")),
      total(
        "ca_total",
        "Total current assets",
        plus("inventories", "receivables", "cash"),
      ),
      UNMAPPED(0),
      total(
        "assets_total",
        "Total assets",
        plus("nca_total", "ca_total", "unmapped"),
        true,
      ),
      heading("equity_and_liabilities", "Equity and liabilities"),
      heading("equity", "Equity"),
      cr("share_capital", "Share capital", only("EQ_CAPITAL")),
      cr(
        "reserves",
        "Retained earnings and other reserves, with profit to date",
        RESERVES,
      ),
      total("equity_total", "Total equity", plus("share_capital", "reserves")),
      heading("non_current_liabilities", "Non-current liabilities"),
      cr("nc_borrowings", "Borrowings", only("NCL_BORROWINGS")),
      cr("other_ncl", "Other non-current liabilities", rest("NCL", "NCL_BORROWINGS")),
      total(
        "ncl_total",
        "Total non-current liabilities",
        plus("nc_borrowings", "other_ncl"),
      ),
      heading("current_liabilities", "Current liabilities"),
      cr(
        "payables",
        "Trade and other payables",
        rest("CL", "CL_BORROWINGS", "CL_PROVISIONS"),
      ),
      cr("c_borrowings", "Borrowings", only("CL_BORROWINGS")),
      cr("provisions", "Provisions", only("CL_PROVISIONS")),
      total(
        "cl_total",
        "Total current liabilities",
        plus("payables", "c_borrowings", "provisions"),
      ),
      total(
        "equity_and_liabilities_total",
        "Total equity and liabilities",
        plus("equity_total", "ncl_total", "cl_total"),
        true,
      ),
    ],
  },
  {
    id: "profit_and_loss",
    sheet: "Profit or loss (IFRS)",
    title: "Statement of profit or loss, by nature (IAS 1)",
    measure: "movement",
    rows: [
      cr("revenue", "Revenue", only("REV"), 0),
      cr("other_income", "Other income", only("OTH_INC"), 0),
      dr("inventory_change", "Changes in inventories", only("COGS_INV_CHANGE")),
      dr(
        "materials",
        "Raw materials, goods and other direct costs",
        rest("COGS", "COGS_INV_CHANGE"),
      ),
      dr("employee", "Employee benefits expense", only("EMP")),
      dr("depreciation", "Depreciation and amortisation expense", only("DA")),
      dr("other_expenses", "Other expenses", only("OPEX")),
      dr("exceptional", "Exceptional items", only("EXC")),
      dr("finance", "Finance costs", only("FIN")),
      total(
        "pbt",
        "Profit before tax",
        [
          [1, "revenue"],
          [1, "other_income"],
          [-1, "inventory_change"],
          [-1, "materials"],
          [-1, "employee"],
          [-1, "depreciation"],
          [-1, "other_expenses"],
          [-1, "exceptional"],
          [-1, "finance"],
        ],
        true,
      ),
      dr("income_tax", "Income tax expense", only("TAX"), 0),
      total(
        "profit",
        "Profit for the period",
        [
          [1, "pbt"],
          [-1, "income_tax"],
        ],
        true,
      ),
    ],
  },
];

/** The statements a format adds to the workbook; none for "none". */
export function statutoryStatements(
  format: StatutoryFormat,
): readonly StatutoryStatement[] {
  switch (format) {
    case "schedule_iii":
      return SCHEDULE_III;
    case "uk_companies_act":
      return UK;
    case "us_gaap":
      return US_GAAP;
    case "ifrs":
      return IFRS;
    case "none":
      return [];
  }
}

/** A column of a statutory statement: one month, or the year to the month. */
export interface StatutoryColumn {
  readonly header: string;
  readonly kind: "period" | "ytd";
  readonly period: PeriodId;
}

/**
 * The value of a line in a column, in paise and in the line's own direction, or null where the
 * column has no value: a month not loaded, a movement the books did not report, or a year to date
 * with a month missing — the same cases in which the engine's own figures are blank.
 */
export function lineValue(
  cube: HeadCube,
  statement: StatutoryStatement,
  terms: readonly Term[],
  credit: boolean,
  column: StatutoryColumn,
): bigint | null {
  const months =
    column.kind === "period"
      ? [column.period]
      : periodRange(
          financialYearOf(column.period, cube.fyStartMonth).start,
          column.period,
        );
  let sum = 0n;
  for (const month of months) {
    if (!cube.periods.includes(month)) return null;
    for (const [sign, code] of terms) {
      const v = cube.get(code, month);
      if (v === null) continue;
      if (statement.measure === "closing") sum += BigInt(sign) * v.closing;
      else {
        if (v.movement === null) return null;
        sum += BigInt(sign) * v.movement;
      }
    }
  }
  return credit ? -sum : sum;
}

/** The SUMIFS formula body (no leading "=") for a line in a column. */
export function lineFormula(
  statement: StatutoryStatement,
  terms: readonly Term[],
  credit: boolean,
  col: ColumnContext,
  data: DataRange,
): string {
  const parts = terms.map(([sign, code], i) => {
    const path = `"*/${code}/*"`;
    const sum =
      statement.measure === "closing"
        ? `SUMIFS(${data.col("amount_paise")},${data.col("period_index")},${col.indexCell},${data.col("head_path")},${path},${data.col("measure")},"closing")`
        : movementSum(data, col, path);
    return `${i === 0 ? (sign === 1 ? "" : "-") : sign === 1 ? "+" : "-"}${sum}`;
  });
  return `${credit ? "-" : ""}(${parts.join("")})/100`;
}

/** The columns: the month and the same month a year earlier, or the month and the year to it. */
export function statutoryColumns(
  statement: StatutoryStatement,
  period: PeriodId,
  cube: HeadCube,
  label: (p: PeriodId) => string,
): StatutoryColumn[] {
  const lastYear = addMonths(period, -12);
  if (statement.measure === "closing") {
    const cols: StatutoryColumn[] = [
      { header: `As at ${label(period)}`, kind: "period", period },
    ];
    if (cube.periods.includes(lastYear))
      cols.push({ header: `As at ${label(lastYear)}`, kind: "period", period: lastYear });
    return cols;
  }
  const cols: StatutoryColumn[] = [
    { header: label(period), kind: "period", period },
    { header: "Year to date", kind: "ytd", period },
  ];
  if (cube.periods.includes(lastYear))
    cols.push({ header: "Last year to date", kind: "ytd", period: lastYear });
  return cols;
}

/** How a line is built, in words, for the Lineage sheet. */
export function lineDescription(
  statement: StatutoryStatement,
  terms: readonly Term[],
  credit: boolean,
): string {
  const field = statement.measure === "closing" ? "closing" : "movement";
  const body = terms
    .map(
      ([sign, code], i) =>
        `${i === 0 ? (sign === 1 ? "" : "− ") : sign === 1 ? "+ " : "− "}${field}(${code})`,
    )
    .join(" ");
  return credit ? `−(${body})` : body;
}
