/**
 * Global mapping library seed (SPEC §18): common Indian ledger and group names with their head.
 * Seeded into `global_mapping_library` (`source = 'seed'`) by migration 0020. Promoted entries
 * are added only by an admin. Names are generic — no party, person or tenant names.
 *
 * Each entry: canonical name, aliases, head code.
 */

import { normaliseName } from "./normalise";

export interface LibraryEntry {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly head: string;
}

type Seed = [name: string, aliases: string[], head: string];

const SEED: Seed[] = [
  // Revenue
  [
    "sales",
    ["sales account", "sale of goods", "domestic sales", "local sales"],
    "REV_PRODUCTS",
  ],
  ["export sales", ["sales export", "exports"], "REV_PRODUCTS"],
  ["interstate sales", ["inter state sales", "igst sales"], "REV_PRODUCTS"],
  [
    "service income",
    ["income from services", "service charges received", "consultancy income"],
    "REV_SERVICES",
  ],
  [
    "job work income",
    ["job work charges received", "labour charges received"],
    "REV_SERVICES",
  ],
  ["scrap sales", ["sale of scrap"], "REV_OTHER_OPS"],
  ["export incentives", ["duty drawback"], "REV_OTHER_OPS"],
  ["sales returns", ["sales return"], "REV_PRODUCTS"],
  // Other income
  [
    "interest received",
    [
      "interest income",
      "interest on fixed deposit",
      "interest on savings",
      "interest on deposits",
    ],
    "OTH_INC_INTEREST",
  ],
  ["discount received", ["discounts received"], "OTH_INC_OTHER"],
  ["dividend received", ["dividend income"], "OTH_INC_OTHER"],
  ["rent received", ["rental income"], "OTH_INC_OTHER"],
  ["profit on sale of fixed assets", ["profit on sale of assets"], "OTH_INC_OTHER"],
  ["foreign exchange gain", ["forex gain", "exchange gain"], "OTH_INC_OTHER"],
  ["miscellaneous income", ["other income", "sundry income"], "OTH_INC_OTHER"],
  // Direct costs
  [
    "purchases",
    ["purchase account", "purchase of goods", "local purchases"],
    "COGS_PURCHASES",
  ],
  ["import purchases", ["purchase import", "imports"], "COGS_PURCHASES"],
  ["interstate purchases", ["inter state purchases", "igst purchases"], "COGS_PURCHASES"],
  ["purchase returns", ["purchase return"], "COGS_PURCHASES"],
  [
    "raw material consumed",
    ["raw materials consumed", "consumption of raw material"],
    "COGS_MATERIALS",
  ],
  ["purchase of raw material", ["raw material purchases"], "COGS_MATERIALS"],
  ["packing material", ["packing materials", "packaging material"], "COGS_MATERIALS"],
  [
    "changes in inventory",
    ["change in inventory", "changes in inventories", "increase decrease in stock"],
    "COGS_INV_CHANGE",
  ],
  ["opening stock", [], "COGS_INV_CHANGE"],
  [
    "freight inward",
    ["carriage inward", "freight inwards", "cartage inward"],
    "COGS_DIRECT",
  ],
  ["job work charges", ["job work expenses", "labour charges"], "COGS_DIRECT"],
  ["manufacturing expenses", ["factory expenses", "production expenses"], "COGS_DIRECT"],
  ["direct expenses", [], "COGS_DIRECT"],
  ["custom duty", ["customs duty", "import duty"], "COGS_DIRECT"],
  ["factory wages", ["direct wages", "direct labour"], "COGS_DIRECT"],
  // Employee
  [
    "salary",
    [
      "salary and wages",
      "salary account",
      "staff salary",
      "salary to staff",
      "wages",
      "salary and allowances",
    ],
    "EMP_SALARIES",
  ],
  [
    "employee costs",
    [
      "employee benefits expenses",
      "employee benefit expenses",
      "staff costs",
      "personnel costs",
    ],
    "EMP_SALARIES",
  ],
  ["bonus", ["bonus to staff", "incentives to staff"], "EMP_SALARIES"],
  [
    "directors remuneration",
    ["partners remuneration", "remuneration to partners", "remuneration to directors"],
    "EMP_SALARIES",
  ],
  ["gratuity", ["leave encashment"], "EMP_SALARIES"],
  [
    "employer contribution to provident fund",
    ["contribution to provident fund", "provident fund contribution", "employer pf"],
    "EMP_CONTRIB",
  ],
  [
    "employer contribution to esic",
    ["contribution to esic", "esic contribution", "employer esic"],
    "EMP_CONTRIB",
  ],
  ["staff welfare", ["staff welfare expenses", "employee welfare"], "EMP_WELFARE"],
  // Other expenses
  [
    "rent",
    ["office rent", "rent paid", "rent account", "warehouse rent", "godown rent"],
    "OPEX_RENT",
  ],
  [
    "electricity",
    ["electricity charges", "electricity expenses", "power and fuel", "power charges"],
    "OPEX_POWER",
  ],
  [
    "repairs and maintenance",
    ["repairs", "maintenance", "repair and maintenance"],
    "OPEX_REPAIRS",
  ],
  ["insurance", ["insurance expenses", "insurance premium"], "OPEX_INSURANCE"],
  ["rates and taxes", ["municipal taxes", "property tax"], "OPEX_RATES"],
  [
    "telephone",
    [
      "telephone and internet",
      "telephone expenses",
      "internet charges",
      "mobile expenses",
      "communication expenses",
    ],
    "OPEX_COMMS",
  ],
  ["printing and stationery", ["stationery", "printing and stationary"], "OPEX_PRINTING"],
  [
    "travelling expenses",
    [
      "travel expenses",
      "travelling and conveyance",
      "conveyance",
      "conveyance expenses",
      "local conveyance",
    ],
    "OPEX_TRAVEL",
  ],
  [
    "legal and professional fees",
    ["professional fees", "legal fees", "consultancy charges", "professional charges"],
    "OPEX_PROFESSIONAL",
  ],
  [
    "audit fees",
    ["auditors remuneration", "payment to auditors", "statutory audit fees"],
    "OPEX_AUDIT",
  ],
  [
    "advertisement",
    [
      "advertising",
      "advertisement expenses",
      "sales promotion",
      "business promotion",
      "marketing expenses",
    ],
    "OPEX_MARKETING",
  ],
  [
    "freight outward",
    ["carriage outward", "freight outwards", "delivery charges"],
    "OPEX_FREIGHT_OUT",
  ],
  ["bank charges", ["bank charges and commission", "bank commission"], "OPEX_BANK"],
  [
    "software subscriptions",
    ["software expenses", "subscription charges"],
    "OPEX_SOFTWARE",
  ],
  [
    "bad debts",
    ["bad debts written off", "sundry balances written off"],
    "OPEX_BAD_DEBTS",
  ],
  [
    "office expenses",
    [
      "general expenses",
      "sundry expenses",
      "miscellaneous expenses",
      "administrative expenses",
    ],
    "OPEX_OTHER",
  ],
  ["commission paid", ["brokerage paid", "commission"], "OPEX_OTHER"],
  ["donation", ["donations"], "OPEX_OTHER"],
  ["round off", ["rounding off", "round off account"], "OPEX_OTHER"],
  ["loss on sale of fixed assets", ["loss on sale of assets"], "OPEX_OTHER"],
  ["foreign exchange loss", ["forex loss", "exchange loss"], "OPEX_OTHER"],
  // D&A, finance, tax
  [
    "depreciation",
    [
      "depreciation account",
      "depreciation on fixed assets",
      "depreciation and amortisation",
    ],
    "DA",
  ],
  ["amortisation", ["amortisation of intangibles"], "DA"],
  [
    "interest paid",
    [
      "interest expenses",
      "interest on loan",
      "interest on term loan",
      "interest on overdraft",
      "interest on cash credit",
      "bank interest",
    ],
    "FIN",
  ],
  ["loan processing charges", ["processing fees on loan"], "FIN"],
  [
    "income tax",
    ["provision for income tax", "current tax", "income tax expense"],
    "TAX_CURRENT",
  ],
  ["deferred tax", ["deferred tax expense"], "TAX_DEFERRED"],
  // Equity and liabilities
  [
    "capital account",
    [
      "capital",
      "share capital",
      "partners capital",
      "proprietors capital",
      "equity share capital",
    ],
    "EQ_CAPITAL",
  ],
  [
    "reserves and surplus",
    ["general reserve", "retained earnings", "securities premium"],
    "EQ_RESERVES",
  ],
  ["profit and loss account", ["surplus in profit and loss"], "EQ_RESERVES"],
  ["drawings", ["partners drawings", "proprietors drawings"], "EQ_CAPITAL"],
  ["term loan", ["secured loan", "vehicle loan", "long term loan"], "NCL_BORROWINGS"],
  [
    "unsecured loans",
    [
      "loan from directors",
      "loan from partners",
      "loan from partner",
      "loans from related parties",
    ],
    "NCL_BORROWINGS",
  ],
  [
    "bank overdraft",
    ["overdraft", "cash credit", "bank cash credit", "working capital loan"],
    "CL_BORROWINGS",
  ],
  ["sundry creditors", ["trade payables", "creditors"], "CL_PAYABLES"],
  ["output cgst", ["cgst payable"], "CL_STATUTORY"],
  ["output sgst", ["sgst payable"], "CL_STATUTORY"],
  ["output igst", ["igst payable"], "CL_STATUTORY"],
  ["input cgst", [], "CL_STATUTORY"],
  ["input sgst", [], "CL_STATUTORY"],
  ["input igst", [], "CL_STATUTORY"],
  [
    "tds payable",
    ["tds on salary", "tds on contract", "tds on professional fees", "tds on rent"],
    "CL_STATUTORY",
  ],
  ["gst payable", ["gst liability"], "CL_STATUTORY"],
  ["provident fund payable", ["pf payable"], "CL_STATUTORY"],
  ["esic payable", [], "CL_STATUTORY"],
  ["professional tax payable", ["pt payable"], "CL_STATUTORY"],
  ["salary payable", ["wages payable", "outstanding salary"], "CL_PROVISIONS"],
  [
    "provision for expenses",
    ["outstanding expenses", "expenses payable"],
    "CL_PROVISIONS",
  ],
  ["advance from customers", ["customer advances"], "CL_OTHER"],
  // Assets
  [
    "fixed assets",
    [
      "plant and machinery",
      "furniture and fixtures",
      "computers",
      "office equipment",
      "vehicles",
      "building",
      "land",
      "delivery vehicle",
      "motor car",
    ],
    "NCA_PPE",
  ],
  ["accumulated depreciation", ["provision for depreciation"], "NCA_PPE"],
  ["intangible assets", ["software", "goodwill", "trademark"], "NCA_INTANGIBLES"],
  ["investments", ["fixed deposit", "mutual funds", "shares"], "NCA_INVESTMENTS"],
  [
    "security deposit",
    ["security deposits", "rent deposit", "electricity deposit"],
    "NCA_DEPOSITS",
  ],
  ["closing stock", ["stock in hand", "inventory", "stock"], "CA_INVENTORY"],
  ["sundry debtors", ["trade receivables", "debtors"], "CA_RECEIVABLES"],
  ["cash", ["cash in hand", "petty cash", "cash account"], "CA_CASH"],
  ["bank account", ["current account", "savings account", "bank"], "CA_CASH"],
  ["advance to suppliers", ["supplier advances", "advance to creditors"], "CA_LOANS_ADV"],
  [
    "staff advance",
    ["advance to staff", "salary advance", "loans to employees"],
    "CA_LOANS_ADV",
  ],
  [
    "tds receivable",
    ["tds receivables", "advance tax", "tax deducted at source"],
    "CA_LOANS_ADV",
  ],
  ["gst input credit", ["input tax credit", "gst receivable"], "CA_OTHER"],
  ["prepaid expenses", ["prepaid insurance"], "CA_OTHER"],
];

// Normalised with the same function the cascade uses, so abbreviations never split a match.
export const GLOBAL_LIBRARY_SEED: readonly LibraryEntry[] = SEED.map(
  ([name, aliases, head]) => {
    const n = normaliseName(name);
    return {
      name: n,
      aliases: [...new Set(aliases.map(normaliseName))].filter((a) => a !== n),
      head,
    };
  },
);

export interface LibraryIndex {
  readonly exact: ReadonlyMap<string, string>;
  readonly alias: ReadonlyMap<string, string>;
  readonly entries: readonly LibraryEntry[];
}

export function indexLibrary(entries: readonly LibraryEntry[]): LibraryIndex {
  const exact = new Map<string, string>();
  const alias = new Map<string, string>();
  for (const e of entries) {
    exact.set(e.name, e.head);
    for (const a of e.aliases) if (!exact.has(a)) alias.set(a, e.head);
  }
  return { exact, alias, entries };
}
