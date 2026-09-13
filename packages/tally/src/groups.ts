/**
 * Tally's pre-defined account groups (SPEC §16).
 *
 * Names, the primary/sub-group split, sub-group parents and the Balance Sheet / Profit & Loss
 * split are verified against https://help.tallysolutions.com/docs/te9rel66/Creating_Masters/Accounts_Info/p.htm
 * (Tally.ERP 9 help, 2026-09-13). TallyPrime's groups page confirms 15 primary + 13 sub-groups
 * but does not enumerate them.
 *
 * TODO(review): R-08 — confirm the list in TallyPrime itself, and confirm each group's nature
 * (asset/liability/income/expense) and gross-profit flag, which the verified page does not
 * state. The MIS head and Schedule III mapping attach in Phase 5 (`mis_heads`).
 */

export type StatementKind = "balance_sheet" | "profit_and_loss";
export type Nature = "asset" | "liability" | "income" | "expense";

export interface PredefinedGroup {
  readonly name: string;
  readonly parent: string | null;
  readonly statement: StatementKind;
  readonly nature: Nature;
  /** Trading-account groups that determine gross profit. */
  readonly grossProfit: boolean;
}

const bs = (
  name: string,
  nature: Nature,
  parent: string | null = null,
): PredefinedGroup => ({
  name,
  parent,
  statement: "balance_sheet",
  nature,
  grossProfit: false,
});
const pl = (name: string, nature: Nature, grossProfit: boolean): PredefinedGroup => ({
  name,
  parent: null,
  statement: "profit_and_loss",
  nature,
  grossProfit,
});

export const PREDEFINED_GROUPS: readonly PredefinedGroup[] = [
  // 15 primary groups: 9 Balance Sheet, 6 Profit & Loss.
  bs("Branch / Divisions", "liability"),
  bs("Capital Account", "liability"),
  bs("Current Assets", "asset"),
  bs("Current Liabilities", "liability"),
  bs("Fixed Assets", "asset"),
  bs("Investments", "asset"),
  bs("Loans (Liability)", "liability"),
  bs("Misc. Expenses (ASSET)", "asset"),
  bs("Suspense A/c", "liability"),
  pl("Direct Expenses", "expense", true),
  pl("Direct Incomes", "income", true),
  pl("Indirect Expenses", "expense", false),
  pl("Indirect Incomes", "income", false),
  pl("Purchase Accounts", "expense", true),
  pl("Sales Accounts", "income", true),
  // 13 sub-groups with their parents.
  bs("Bank Accounts", "asset", "Current Assets"),
  bs("Bank OD A/c", "liability", "Loans (Liability)"),
  bs("Cash-in-hand", "asset", "Current Assets"),
  bs("Deposits (Asset)", "asset", "Current Assets"),
  bs("Duties & Taxes", "liability", "Current Liabilities"),
  bs("Loans & Advances (Asset)", "asset", "Current Assets"),
  bs("Provisions", "liability", "Current Liabilities"),
  bs("Reserves & Surplus", "liability", "Capital Account"),
  bs("Secured Loans", "liability", "Loans (Liability)"),
  bs("Stock-in-hand", "asset", "Current Assets"),
  bs("Sundry Creditors", "liability", "Current Liabilities"),
  bs("Sundry Debtors", "asset", "Current Assets"),
  bs("Unsecured Loans", "liability", "Loans (Liability)"),
];

/** Case, spacing, "&"/"and" and punctuation-insensitive key. */
export function groupKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

const BY_KEY = new Map(PREDEFINED_GROUPS.map((g) => [groupKey(g.name), g]));

export function predefinedGroup(name: string): PredefinedGroup | null {
  return BY_KEY.get(groupKey(name)) ?? null;
}

/** Primary ancestor of a predefined group ("Sundry Debtors" → "Current Assets"). */
export function primaryOf(name: string): PredefinedGroup | null {
  let g = predefinedGroup(name);
  while (g?.parent) g = predefinedGroup(g.parent);
  return g;
}

/** Party groups whose ledgers are tokenised (SPEC §17). */
export const PARTY_GROUP_KEYS = new Set([
  groupKey("Sundry Debtors"),
  groupKey("Sundry Creditors"),
]);
