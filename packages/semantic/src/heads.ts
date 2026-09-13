/**
 * Canonical MIS schema (SPEC §18). Schedule III Division I structure with management heads.
 *
 * This is the product's schema, not a business number: it is seeded into the global `mis_heads`
 * table by migration 0020 (generated from this list; `test/heads.test.ts` proves they match).
 *
 * `class` is the boundary a mapping must not cross: gross profit (direct vs indirect cost),
 * income vs expense, and balance sheet side. Tally's own placement of a ledger decides it.
 */

export type Statement = "pnl" | "balance_sheet" | "memo";
export type NormalBalance = "debit" | "credit";
export type HeadClass =
  "income" | "direct_cost" | "indirect_cost" | "equity_liability" | "asset" | "memo";

export interface HeadDef {
  readonly code: string;
  readonly parent: string | null;
  readonly name: string;
  readonly statement: Statement;
  readonly normalBalance: NormalBalance;
  readonly class: HeadClass;
  readonly scheduleIII: string | null;
  readonly sortOrder: number;
}

export const HEADS_VERSION = 1;

type Row = [
  code: string,
  parent: string | null,
  name: string,
  cls: HeadClass,
  scheduleIII: string | null,
];

const PNL: Row[] = [
  ["PL", null, "Statement of Profit and Loss", "memo", "Part II"],
  ["REV", "PL", "Revenue from operations", "income", "Part II I"],
  ["REV_PRODUCTS", "REV", "Sale of products", "income", "Note: revenue (a)"],
  ["REV_SERVICES", "REV", "Sale of services", "income", "Note: revenue (b)"],
  ["REV_OTHER_OPS", "REV", "Other operating revenue", "income", "Note: revenue (c)"],
  ["OTH_INC", "PL", "Other income", "income", "Part II II"],
  ["OTH_INC_INTEREST", "OTH_INC", "Interest income", "income", null],
  ["OTH_INC_OTHER", "OTH_INC", "Other non-operating income", "income", null],
  ["COGS", "PL", "Direct costs", "direct_cost", null],
  [
    "COGS_MATERIALS",
    "COGS",
    "Cost of materials consumed",
    "direct_cost",
    "Part II IV (a)",
  ],
  [
    "COGS_PURCHASES",
    "COGS",
    "Purchases of stock-in-trade",
    "direct_cost",
    "Part II IV (b)",
  ],
  ["COGS_INV_CHANGE", "COGS", "Changes in inventories", "direct_cost", "Part II IV (c)"],
  ["COGS_DIRECT", "COGS", "Direct expenses", "direct_cost", null],
  ["EMP", "PL", "Employee benefits expense", "indirect_cost", "Part II IV (d)"],
  ["EMP_SALARIES", "EMP", "Salaries and wages", "indirect_cost", null],
  [
    "EMP_CONTRIB",
    "EMP",
    "Contribution to provident and other funds",
    "indirect_cost",
    null,
  ],
  ["EMP_WELFARE", "EMP", "Staff welfare expenses", "indirect_cost", null],
  ["OPEX", "PL", "Other expenses", "indirect_cost", "Part II IV (f)"],
  ["OPEX_RENT", "OPEX", "Rent", "indirect_cost", null],
  ["OPEX_POWER", "OPEX", "Power and fuel", "indirect_cost", null],
  ["OPEX_REPAIRS", "OPEX", "Repairs and maintenance", "indirect_cost", null],
  ["OPEX_INSURANCE", "OPEX", "Insurance", "indirect_cost", null],
  ["OPEX_RATES", "OPEX", "Rates and taxes", "indirect_cost", null],
  ["OPEX_COMMS", "OPEX", "Communication", "indirect_cost", null],
  ["OPEX_PRINTING", "OPEX", "Printing and stationery", "indirect_cost", null],
  ["OPEX_TRAVEL", "OPEX", "Travelling and conveyance", "indirect_cost", null],
  ["OPEX_PROFESSIONAL", "OPEX", "Legal and professional fees", "indirect_cost", null],
  ["OPEX_AUDIT", "OPEX", "Payment to auditors", "indirect_cost", null],
  ["OPEX_MARKETING", "OPEX", "Advertising and sales promotion", "indirect_cost", null],
  ["OPEX_FREIGHT_OUT", "OPEX", "Freight outward", "indirect_cost", null],
  ["OPEX_BANK", "OPEX", "Bank charges", "indirect_cost", null],
  ["OPEX_SOFTWARE", "OPEX", "Software and subscriptions", "indirect_cost", null],
  ["OPEX_BAD_DEBTS", "OPEX", "Bad debts written off", "indirect_cost", null],
  ["OPEX_OTHER", "OPEX", "Miscellaneous expenses", "indirect_cost", null],
  [
    "DA",
    "PL",
    "Depreciation and amortisation expense",
    "indirect_cost",
    "Part II IV (e)",
  ],
  ["FIN", "PL", "Finance costs", "indirect_cost", "Part II IV (c) finance"],
  ["EXC", "PL", "Exceptional items", "indirect_cost", "Part II V"],
  ["TAX", "PL", "Tax expense", "indirect_cost", "Part II VIII"],
  ["TAX_CURRENT", "TAX", "Current tax", "indirect_cost", "Part II VIII (1)"],
  ["TAX_DEFERRED", "TAX", "Deferred tax", "indirect_cost", "Part II VIII (2)"],
];

const BS: Row[] = [
  ["BS", null, "Balance Sheet", "memo", "Part I"],
  ["EQ", "BS", "Shareholders' funds", "equity_liability", "Part I I (1)"],
  [
    "EQ_CAPITAL",
    "EQ",
    "Share capital / partners' capital",
    "equity_liability",
    "Part I I (1)(a)",
  ],
  ["EQ_RESERVES", "EQ", "Reserves and surplus", "equity_liability", "Part I I (1)(b)"],
  ["NCL", "BS", "Non-current liabilities", "equity_liability", "Part I I (3)"],
  [
    "NCL_BORROWINGS",
    "NCL",
    "Long-term borrowings",
    "equity_liability",
    "Part I I (3)(a)",
  ],
  [
    "NCL_OTHER",
    "NCL",
    "Other long-term liabilities",
    "equity_liability",
    "Part I I (3)(c)",
  ],
  ["CL", "BS", "Current liabilities", "equity_liability", "Part I I (4)"],
  ["CL_BORROWINGS", "CL", "Short-term borrowings", "equity_liability", "Part I I (4)(a)"],
  ["CL_PAYABLES", "CL", "Trade payables", "equity_liability", "Part I I (4)(b)"],
  ["CL_STATUTORY", "CL", "Statutory dues", "equity_liability", "Part I I (4)(c)"],
  ["CL_OTHER", "CL", "Other current liabilities", "equity_liability", "Part I I (4)(c)"],
  ["CL_PROVISIONS", "CL", "Short-term provisions", "equity_liability", "Part I I (4)(d)"],
  ["NCA", "BS", "Non-current assets", "asset", "Part I II (1)"],
  ["NCA_PPE", "NCA", "Property, plant and equipment", "asset", "Part I II (1)(a)(i)"],
  ["NCA_INTANGIBLES", "NCA", "Intangible assets", "asset", "Part I II (1)(a)(ii)"],
  ["NCA_INVESTMENTS", "NCA", "Non-current investments", "asset", "Part I II (1)(b)"],
  [
    "NCA_DEPOSITS",
    "NCA",
    "Long-term loans, advances and deposits",
    "asset",
    "Part I II (1)(d)",
  ],
  ["NCA_OTHER", "NCA", "Other non-current assets", "asset", "Part I II (1)(e)"],
  ["CA", "BS", "Current assets", "asset", "Part I II (2)"],
  ["CA_INVENTORY", "CA", "Inventories", "asset", "Part I II (2)(b)"],
  ["CA_RECEIVABLES", "CA", "Trade receivables", "asset", "Part I II (2)(c)"],
  ["CA_CASH", "CA", "Cash and bank balances", "asset", "Part I II (2)(d)"],
  ["CA_LOANS_ADV", "CA", "Short-term loans and advances", "asset", "Part I II (2)(e)"],
  ["CA_OTHER", "CA", "Other current assets", "asset", "Part I II (2)(f)"],
];

const MEMO: Row[] = [
  // SPEC §18: always visible, never dropped.
  ["UNMAPPED", null, "Unmapped", "memo", null],
];

const normalOf = (cls: HeadClass): NormalBalance =>
  cls === "income" || cls === "equity_liability" ? "credit" : "debit";

function build(rows: Row[], statement: Statement, base: number): HeadDef[] {
  return rows.map(([code, parent, name, cls, scheduleIII], i) => ({
    code,
    parent,
    name,
    statement,
    normalBalance: normalOf(cls),
    class: cls,
    scheduleIII,
    sortOrder: base + i * 10,
  }));
}

export const CANONICAL_HEADS: readonly HeadDef[] = [
  ...build(PNL, "pnl", 1000),
  ...build(BS, "balance_sheet", 5000),
  // UNMAPPED already exists (migration 0004) with sort order 9999.
  ...build(MEMO, "memo", 9999),
];

const BY_CODE = new Map(CANONICAL_HEADS.map((h) => [h.code, h]));

export function head(code: string): HeadDef {
  const h = BY_CODE.get(code);
  if (h === undefined) throw new RangeError(`unknown MIS head ${code}`);
  return h;
}

export const isHeadCode = (code: string): boolean => BY_CODE.has(code);

/** Root-first ancestry, including the head itself. */
export function ancestry(code: string): string[] {
  const out: string[] = [];
  let h: HeadDef | undefined = head(code);
  while (h !== undefined) {
    out.unshift(h.code);
    h = h.parent === null ? undefined : BY_CODE.get(h.parent);
  }
  return out;
}

export const isDescendantOrSelf = (code: string, ancestor: string): boolean =>
  ancestry(code).includes(ancestor);

/** Leaf heads a ledger can map to (non-root, no children). */
export const MAPPABLE_HEADS: readonly HeadDef[] = CANONICAL_HEADS.filter(
  (h) => h.parent !== null || h.code === "UNMAPPED",
);

export function childrenOf(code: string): HeadDef[] {
  return CANONICAL_HEADS.filter((h) => h.parent === code);
}
