/**
 * Column roles from header text (SPEC §4: header-based parsing only, never positions).
 *
 * The vocabulary covers Tally's own headings and the ones other accounting systems export
 * ("Account", "Account Type", "Balance", "Net Balance", "Account Code"), so a trial balance
 * from any of them is read the same way (ADR 0031).
 */

import { normaliseHeader } from "@magicmis/ingest";

export type ColumnRole =
  | "particulars"
  | "level"
  | "parent_group"
  | "opening_dr"
  | "opening_cr"
  | "opening"
  | "debit"
  | "credit"
  | "closing_dr"
  | "closing_cr"
  | "closing"
  | "date"
  | "vch_type"
  | "vch_no"
  | "narration"
  | "gstin"
  | "taxable"
  | "cgst"
  | "sgst"
  | "igst"
  | "value"
  | "ref_no"
  | "due_on"
  | "overdue_days"
  | "pending"
  | "quantity"
  | "rate"
  | "employee"
  | "designation"
  | "net_pay"
  | "gross_pay"
  | "pay_component";

export type RoleMap = Partial<Record<ColumnRole, number>>;

interface Rule {
  /** Null marks a column that is recognised and deliberately given no role (an account code). */
  readonly role: ColumnRole | null;
  readonly test: (h: string) => boolean;
}

const has = (h: string, ...words: string[]) =>
  words.every((w) => new RegExp(`\\b${w}\\b`, "u").test(h));

const balance = (h: string) =>
  has(h, "closing") || has(h, "balance") || has(h, "ending") || has(h, "net");

const RULES: readonly Rule[] = [
  {
    role: "opening_dr",
    test: (h) => has(h, "opening") && (has(h, "debit") || has(h, "dr")),
  },
  {
    role: "opening_cr",
    test: (h) => has(h, "opening") && (has(h, "credit") || has(h, "cr")),
  },
  { role: "opening", test: (h) => has(h, "opening") },
  {
    role: "closing_dr",
    test: (h) => balance(h) && (has(h, "debit") || has(h, "dr")),
  },
  {
    role: "closing_cr",
    test: (h) => balance(h) && (has(h, "credit") || has(h, "cr")),
  },
  {
    role: "closing",
    test: (h) =>
      has(h, "closing") ||
      has(h, "balance") ||
      has(h, "ending") ||
      (has(h, "net") && !has(h, "pay") && !has(h, "salary")),
  },
  { role: "overdue_days", test: (h) => has(h, "overdue") },
  { role: "due_on", test: (h) => has(h, "due") },
  { role: "pending", test: (h) => has(h, "pending") },
  { role: "ref_no", test: (h) => has(h, "ref") || (has(h, "bill") && has(h, "no")) },
  {
    role: "vch_type",
    test: (h) => (has(h, "vch") || has(h, "voucher")) && has(h, "type"),
  },
  { role: "vch_no", test: (h) => (has(h, "vch") || has(h, "voucher")) && has(h, "no") },
  {
    role: "debit",
    test: (h) => has(h, "debit") || h === "dr" || has(h, "transactions", "debit"),
  },
  { role: "credit", test: (h) => has(h, "credit") || h === "cr" },
  { role: "date", test: (h) => has(h, "date") },
  { role: "narration", test: (h) => has(h, "narration") },
  { role: "gstin", test: (h) => has(h, "gstin") || has(h, "uin") },
  { role: "taxable", test: (h) => has(h, "taxable") },
  { role: "cgst", test: (h) => has(h, "cgst") },
  { role: "sgst", test: (h) => has(h, "sgst") || has(h, "utgst") },
  { role: "igst", test: (h) => has(h, "igst") },
  { role: "quantity", test: (h) => has(h, "quantity") || has(h, "qty") },
  { role: "rate", test: (h) => has(h, "rate") },
  {
    role: "employee",
    test: (h) => has(h, "employee") || has(h, "emp", "name") || has(h, "staff"),
  },
  { role: "designation", test: (h) => has(h, "designation") },
  { role: "net_pay", test: (h) => has(h, "net") },
  // Account codes and numbers identify a ledger but are not its name.
  {
    role: null,
    test: (h) =>
      has(h, "code") ||
      ((has(h, "account") || has(h, "ledger") || has(h, "gl")) &&
        (has(h, "no") || has(h, "number") || has(h, "id"))),
  },
  { role: "gross_pay", test: (h) => has(h, "gross") },
  { role: "value", test: (h) => has(h, "value") || has(h, "amount") },
  { role: "level", test: (h) => has(h, "level") },
  {
    role: "parent_group",
    test: (h) =>
      has(h, "group") ||
      has(h, "under") ||
      has(h, "parent") ||
      has(h, "type") ||
      has(h, "category") ||
      has(h, "class") ||
      has(h, "classification") ||
      has(h, "section"),
  },
  {
    role: "particulars",
    test: (h) =>
      has(h, "particulars") ||
      has(h, "ledger") ||
      has(h, "name") ||
      has(h, "item") ||
      has(h, "party") ||
      has(h, "account") ||
      has(h, "accounts") ||
      has(h, "description") ||
      has(h, "head") ||
      has(h, "gl"),
  },
];

/** Each column gets the first matching role; each role goes to its first column. */
export function assignRoles(headers: readonly string[]): RoleMap {
  const roles: RoleMap = {};
  headers.forEach((raw, index) => {
    const h = normaliseHeader(raw);
    for (const rule of RULES) {
      if (rule.test(h)) {
        if (rule.role !== null && roles[rule.role] === undefined)
          roles[rule.role] = index;
        return;
      }
    }
  });
  return roles;
}
