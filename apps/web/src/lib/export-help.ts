/**
 * Which file to export, inside the app where someone is stuck needing it (ADR 0087).
 *
 * The public site has a guide per accounting system; until now none of it was on the screen that
 * asks for the files. Each answer below is the one its guide already gives, in the same words, and
 * links to that guide for the rest — so the two cannot drift into saying different things, and
 * nothing here names a menu path the guides do not.
 */

export interface ExportHelp {
  readonly id: string;
  readonly system: string;
  /** The one report that is enough on its own. */
  readonly essential: string;
  /** What else helps, and why. */
  readonly extras: string;
  /** The public guide with the rest. */
  readonly guide: string;
}

export const EXPORT_HELP: readonly ExportHelp[] = [
  {
    id: "quickbooks",
    system: "QuickBooks",
    essential:
      "The Trial Balance at each month end. It holds every account's balance, so the income statement, the balance sheet and the ratios can all be built from it.",
    extras:
      "The Profit and Loss and Balance Sheet exports are useful as a check, and the aging detail reports add the A/R and A/P aging.",
    guide: "/guides/management-accounts-from-quickbooks",
  },
  {
    id: "xero",
    system: "Xero",
    essential:
      "The Trial Balance at each month end. It holds every account's balance, so a P&L, a balance sheet and the ratios can all be built from it.",
    extras:
      "The Profit and Loss and Balance Sheet exports are useful as a check, and the aged receivables and payables detail reports add the ageing section.",
    guide: "/guides/management-accounts-from-xero",
  },
  {
    id: "sage-50",
    system: "Sage 50",
    essential:
      "The trial balance for each month-end period. It holds every nominal code's balance, so the P&L, the balance sheet and the ratios can all be built from it.",
    extras:
      "The profit and loss and balance sheet exports are useful as a check, and the detailed aged debtors and aged creditors reports add the ageing.",
    guide: "/guides/management-accounts-from-sage-50",
  },
  {
    id: "zoho-books",
    system: "Zoho Books",
    essential:
      "The Trial Balance, one for each month. It holds every account's balance, so a P&L, a balance sheet and the ratios can all be built from it.",
    extras:
      "The Profit and Loss and Balance Sheet are useful as a check, the aging details add the ageing, and Sales by Customer adds revenue by customer.",
    guide: "/guides/mis-report-from-zoho-books",
  },
  {
    id: "tally",
    system: "TallyPrime",
    essential:
      "The Trial Balance, one per month you want to report, with the ledgers shown under each group.",
    extras:
      "The Profit & Loss A/c and Balance Sheet check the MIS against the books, Bills Receivable and Bills Payable add the ageing, and the sales and purchase registers add invoice-level detail.",
    guide: "/tally-mis-report",
  },
  {
    id: "busy",
    system: "BUSY",
    essential:
      "The Trial Balance, one for each month, with every ledger shown. It holds every balance, so a P&L, a balance sheet and the ratios can all be built from it.",
    extras:
      "The Profit & Loss A/c and Balance Sheet are useful as a check, Bills Receivable and Bills Payable add the ageing, and the sales and purchase registers add invoice-level detail.",
    guide: "/guides/mis-report-from-busy",
  },
  {
    id: "marg",
    system: "Marg",
    essential:
      "The Trial Balance, one for each month. It holds every ledger's balance, so a P&L, a balance sheet and the ratios can all be built from it.",
    extras:
      "The Profit & Loss and Balance Sheet are useful as a check, the outstandings add the ageing, and the Sale Book and Purchase Register add invoice-level detail.",
    guide: "/guides/mis-report-from-marg",
  },
  {
    id: "vyapar",
    system: "Vyapar",
    essential:
      "The Trial Balance Report, one for each month. It holds every account's balance, so a P&L, a balance sheet and the ratios can all be built from it.",
    extras:
      "The Profit and Loss and Balance Sheet are useful as a check, Sale Aging and All Parties add the debtors and creditors, and the sale and purchase reports add invoice-level detail.",
    guide: "/guides/mis-report-from-vyapar",
  },
  {
    id: "other",
    system: "Any other system",
    essential:
      "A trial balance at each month end, with every account and its balance. Every system can produce one, and it is enough on its own.",
    extras:
      "A profit and loss and a balance sheet for the same month are useful as a check, and aged receivables and payables reports add the ageing.",
    guide: "/guides/trial-balance-to-management-report",
  },
];

/** What holds for every system. */
export const EXPORT_TIPS: readonly string[] = [
  "Show every account or ledger, not only group totals: the names are what each one is placed by.",
  "Export each month on its own rather than one file for a range, and the comparisons build themselves.",
  "Excel or CSV where the system offers it. A PDF with selectable text works too; a scan or a photo does not.",
];
