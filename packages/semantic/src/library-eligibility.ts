/**
 * Global library eligibility (SPEC §18): which normalised ledger names may ever be counted toward a
 * library candidate. The global library holds generic account names only — never a party, a person,
 * or a redaction token — so a name must look like an accounting head and not like anyone's name.
 *
 * The rule is an allowlist: every word must be a known accounting or connecting word (this list plus
 * every word of the seeded global library), and at least one must be an accounting word. A name with
 * any other word — a person, a place, a brand — is never counted, so "loan from ramesh patel" cannot
 * reach the library even though it contains "loan". A name that fails is simply never proposed; the
 * account's own rule still works for that account. An admin still reviews every candidate.
 *
 * TODO(review): R-31 — the vocabulary and exclusion word lists below need review by a CA.
 */

import { GLOBAL_LIBRARY_SEED } from "./library";

/** A name must contain at least one of these words to look like an accounting head. */
const ACCOUNTING_WORDS = new Set([
  "account",
  "accounts",
  "advance",
  "advances",
  "advertisement",
  "advertising",
  "allowance",
  "amortisation",
  "audit",
  "bank",
  "bonus",
  "books",
  "brokerage",
  "capital",
  "cash",
  "cess",
  "charges",
  "commission",
  "consultancy",
  "contribution",
  "conveyance",
  "courier",
  "creditors",
  "customs",
  "debtors",
  "deposit",
  "deposits",
  "depreciation",
  "discount",
  "donation",
  "duty",
  "electricity",
  "employee",
  "entertainment",
  "esi",
  "expense",
  "expenses",
  "fees",
  "freight",
  "fuel",
  "gratuity",
  "gst",
  "income",
  "insurance",
  "interest",
  "internet",
  "inventory",
  "investment",
  "investments",
  "labour",
  "legal",
  "leave",
  "loan",
  "loans",
  "maintenance",
  "wages",
  "office",
  "outward",
  "inward",
  "packing",
  "penalty",
  "pf",
  "postage",
  "power",
  "premium",
  "printing",
  "professional",
  "provision",
  "purchase",
  "purchases",
  "rates",
  "refund",
  "reimbursement",
  "rent",
  "repairs",
  "reserve",
  "reserves",
  "revenue",
  "royalty",
  "salary",
  "salaries",
  "sales",
  "security",
  "software",
  "staff",
  "stationery",
  "stock",
  "subscription",
  "sundry",
  "suspense",
  "tax",
  "taxes",
  "tds",
  "tcs",
  "telephone",
  "transport",
  "travel",
  "travelling",
  "vehicle",
  "water",
  "welfare",
  "carriage",
  "cartage",
  "loading",
  "unloading",
  "hire",
  "lease",
  "rebate",
  "round",
  "off",
  "equity",
  "share",
  "premises",
  "furniture",
  "equipment",
  "machinery",
  "plant",
  "building",
  "computer",
  "computers",
  "goodwill",
  "igst",
  "cgst",
  "sgst",
  "utgst",
  "input",
  "output",
  "payable",
  "receivable",
  "prepaid",
  "accrued",
  "outstanding",
  "misc",
  "miscellaneous",
  "general",
  "petty",
  "bad",
  "debts",
]);

/** Honorifics mark a person; entity suffixes mark a party. */
const EXCLUDED_WORDS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "shri",
  "sri",
  "smt",
  "kumari",
  "dr",
  "m",
  "s",
  "pvt",
  "private",
  "ltd",
  "limited",
  "llp",
  "inc",
  "corp",
  "corporation",
  "co",
  "company",
  "traders",
  "trading",
  "enterprises",
  "industries",
  "agencies",
  "agency",
  "sons",
  "brothers",
  "bros",
  "associates",
  "exports",
  "imports",
  "impex",
  "overseas",
  "infotech",
  "solutions",
  "technologies",
  "huf",
  "proprietor",
  "partner",
  "director",
]);

/** Words that may sit between accounting words; on their own they make nothing eligible. */
const CONNECTING_WORDS = [
  "and",
  "of",
  "on",
  "to",
  "from",
  "for",
  "in",
  "at",
  "by",
  "the",
  "a",
  "ac",
  "with",
  "other",
  "others",
  "new",
  "old",
  "local",
  "direct",
  "indirect",
  "short",
  "long",
  "term",
  "current",
  "non",
  "fixed",
  "received",
  "paid",
  "written",
  "due",
  "net",
  "gross",
  "total",
  "exp",
  "exps",
];

/** Every word a library name may contain (SPEC §18 person/party exclusion by allowlist). */
const DICTIONARY: ReadonlySet<string> = new Set([
  ...ACCOUNTING_WORDS,
  ...CONNECTING_WORDS,
  ...GLOBAL_LIBRARY_SEED.flatMap((e) =>
    [e.name, ...e.aliases].flatMap((n) => n.split(" ")),
  ),
]);

const TOKEN_WORDS =
  "pan|aadhaar|uan|ifsc|bankac|gstin|email|mobile|person|party|sensitive";
const REDACTION_TOKEN = new RegExp(`\\b(${TOKEN_WORDS}) [0-9a-f]{12}\\b`, "u");
const LONG_DIGITS = /[0-9]{4,}/u;

export const LIBRARY_NAME_MAX_WORDS = 8;
export const LIBRARY_NAME_MAX_LENGTH = 80;

export type LibraryIneligibleReason =
  | "empty"
  | "too_long"
  | "redaction_token"
  | "digits"
  | "person_or_party"
  | "unknown_word"
  | "not_accounting_vocabulary";

/** `name` must already be normalised with `normaliseName`. */
export function libraryIneligibleReason(name: string): LibraryIneligibleReason | null {
  const words = name.split(" ").filter((w) => w !== "");
  if (words.length === 0) return "empty";
  if (name.length > LIBRARY_NAME_MAX_LENGTH || words.length > LIBRARY_NAME_MAX_WORDS)
    return "too_long";
  if (REDACTION_TOKEN.test(name)) return "redaction_token";
  if (LONG_DIGITS.test(name)) return "digits";
  if (words.some((w) => EXCLUDED_WORDS.has(w))) return "person_or_party";
  if (!words.every((w) => DICTIONARY.has(w))) return "unknown_word";
  if (!words.some((w) => ACCOUNTING_WORDS.has(w))) return "not_accounting_vocabulary";
  return null;
}
