/**
 * The ledger_mapping eval dataset (R-29, ADR 0069).
 *
 * The model only ever sees the ledgers the deterministic cascade could not place, so every
 * ledger here is one the cascade leaves unmatched — `test/ledger-mapping-dataset.test.ts` runs
 * the real cascade over each and fails if a rule would have caught it. That rules out the
 * circularity R-29 warned about: no label below was produced by the rules the model backstops.
 *
 * In practice that means flat trial balances with no group column, where only the name is left,
 * and exports from other packages whose group names Tally's defaults do not know.
 *
 * Labels were written by Claude on the owner's decision, not by a chartered accountant, and were
 * fixed before any live run. Each ledger names every head a careful accountant could defend under
 * Schedule III, because a name alone often leaves two reasonable answers (Hamali on purchases is a
 * direct cost; on sales it is freight outward). `null` in the list means "no head" is right:
 * a bare party token or a meaningless name should be left for the customer, not guessed.
 */

import { aiHeadList } from "@magicmis/semantic";

import type { MapLedgersInput } from "../src/stages";
import type { EvalItem } from "./datasets";

/** Every head the ledger may correctly take; null means leaving it unmapped is correct. */
export type LedgerLabel = Record<string, readonly (string | null)[]>;

type Row = readonly [
  groupPath: readonly string[],
  name: string,
  accept: readonly (string | null)[],
];

interface Book {
  readonly id: string;
  readonly rows: readonly Row[];
}

const BUSY_INDIRECT = ["Expenses (Indirect/Admn.)"];
const BUSY_DIRECT = ["Expenses (Direct/Mfg.)"];
const BUSY_INCOME = ["Income (Indirect)"];

export const LEDGER_MAPPING_BOOKS: readonly Book[] = [
  {
    // A trading business's flat trial balance: names only, no groups.
    id: "trading-flat",
    rows: [
      [[], "Hamali & Loading Charges", ["COGS_DIRECT", "OPEX_FREIGHT_OUT"]],
      [[], "Kasar Vatav", ["OPEX_OTHER", "OTH_INC_OTHER"]],
      [[], "Diwali Gift to Customers", ["OPEX_MARKETING", "OPEX_OTHER"]],
      [[], "Octroi & Entry Tax", ["COGS_DIRECT", "COGS_PURCHASES", "OPEX_RATES"]],
      [[], "Stock-in-Trade (Closing)", ["CA_INVENTORY", "COGS_INV_CHANGE"]],
      [[], "Purchase - Trading Goods 18%", ["COGS_PURCHASES"]],
      [[], "Sales @ 12% (Local)", ["REV_PRODUCTS"]],
      [
        [],
        "Rate Difference Received",
        ["OTH_INC_OTHER", "COGS_PURCHASES", "REV_OTHER_OPS"],
      ],
      [[], "Cash Discount Allowed", ["OPEX_OTHER", "OPEX_MARKETING", "REV_PRODUCTS"]],
      [[], "Creditors for Capital Goods", ["CL_OTHER", "CL_PAYABLES"]],
      [[], "PARTY_9c1e4b77d0a2", [null]],
      [[], "Sales Commission", ["OPEX_MARKETING", "OPEX_OTHER"]],
    ],
  },
  {
    // A software services firm's flat trial balance.
    id: "services-flat",
    rows: [
      [[], "Cloud Hosting Charges", ["OPEX_SOFTWARE", "COGS_DIRECT"]],
      [[], "Consultancy Income - Export", ["REV_SERVICES"]],
      [[], "Retainership Fees Received", ["REV_SERVICES"]],
      [
        [],
        "Contract Staff Charges",
        ["COGS_DIRECT", "EMP_SALARIES", "OPEX_PROFESSIONAL"],
      ],
      [[], "Recruitment Expenses", ["OPEX_OTHER", "OPEX_PROFESSIONAL"]],
      [[], "Team Outing", ["EMP_WELFARE"]],
      [[], "Mediclaim Premium - Staff", ["EMP_WELFARE", "OPEX_INSURANCE"]],
      [[], "Payment Gateway Charges", ["OPEX_BANK", "OPEX_OTHER"]],
      [[], "Domain & Email Renewal", ["OPEX_SOFTWARE", "OPEX_COMMS"]],
      [[], "Co-working Seat Charges", ["OPEX_RENT"]],
      [[], "Unbilled Revenue", ["CA_OTHER", "CA_RECEIVABLES"]],
      [[], "Income Received in Advance", ["CL_OTHER"]],
      [[], "Stipend to Interns", ["EMP_SALARIES"]],
      [[], "Foreign Travel", ["OPEX_TRAVEL"]],
      [[], "Hotel & Lodging", ["OPEX_TRAVEL"]],
    ],
  },
  {
    // A manufacturer's flat trial balance.
    id: "manufacturing-flat",
    rows: [
      [
        [],
        "Consumable Stores & Spares",
        ["COGS_MATERIALS", "COGS_DIRECT", "OPEX_REPAIRS"],
      ],
      [[], "Packing Material Consumed", ["COGS_MATERIALS", "COGS_DIRECT"]],
      [[], "DG Set Diesel", ["OPEX_POWER", "COGS_DIRECT"]],
      [[], "Export Incentive (RoDTEP)", ["REV_OTHER_OPS", "OTH_INC_OTHER"]],
      [[], "Machinery Repairs", ["OPEX_REPAIRS"]],
      [[], "Pollution Control Board Fees", ["OPEX_RATES", "OPEX_OTHER"]],
      [[], "Factory Canteen Expenses", ["EMP_WELFARE"]],
      [[], "Work-in-Progress", ["CA_INVENTORY"]],
      [[], "Capital Work-in-Progress", ["NCA_PPE", "NCA_OTHER"]],
      [[], "Opening Stock - Raw Material", ["COGS_MATERIALS", "COGS_INV_CHANGE"]],
      [
        [],
        "Import Duty on Raw Material",
        ["COGS_MATERIALS", "COGS_DIRECT", "COGS_PURCHASES"],
      ],
      [[], "Clearing & Forwarding - Import", ["COGS_DIRECT", "COGS_MATERIALS"]],
      [[], "Security Guard Charges", ["OPEX_OTHER"]],
      [[], "Housekeeping Charges", ["OPEX_OTHER", "OPEX_REPAIRS"]],
      [[], "Water Charges", ["OPEX_OTHER", "OPEX_POWER", "OPEX_RATES"]],
    ],
  },
  {
    // A partnership's balance sheet side, flat.
    id: "balance-sheet-flat",
    rows: [
      [[], "Partner's Current A/c - PERSON_4b9e0c1d2a7f", ["EQ_CAPITAL"]],
      [[], "Drawings - PERSON_4b9e0c1d2a7f", ["EQ_CAPITAL"]],
      [[], "Vehicle Loan - Axis Bank", ["NCL_BORROWINGS", "CL_BORROWINGS"]],
      [[], "TDS Payable - 194J", ["CL_STATUTORY"]],
      [[], "Rent Deposit - Office", ["NCA_DEPOSITS", "CA_LOANS_ADV"]],
      [[], "Imprest - Site Office", ["CA_CASH", "CA_LOANS_ADV"]],
      [[], "Deferred Tax Liability (Net)", ["NCL_OTHER"]],
      [
        [],
        "MAT Credit Entitlement",
        ["NCA_OTHER", "NCA_DEPOSITS", "CA_OTHER", "CA_LOANS_ADV"],
      ],
      [[], "Goodwill on Acquisition", ["NCA_INTANGIBLES"]],
      [[], "Computers & Peripherals", ["NCA_PPE"]],
      [[], "Accumulated Depreciation - Vehicles", ["NCA_PPE"]],
      [
        [],
        "Loan to Group Company - PARTY_77ab01c9e3f4",
        ["NCA_DEPOSITS", "CA_LOANS_ADV"],
      ],
      [[], "Investment in Subsidiary", ["NCA_INVESTMENTS"]],
      [[], "GST Refund Receivable", ["CA_LOANS_ADV", "CA_OTHER"]],
      [[], "Retention Money Receivable", ["CA_RECEIVABLES", "CA_OTHER", "NCA_OTHER"]],
      [[], "Bills Receivable", ["CA_RECEIVABLES"]],
      [[], "Bills Payable", ["CL_PAYABLES"]],
      [[], "Dealer Security Deposits Received", ["NCL_OTHER", "CL_OTHER"]],
      [[], "Unpaid Dividend", ["CL_OTHER"]],
      [[], "Current Maturities of Term Loan", ["CL_BORROWINGS", "CL_OTHER"]],
      [[], "Interest Accrued but not Due", ["CL_OTHER"]],
      [[], "Provision for Gratuity", ["NCL_OTHER", "CL_PROVISIONS"]],
      [[], "Petty Cash - Branch", ["CA_CASH"]],
      [[], "Cheques in Hand", ["CA_CASH"]],
    ],
  },
  {
    // A private company's profit and loss side, flat, with the unplaceable left in.
    id: "company-pnl-flat",
    rows: [
      [[], "Directors' Sitting Fees", ["OPEX_OTHER", "OPEX_PROFESSIONAL"]],
      [[], "Keyman Insurance Premium", ["OPEX_INSURANCE"]],
      [[], "ROC Filing Fees", ["OPEX_RATES", "OPEX_OTHER", "OPEX_PROFESSIONAL"]],
      [[], "Interest on Late Payment of GST", ["FIN", "OPEX_OTHER", "OPEX_RATES"]],
      [[], "CSR Expenditure", ["OPEX_OTHER"]],
      [[], "Profit on Sale of Car", ["OTH_INC_OTHER"]],
      [[], "Interest on Income Tax Refund", ["OTH_INC_INTEREST"]],
      [[], "Provision for Doubtful Debts", ["OPEX_BAD_DEBTS"]],
      [[], "Income Tax - Earlier Years", ["TAX_CURRENT", "TAX"]],
      [[], "Amortisation of Software", ["DA"]],
      [[], "Preliminary Expenses Written Off", ["OPEX_OTHER", "DA"]],
      [[], "Tally AMC", ["OPEX_SOFTWARE", "OPEX_REPAIRS"]],
      [
        [],
        "Website Development Charges",
        ["OPEX_SOFTWARE", "OPEX_MARKETING", "OPEX_PROFESSIONAL"],
      ],
      [[], "Legal Notice Charges", ["OPEX_PROFESSIONAL"]],
      [[], "Stamp Duty", ["OPEX_RATES"]],
      [[], "Mobile Bills", ["OPEX_COMMS"]],
      [[], "Conveyance - Staff", ["OPEX_TRAVEL"]],
      [[], "Staff Uniform", ["EMP_WELFARE"]],
      [[], "PF Admin Charges", ["EMP_CONTRIB"]],
      [[], "Gratuity Fund Contribution", ["EMP_CONTRIB"]],
      [[], "Suspense A/c", [null, "CL_OTHER", "CA_OTHER"]],
      [[], "Zeta Widget Pool", [null]],
      [[], "PARTY_03fd5e8a61bc", [null]],
    ],
  },
  {
    // An export from another accounting package, whose group names Tally's defaults do not know.
    id: "busy-groups",
    rows: [
      [BUSY_INDIRECT, "Office Maintenance", ["OPEX_REPAIRS", "OPEX_OTHER"]],
      [BUSY_INDIRECT, "Courier & Postage", ["OPEX_COMMS"]],
      [BUSY_INDIRECT, "Books & Periodicals", ["OPEX_PRINTING", "OPEX_OTHER"]],
      [BUSY_INDIRECT, "Vehicle Running & Maintenance", ["OPEX_TRAVEL", "OPEX_REPAIRS"]],
      [BUSY_DIRECT, "Power Charges - Factory", ["OPEX_POWER", "COGS_DIRECT"]],
      [BUSY_INCOME, "Commission Received", ["OTH_INC_OTHER"]],
      [BUSY_INCOME, "Interest Received on FD", ["OTH_INC_INTEREST"]],
    ],
  },
];

/**
 * One item per book, as `mapStep` would send it: refs `l0`, `l1`… in order, and the full list of
 * heads the semantic layer allows. Each ledger is a scored unit.
 */
export function ledgerMappingDataset(
  limit = 60,
): EvalItem<MapLedgersInput, LedgerLabel>[] {
  const heads = aiHeadList();
  return LEDGER_MAPPING_BOOKS.slice(0, limit).map((book) => {
    const label: LedgerLabel = {};
    const ledgers = book.rows.map(([groupPath, name, accept], i) => {
      const ref = `l${i.toString()}`;
      label[ref] = accept;
      return { ref, name, group_path: [...groupPath] };
    });
    return { id: `lm-${book.id}`, input: { heads, ledgers }, label };
  });
}
