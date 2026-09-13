/**
 * Report detection (SPEC §16). Title lines name most Tally exports; header vocabulary is the
 * fallback when titles were stripped. Unrecognised sheets are `generic` and go to AI-assisted
 * classification in a paid action (Phase 4), never guessed here.
 */

import type { ColumnProfile, HeaderDetection } from "@magicmis/ingest";
import type { SheetGrid } from "@magicmis/ingest";

import { assignRoles } from "./columns";

export type ReportType =
  | "trial_balance"
  | "profit_and_loss"
  | "balance_sheet"
  | "group_summary"
  | "ledger_vouchers"
  | "day_book"
  | "sales_register"
  | "purchase_register"
  | "stock_summary"
  | "bills_receivable"
  | "bills_payable"
  | "pay_sheet"
  | "generic";

export interface Detection {
  readonly type: ReportType;
  readonly confidence: number;
  readonly evidence: string;
}

const TITLES: readonly [RegExp, ReportType][] = [
  [/\btrial\s+balance\b/iu, "trial_balance"],
  [/\bprofit\s*(?:&|and)\s*loss\b/iu, "profit_and_loss"],
  [/\bbalance\s+sheet\b/iu, "balance_sheet"],
  [/\bgroup\s+summary\b/iu, "group_summary"],
  [/\bledger\s+vouchers?\b|^\s*ledger\s*:/imu, "ledger_vouchers"],
  [/\bday\s*book\b/iu, "day_book"],
  [/\bsales\s+register\b/iu, "sales_register"],
  [/\bpurchase\s+register\b/iu, "purchase_register"],
  [/\bstock\s+summary\b/iu, "stock_summary"],
  [/\bbills?\s+receivables?\b/iu, "bills_receivable"],
  [/\bbills?\s+payables?\b/iu, "bills_payable"],
  [/\bpay\s*sheet\b|\bsalary\s+register\b|\bpayroll\b/iu, "pay_sheet"],
];

export function detectReport(
  sheet: SheetGrid,
  header: HeaderDetection | null,
  _columns: readonly ColumnProfile[] = [],
): Detection {
  const titleText = [sheet.name, ...(header?.titleLines ?? [])].join("\n");
  for (const [re, type] of TITLES) {
    // Titles above the header are strong evidence; the sheet name alone is weaker.
    if (header?.titleLines.some((l) => re.test(l)))
      return { type, confidence: 0.95, evidence: "title" };
  }
  for (const [re, type] of TITLES) {
    if (re.test(titleText)) return { type, confidence: 0.75, evidence: "sheet name" };
  }

  if (header === null) return { type: "generic", confidence: 0, evidence: "no header" };
  const r = assignRoles(header.headers);
  const has = (...roles: (keyof typeof r)[]) => roles.every((x) => r[x] !== undefined);

  if (has("employee") && (has("net_pay") || has("gross_pay")))
    return { type: "pay_sheet", confidence: 0.7, evidence: "headers" };
  if (has("pending") && (has("due_on") || has("ref_no")))
    return {
      type: "bills_receivable",
      confidence: 0.5,
      evidence: "headers (side unknown)",
    };
  if (has("quantity", "rate", "value") && !has("date"))
    return { type: "stock_summary", confidence: 0.6, evidence: "headers" };
  if (has("date", "vch_type", "vch_no") && (has("taxable") || has("gstin")))
    return {
      type: "sales_register",
      confidence: 0.4,
      evidence: "headers (direction unknown)",
    };
  if (has("date", "vch_type", "vch_no"))
    return { type: "day_book", confidence: 0.6, evidence: "headers" };
  if (
    has("particulars") &&
    (has("closing_dr", "closing_cr") || has("debit", "credit") || has("closing"))
  ) {
    return { type: "trial_balance", confidence: 0.6, evidence: "headers" };
  }
  return { type: "generic", confidence: 0, evidence: "unrecognised" };
}
