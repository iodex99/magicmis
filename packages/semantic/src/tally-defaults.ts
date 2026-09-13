/**
 * Tally predefined group → default MIS head (SPEC §18: "a ledger under a known Tally group
 * inherits that group's default head unless a more specific rule exists").
 *
 * Group names come from `@magicmis/tally` (R-08). Suspense maps to Unmapped so it is always
 * visible and reviewed; Branch / Divisions have no statement meaning for one company's MIS.
 */

import { groupKey, PREDEFINED_GROUPS } from "@magicmis/tally";

export const TALLY_GROUP_DEFAULTS: Readonly<Record<string, string>> = {
  "Branch / Divisions": "UNMAPPED",
  "Capital Account": "EQ_CAPITAL",
  "Current Assets": "CA_OTHER",
  "Current Liabilities": "CL_OTHER",
  "Fixed Assets": "NCA_PPE",
  Investments: "NCA_INVESTMENTS",
  "Loans (Liability)": "NCL_BORROWINGS",
  "Misc. Expenses (ASSET)": "NCA_OTHER",
  "Suspense A/c": "UNMAPPED",
  "Direct Expenses": "COGS_DIRECT",
  "Direct Incomes": "REV_OTHER_OPS",
  "Indirect Expenses": "OPEX_OTHER",
  "Indirect Incomes": "OTH_INC_OTHER",
  "Purchase Accounts": "COGS_PURCHASES",
  "Sales Accounts": "REV_PRODUCTS",
  "Bank Accounts": "CA_CASH",
  "Bank OD A/c": "CL_BORROWINGS",
  "Cash-in-hand": "CA_CASH",
  "Deposits (Asset)": "NCA_DEPOSITS",
  "Duties & Taxes": "CL_STATUTORY",
  "Loans & Advances (Asset)": "CA_LOANS_ADV",
  Provisions: "CL_PROVISIONS",
  "Reserves & Surplus": "EQ_RESERVES",
  "Secured Loans": "NCL_BORROWINGS",
  "Stock-in-hand": "CA_INVENTORY",
  "Sundry Creditors": "CL_PAYABLES",
  "Sundry Debtors": "CA_RECEIVABLES",
  "Unsecured Loans": "NCL_BORROWINGS",
};

const BY_KEY = new Map(
  Object.entries(TALLY_GROUP_DEFAULTS).map(([name, code]) => [groupKey(name), code]),
);

/** Tally also shows a "Profit & Loss A/c" line and "Difference in opening balances". */
const SPECIAL_LEDGERS = new Map([
  [groupKey("Profit & Loss A/c"), "EQ_RESERVES"],
  [groupKey("Difference in opening balances"), "UNMAPPED"],
]);

export function groupDefaultHead(groupName: string): string | null {
  return BY_KEY.get(groupKey(groupName)) ?? null;
}

export function specialLedgerHead(name: string): string | null {
  return SPECIAL_LEDGERS.get(groupKey(name)) ?? null;
}

export const ALL_PREDEFINED_HAVE_DEFAULTS = PREDEFINED_GROUPS.every(
  (g) => groupDefaultHead(g.name) !== null,
);
