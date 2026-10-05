import { headers } from "next/headers";
import type { Metadata } from "next";

import { PRODUCT_NAME } from "./brand";

/**
 * One description of the public site, used by the sitemap, the page metadata and the
 * breadcrumbs (SPEC §32).
 *
 * Kept in one place because these drift apart silently: a page added without a sitemap
 * entry is invisible, and a sitemap entry without a page is a 404 handed to a crawler.
 * `DEVICE_AGNOSTIC_PATHS` in `@magicmis/accounts/desktop` must list the same routes, or a
 * visitor on a phone meets the desktop gate instead of the page they searched for — a test
 * asserts the two agree.
 *
 * **The same report has a different name in each market**, and the copy has to meet each
 * of them in their own words. India says **MIS report**; the UK, Ireland, Australia, New
 * Zealand and South Africa say **management accounts**; the United States says **monthly
 * financial reporting**. They are the same monthly document — a P&L, a balance sheet, cash
 * flow, ratios and commentary — and each market gets a page written in its own vocabulary
 * rather than one page written in a compromise nobody types. Using the reader's own term
 * is most of what ranking for their query is.
 */
export type PageLocale = "en_IN" | "en_GB" | "en_US";

export interface PublicPage {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  /** Sitemap hint. The marketing pages change rarely; the home and pricing pages more. */
  readonly changeFrequency: "daily" | "weekly" | "monthly";
  readonly priority: number;
  /**
   * The market the page is written for, as the OpenGraph locale and the article language.
   * A page in British vocabulary tagged `en_IN` tells a crawler the wrong audience.
   */
  readonly locale: PageLocale;
  /**
   * When the content last changed (ISO date). The sitemap and the article schema carry it,
   * so a revised page is re-read and an unchanged one is not re-crawled for nothing.
   */
  readonly updated: string;
  /**
   * The phrases this page is written to be found by (ADR 0046). They go out as the page's
   * keywords meta tag and into llms.txt. Search engines rank on the copy, not on this tag, so
   * every phrase here must also be said, in a sentence, on the page itself.
   */
  readonly keywords?: readonly string[];
}

/**
 * The same monthly report, by every name it is given (ADR 0038). Each market searches in
 * its own words, and the site has a page written in each; this list is what the pages use
 * to point at one another and what the glossary page explains.
 */
export const REPORT_NAMES: readonly {
  readonly term: string;
  readonly where: string;
  readonly path: string;
}[] = [
  {
    term: "MIS report",
    where: "India, Pakistan, Bangladesh, Sri Lanka, Nepal and the Gulf",
    path: "/mis-report-format",
  },
  {
    term: "Management accounts",
    where: "the UK, Ireland, Australia, New Zealand, South Africa and Singapore",
    path: "/management-accounts",
  },
  {
    term: "Monthly financial reporting",
    where: "the United States and Canada",
    path: "/monthly-financial-reporting",
  },
  {
    term: "Board pack",
    where: "boardrooms in the UK, Australia and beyond",
    path: "/board-pack",
  },
  {
    term: "Month-end reporting package",
    where: "US controllers and finance teams",
    path: "/month-end-reporting-package",
  },
];

export const PUBLIC_PAGES: readonly PublicPage[] = [
  {
    path: "/",
    title: `${PRODUCT_NAME} — monthly MIS and management accounts from your trial balance`,
    description:
      "Turn raw data into business insights. Dump a trial balance from any accounting system and get a checked MIS, a dashboard you build by chatting, and commentary on what to act on.",
    changeFrequency: "weekly",
    priority: 1,
    locale: "en_US",
    updated: "2026-09-19",
    keywords: [
      "turn raw data into business insights",
      "raw data into actionable insights",
      "raw data to business insights",
      "MIS from raw data",
      "dump raw data get MIS",
      "boardroom-ready MIS",
      "chat with your MIS",
      "build a dashboard by chatting",
      "AI MIS report",
      "management accounts software",
      "monthly financial reporting",
      "trial balance to dashboard",
    ],
  },
  {
    path: "/product",
    title: "What you get each month: a checked MIS, a dashboard and commentary",
    description:
      "What lands each month: the movements that matter, explained, inside a checked Excel workbook with live formulas, a dashboard and commentary. Every figure traces to its ledger.",
    changeFrequency: "monthly",
    priority: 0.9,
    locale: "en_US",
    updated: "2026-09-18",
  },
  {
    path: "/how-it-works",
    title: "How a trial balance becomes a monthly MIS, stage by stage",
    description:
      "Upload your raw accounting data and take the workbook. Ledgers are mapped for you, and later months reuse the mapping with no AI calls at all. Here is each step in detail.",
    changeFrequency: "monthly",
    priority: 0.9,
    locale: "en_US",
    updated: "2026-09-18",
  },
  {
    path: "/management-accounts",
    title: "Management accounts: what they contain and how to prepare them monthly",
    description:
      "What monthly management accounts should include — P&L, balance sheet, cash flow, ratios and commentary — how long they take to prepare by hand, and how to stop rebuilding them every month.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_GB",
    updated: "2026-09-18",
  },
  {
    path: "/mis-report-format",
    title: "MIS report format in Excel: what a monthly MIS should contain",
    description:
      "The monthly MIS report format used by Indian businesses, section by section: P&L summary, balance sheet, cash flow, ratios and ageing — with a worked example.",
    changeFrequency: "monthly",
    priority: 0.8,
    locale: "en_IN",
    updated: "2026-09-18",
  },
  {
    path: "/tally-mis-report",
    title: "MIS report from Tally: which raw reports to take and what to do with them",
    description:
      "How to produce a monthly MIS from TallyPrime or Tally.ERP 9 raw data: which reports to take, the export settings that matter, and how to stop rebuilding it monthly.",
    changeFrequency: "monthly",
    priority: 0.8,
    locale: "en_IN",
    updated: "2026-09-18",
  },
  {
    path: "/for-accountants",
    title: "Client reporting software for accounting firms and CAS teams",
    description:
      "Management reporting across a portfolio of clients, without a junior rebuilding each workbook by hand. One mapping per client, reused every month, with every number traceable.",
    changeFrequency: "monthly",
    priority: 0.8,
    locale: "en_GB",
    updated: "2026-10-05",
    keywords: [
      "client reporting software for accountants",
      "client accounting services reporting",
      "CAS reporting",
      "monthly MIS for CA firms",
      "client reporting for bookkeepers",
    ],
  },
  {
    path: "/ai-mis-report",
    title: "MIS with AI: an AI tool for MIS reports that never writes the numbers",
    description:
      "MIS with AI, done safely: AI recognises your raw data, maps ledgers and drafts commentary, while every figure comes from a deterministic engine and traces back to a ledger.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_IN",
    updated: "2026-10-05",
    keywords: [
      "MIS report using AI",
      "AI tool for MIS report",
      "MIS report generator",
      "AI MIS",
      "MIS with AI",
    ],
  },
  {
    path: "/mis-in-minutes",
    title: "MIS automation: an automated MIS report from Tally or any trial balance",
    description:
      "MIS automation without a macro: confirm the ledger mapping once, then each month's MIS refreshes from the new raw trial balance in minutes, with live Excel formulas.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_IN",
    updated: "2026-10-05",
    keywords: [
      "MIS automation",
      "MIS report automation",
      "automated MIS report",
      "how to automate MIS report in Excel",
      "MIS in minutes",
    ],
  },
  {
    path: "/automated-management-accounts",
    title: "Automated management accounts from your trial balance",
    description:
      "Monthly management accounts produced from the raw trial balance: P&L, balance sheet, KPIs, aged debtors and commentary in Excel, every figure traceable, paid per report.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_GB",
    updated: "2026-09-18",
  },
  {
    path: "/monthly-financial-reporting",
    title: "Monthly financial reporting software for small businesses and their CPAs",
    description:
      "Month-end reporting from your accounting system's trial balance: P&L with year to date, balance sheet, KPIs, A/R and A/P aging and commentary, in an Excel workbook you can audit.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_US",
    updated: "2026-10-05",
    keywords: [
      "monthly financial reporting software",
      "monthly financial reporting package",
      "monthly financial report template",
      "financial report for board of directors",
    ],
  },
  {
    path: "/guides",
    title: "Guides to monthly management reporting and MIS",
    description:
      "Practical guides for accountants and finance teams: MIS format, ratios and KPIs, mapping a trial balance, ageing reports, commentary and the month-end close.",
    changeFrequency: "weekly",
    priority: 0.7,
    locale: "en_GB",
    updated: "2026-09-18",
  },
  {
    path: "/guides/mis-kpis-and-ratios",
    title: "KPIs and ratios for a monthly MIS: formulas and what they tell you",
    description:
      "The ratios a monthly MIS or management accounts pack should carry — margins, debtor, creditor and inventory days, cash conversion cycle, current and quick ratio — with formulas.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_IN",
    updated: "2026-09-18",
  },
  {
    path: "/guides/trial-balance-to-management-report",
    title: "Trial balance to management report: mapping ledgers to report heads",
    description:
      "How a trial balance becomes a P&L and balance sheet summary: grouping ledgers into report heads, sign conventions, checks that the totals tie, and reusing the mapping monthly.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_GB",
    updated: "2026-09-18",
  },
  {
    path: "/guides/debtors-ageing-report",
    title: "Debtors ageing report: format, buckets and how to read it",
    description:
      "How to build a receivables ageing report (aged debtors, A/R aging): choosing buckets, ageing from bill date or due date, unallocated receipts, and acting on the result.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_GB",
    updated: "2026-09-18",
  },
  {
    path: "/guides/mis-commentary",
    title: "MIS commentary and variance analysis: how to write it so it gets read",
    description:
      "Writing the commentary in a monthly MIS or management accounts pack: which variances to explain, a materiality threshold, sentence patterns that work, and ones to avoid.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_IN",
    updated: "2026-09-18",
  },
  {
    path: "/guides/month-end-close-checklist",
    title: "Month-end close checklist before the management report",
    description:
      "The checks to finish before a month's figures go into an MIS or management accounts: bank reconciliation, cut-off, accruals, depreciation, control accounts and suspense.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_GB",
    updated: "2026-09-18",
  },
  {
    path: "/chat-with-your-mis",
    title: "Chat with your MIS: ask your financial data and P&L in plain English",
    description:
      "Chat with your MIS or management accounts: ask why a margin moved, or say what to put on the dashboard. Every number is computed from your books and links to its source.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_US",
    updated: "2026-10-05",
    keywords: [
      "chat with your P&L",
      "chat with Excel accounts",
      "chat with MIS",
      "chat with your financial data",
      "chat with Tally data",
      "MIS chatbot",
      "ask questions of management accounts",
      "AI finance assistant",
      "build dashboard with chat",
    ],
  },
  {
    path: "/boardroom-ready-mis",
    title: "Boardroom-ready MIS from your raw data: chat to build it, present it live",
    description:
      "Dump raw data, get actionable insight a board will accept. Build it by chatting: comparisons, trends against last year, your own formulas. Present it live, every figure traceable.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_US",
    updated: "2026-09-19",
    keywords: [
      "boardroom-ready MIS",
      "dump raw data",
      "raw data to MIS",
      "board meeting dashboard",
      "board pack dashboard",
      "AI dashboard builder for finance",
      "build a dashboard by chatting",
      "present MIS dashboard",
      "trial balance to dashboard",
      "dynamic MIS dashboard",
    ],
  },
  {
    path: "/ai-variance-analysis",
    title: "AI variance analysis: flux commentary written from computed figures",
    description:
      "Which movements matter and why, not every change: month-over-month variances computed from your trial balance, filtered by materiality and written up, every figure traceable.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_US",
    updated: "2026-09-18",
  },
  {
    path: "/ai-management-accounts",
    title: "AI for monthly management accounts: AI maps and writes, never the numbers",
    description:
      "Monthly management accounts with AI, honestly: AI reads the raw data, maps nominal codes and drafts commentary; every figure is computed and checked. From Xero, Sage or any trial balance.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_GB",
    updated: "2026-10-05",
    keywords: [
      "AI for management accounts",
      "monthly management accounts AI",
      "AI management reporting",
      "AI for nominal code mapping",
    ],
  },
  {
    path: "/ai-financial-reporting",
    title: "AI financial reporting for small businesses, from the raw trial balance",
    description:
      "Automated monthly financial reporting with no integration project: upload the trial balance after the close and get statements, KPIs, A/R aging and commentary, every figure checked.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_US",
    updated: "2026-09-18",
  },
  {
    path: "/mis-dashboard",
    title: "MIS dashboard: KPIs and charts where every number opens its lineage",
    description:
      "Turn raw data into a dashboard that answers questions: KPI cards, trends, a revenue-to-profit bridge and ageing, with the formula and ledgers behind every figure.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_IN",
    updated: "2026-09-18",
  },
  {
    path: "/what-is-an-mis-report",
    title: "What is an MIS report? Meaning, contents and its name in every market",
    description:
      "What an MIS report is, what it contains each month, and what the same report is called elsewhere — management accounts, monthly financial reporting, a board pack.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_IN",
    updated: "2026-09-18",
  },
  {
    path: "/board-pack",
    title: "Board pack and board packet: the monthly financial report for the board",
    description:
      "What a monthly board pack contains — management accounts, KPIs, variances, commentary — how long it takes by hand, and how to produce it from a trial balance each month.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_GB",
    updated: "2026-10-05",
    keywords: [
      "board pack",
      "board packet",
      "board report template",
      "financial report for board meeting",
      "AI board pack",
    ],
  },
  {
    path: "/month-end-reporting-package",
    title: "Month-end reporting package: contents, timeline and how to build it",
    description:
      "What a month-end reporting package contains — statements, variances, KPIs, A/R aging, commentary — the close timeline it follows, and how to produce it from the trial balance.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_US",
    updated: "2026-09-18",
  },
  {
    path: "/management-reporting-software",
    title: "Management reporting software that works from your raw accounting data",
    description:
      "Management reporting software with no connector: upload the raw trial balance from any system and get a checked Excel report, a dashboard and commentary. Prepaid, per report.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_GB",
    updated: "2026-09-18",
  },
  {
    path: "/security",
    title: "Security and data handling",
    description:
      "Where your accounting files go: encrypted under each company's own key, redacted before the AI sees any of them, and opened by no one on our side. Stated exactly.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_US",
    updated: "2026-09-18",
  },
  {
    path: "/pricing",
    title: "Credit packs: prepaid, no subscription, credits never expire",
    description:
      "Six credit packs from Starter to Scale. Buy once and spend credits when you run something: no subscription, no per-seat fee, no minimum, and credits that never expire.",
    changeFrequency: "weekly",
    priority: 0.9,
    locale: "en_US",
    updated: "2026-09-18",
  },
  {
    path: "/how-to-make-an-mis-report-in-excel",
    title: "How do you make an MIS report in Excel?",
    description:
      "Export the trial balance, map every ledger to a report head once, build the statements with formulas, add comparatives, check it balances and write the commentary. Seven steps.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_IN",
    updated: "2026-10-01",
    keywords: [
      "how to make mis report in excel",
      "how to prepare mis report in excel",
      "mis report in excel step by step",
    ],
  },
  {
    path: "/how-often-should-an-mis-report-be-prepared",
    title: "How often should an MIS report be prepared?",
    description:
      "Monthly, as soon as the books are closed, with a weekly cash flash beside it if cash is tight. Why monthly is the rhythm the comparisons need, and what keeps it affordable.",
    changeFrequency: "monthly",
    priority: 0.6,
    locale: "en_IN",
    updated: "2026-10-01",
    keywords: ["how often should mis report be prepared", "mis report frequency"],
  },
  {
    path: "/can-chatgpt-make-an-mis-report",
    title: "Can ChatGPT make an MIS report?",
    description:
      "It can draft a format and write a paragraph, but it should not produce the figures. Where a chat assistant helps with an MIS, where it goes wrong, and the safe split.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_IN",
    updated: "2026-10-01",
    keywords: [
      "can chatgpt make mis report",
      "chatgpt mis report",
      "ai mis report from trial balance",
    ],
  },
  {
    path: "/how-to-calculate-debtor-days",
    title: "How do you calculate debtor days?",
    description:
      "Debtor days = trade receivables ÷ the month's revenue × the days in that month. A worked example, why the month beats the year, and the GST effect nobody mentions.",
    changeFrequency: "monthly",
    priority: 0.6,
    locale: "en_IN",
    updated: "2026-10-01",
    keywords: ["how to calculate debtor days", "debtor days formula", "dso formula"],
  },
  {
    path: "/how-to-calculate-gross-margin-from-a-trial-balance",
    title: "How do you calculate gross margin from a trial balance?",
    description:
      "(Revenue − direct costs) ÷ revenue × 100, with closing stock taken off direct costs. A worked example showing what the stock adjustment changes, and which ledgers count.",
    changeFrequency: "monthly",
    priority: 0.6,
    locale: "en_US",
    updated: "2026-10-01",
    keywords: [
      "how to calculate gross margin from trial balance",
      "gross profit from trial balance",
    ],
  },
  {
    path: "/how-to-calculate-ebitda-in-an-mis-report",
    title: "How is EBITDA calculated in an MIS report?",
    description:
      "Revenue less direct costs, employee costs and other operating expenses, with other income kept below it. A worked example from EBITDA down to profit before tax.",
    changeFrequency: "monthly",
    priority: 0.6,
    locale: "en_IN",
    updated: "2026-10-01",
    keywords: ["how to calculate ebitda", "ebitda in mis report", "ebitda formula"],
  },
  {
    path: "/guides/management-accounts-from-xero",
    title: "Management accounts from Xero: which reports to export, and what next",
    description:
      "Which Xero reports to export each month for management accounts — trial balance, P&L, balance sheet, aged receivables and payables — and how to stop rebuilding the pack.",
    changeFrequency: "monthly",
    priority: 0.75,
    locale: "en_GB",
    updated: "2026-10-05",
    keywords: [
      "management accounts in xero",
      "xero management report pack",
      "how to produce management accounts in xero",
      "xero trial balance export",
    ],
  },
  {
    path: "/guides/management-accounts-from-quickbooks",
    title: "Management reports from QuickBooks: what to export for a monthly pack",
    description:
      "What to export from QuickBooks Online or Desktop for a monthly reporting package: the trial balance, P&L, balance sheet and A/R and A/P aging, and where each report lives.",
    changeFrequency: "monthly",
    priority: 0.75,
    locale: "en_US",
    updated: "2026-10-05",
    keywords: [
      "quickbooks management reports",
      "how to prepare management accounts in quickbooks",
      "quickbooks trial balance export to excel",
      "monthly financial reporting package",
    ],
  },
  {
    path: "/guides/management-accounts-from-sage-50",
    title: "Management accounts from Sage 50: the reports to export each month",
    description:
      "How to produce management accounts from Sage 50: the trial balance, P&L, balance sheet and aged debtors and creditors reports to send to Excel each month, US and Canadian editions noted.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_GB",
    updated: "2026-10-05",
    keywords: [
      "sage 50 management accounts",
      "how to produce management accounts on sage 50",
      "can sage produce management accounts",
      "sage 50 aged debtors report",
    ],
  },
  {
    path: "/fathom-alternative",
    title: "Fathom alternative: management reports on prepaid credits, no subscription",
    description:
      "An honest Fathom comparison: Fathom syncs, forecasts and consolidates on a monthly subscription; this builds a checked monthly report from raw exports, paid per report from prepaid credits.",
    changeFrequency: "monthly",
    priority: 0.8,
    locale: "en_GB",
    updated: "2026-10-05",
    keywords: [
      "fathom alternative",
      "fathom reporting alternatives",
      "fathom reporting pricing",
      "alternative to fathom reporting",
      "management reporting without subscription",
    ],
  },
  {
    path: "/syft-alternative",
    title: "Syft Analytics alternative: reports from raw exports, no subscription",
    description:
      "An honest Syft Analytics comparison: Syft connects, forecasts and consolidates on plans per entity; this builds the monthly report from raw exports, paid per report from prepaid credits.",
    changeFrequency: "monthly",
    priority: 0.75,
    locale: "en_GB",
    updated: "2026-10-05",
    keywords: [
      "syft analytics alternative",
      "syft vs fathom",
      "syft analytics pricing",
      "alternative to syft",
    ],
  },
  {
    path: "/trial-balance-to-financial-statements",
    title: "Trial balance to financial statements: P&L, balance sheet and KPIs",
    description:
      "Upload a raw trial balance and get a checked P&L, balance sheet summary and KPIs in Excel. These are monthly management statements, not statutory accounts.",
    changeFrequency: "monthly",
    priority: 0.8,
    locale: "en_GB",
    updated: "2026-10-05",
    keywords: [
      "trial balance to financial statements",
      "financial statements from trial balance in excel",
      "trial balance to balance sheet converter",
      "ai financial statement generator",
    ],
  },
  {
    path: "/financial-dashboard-from-excel",
    title: "Financial dashboard from Excel: a KPI dashboard from your trial balance",
    description:
      "A KPI dashboard built from your Excel trial balance, changed by asking in words and presented live, with every figure opening onto the ledgers it came from.",
    changeFrequency: "monthly",
    priority: 0.8,
    locale: "en_US",
    updated: "2026-10-05",
    keywords: [
      "financial dashboard from excel",
      "excel to dashboard ai",
      "ai dashboard from excel",
      "kpi dashboard",
      "cfo dashboard",
      "p&l dashboard",
    ],
  },
  {
    path: "/guides/management-accounts-commentary-examples",
    title: "Management accounts commentary examples: weak and strong, line by line",
    description:
      "Eight weak lines of management accounts commentary rewritten to name the cause, the six causes behind most variances, and a whole month's commentary put together.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_GB",
    updated: "2026-10-05",
    keywords: [
      "management accounts commentary examples",
      "p&l commentary examples",
      "variance analysis commentary example",
      "month end commentary",
    ],
  },
  {
    path: "/is-it-safe-to-upload-financial-statements-to-chatgpt",
    title: "Is it safe to upload financial statements to ChatGPT?",
    description:
      "It can be, on a business plan or with training off and names removed first. What ChatGPT's maker says it keeps, and what a reporting tool should promise instead.",
    changeFrequency: "monthly",
    priority: 0.6,
    locale: "en_US",
    updated: "2026-10-05",
    keywords: [
      "is it safe to upload financial statements to chatgpt",
      "upload financial data to chatgpt",
      "is chatgpt safe for confidential information",
    ],
  },
  {
    path: "/can-ai-prepare-financial-statements",
    title: "Can AI prepare financial statements from a trial balance?",
    description:
      "Part of the job. AI can recognise the trial balance and map ledgers; the figures must come from arithmetic, and statutory accounts still need an accountant.",
    changeFrequency: "monthly",
    priority: 0.6,
    locale: "en_US",
    updated: "2026-10-05",
    keywords: [
      "can ai prepare financial statements",
      "can chatgpt create financial statements",
      "can chatgpt make a balance sheet",
    ],
  },
  {
    path: "/guides/mis-report-from-busy",
    title: "MIS report from BUSY: which reports to export, and what to do next",
    description:
      "Which BUSY reports to export for a monthly MIS: trial balance, P&L, balance sheet, outstandings and registers, where BUSY keeps them, how to export to Excel, and what to do next.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_IN",
    updated: "2026-10-05",
    keywords: [
      "mis report in busy software",
      "trial balance in busy software",
      "busy to excel export",
      "busy software balance sheet",
    ],
  },
  {
    path: "/guides/mis-report-from-marg",
    title: "MIS report from Marg ERP: which reports to export, and what to do next",
    description:
      "Which Marg ERP reports to export for a monthly MIS: trial balance, P&L, balance sheet, outstandings and sale book, where Marg keeps them, Alt+P to Excel, and what to do next.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_IN",
    updated: "2026-10-05",
    keywords: [
      "trial balance in marg software",
      "profit and loss report in marg",
      "marg balance sheet",
      "marg export to excel",
    ],
  },
  {
    path: "/guides/mis-report-from-zoho-books",
    title: "MIS report from Zoho Books: which reports to export, and what to do next",
    description:
      "Which Zoho Books reports to export for a monthly MIS: trial balance, P&L, balance sheet and aging, where Zoho keeps them, how to export, and what to do next.",
    changeFrequency: "monthly",
    priority: 0.7,
    locale: "en_IN",
    updated: "2026-10-05",
    keywords: [
      "mis report in zoho books",
      "zoho books trial balance",
      "zoho books balance sheet report",
      "zoho books export to excel",
    ],
  },
  {
    path: "/guides/mis-report-from-vyapar",
    title: "MIS report from Vyapar: which reports to export, and what to do next",
    description:
      "Which Vyapar reports to export for a monthly MIS: trial balance, P&L, balance sheet, sale aging and party balances, where they are, the Excel icon, and what to do next.",
    changeFrequency: "monthly",
    priority: 0.65,
    locale: "en_IN",
    updated: "2026-10-05",
    keywords: [
      "vyapar balance sheet",
      "vyapar app aging report",
      "vyapar reports",
      "vyapar pdf to excel",
    ],
  },
  {
    path: "/legal/terms",
    title: "Terms of service",
    description: `The terms on which ${PRODUCT_NAME} is provided: prepaid credits, what they buy, how long they last, and the limits of what a generated report is.`,
    changeFrequency: "monthly",
    priority: 0.3,
    locale: "en_IN",
    updated: "2026-09-18",
  },
  {
    path: "/legal/privacy",
    title: "Privacy notice",
    description: `How ${PRODUCT_NAME} handles personal data: what is collected, what happens to the files you upload, who processes it, and your rights in India, the UK and the EEA.`,
    changeFrequency: "monthly",
    priority: 0.3,
    locale: "en_IN",
    updated: "2026-09-18",
  },
];

/**
 * One question each (ADR 0079): the question is the title, the H1 and the URL, and the answer is
 * the first thing on the page. Each was triaged against the guides before it was built — a
 * question a guide already answers became a heading there instead — so none competes with a
 * page above it for the same search.
 */
export const ANSWER_PATHS: readonly string[] = [
  "/how-to-make-an-mis-report-in-excel",
  "/how-often-should-an-mis-report-be-prepared",
  "/can-chatgpt-make-an-mis-report",
  "/how-to-calculate-debtor-days",
  "/how-to-calculate-gross-margin-from-a-trial-balance",
  "/how-to-calculate-ebitda-in-an-mis-report",
  "/can-ai-prepare-financial-statements",
  "/is-it-safe-to-upload-financial-statements-to-chatgpt",
];

/**
 * The guides, in the order the index and the home page list them. Each lives under
 * `/guides/` except the four written before the section existed, which keep their URLs —
 * moving a page that already ranks throws the ranking away.
 */
export const GUIDE_PATHS: readonly string[] = [
  "/what-is-an-mis-report",
  "/mis-report-format",
  "/management-accounts",
  "/guides/mis-kpis-and-ratios",
  "/guides/trial-balance-to-management-report",
  "/guides/debtors-ageing-report",
  "/guides/mis-commentary",
  "/guides/month-end-close-checklist",
  "/tally-mis-report",
  "/guides/management-accounts-from-xero",
  "/guides/management-accounts-from-quickbooks",
  "/guides/management-accounts-from-sage-50",
  "/guides/management-accounts-commentary-examples",
  "/guides/mis-report-from-busy",
  "/guides/mis-report-from-marg",
  "/guides/mis-report-from-zoho-books",
  "/guides/mis-report-from-vyapar",
];

/** Pages written for a search a buyer makes, rather than a question a practitioner asks. */
export const SOLUTION_PATHS: readonly string[] = [
  "/management-reporting-software",
  "/ai-mis-report",
  "/chat-with-your-mis",
  "/boardroom-ready-mis",
  "/ai-variance-analysis",
  "/ai-management-accounts",
  "/ai-financial-reporting",
  "/mis-dashboard",
  "/mis-in-minutes",
  "/automated-management-accounts",
  "/monthly-financial-reporting",
  "/board-pack",
  "/month-end-reporting-package",
  "/for-accountants",
];

export function publicPage(path: string): PublicPage {
  const page = PUBLIC_PAGES.find((p) => p.path === path);
  if (page === undefined) throw new Error(`no PublicPage entry for ${path}`);
  return page;
}

/**
 * The site's own origin.
 *
 * Canonical URLs have to be absolute, and a canonical pointing at the wrong host is worse
 * than none: it tells a crawler the real page lives somewhere else. Read from the same
 * environment variable the rest of the app uses rather than reconstructed from the request,
 * so a preview deployment never claims to be the production site.
 */
export function siteOrigin(): string {
  const configured = process.env["NEXT_PUBLIC_APP_URL"] ?? "";
  return configured.replace(/\/+$/u, "");
}

export function absoluteUrl(path: string): string {
  return `${siteOrigin()}${path === "/" ? "" : path}`;
}

/**
 * Metadata for one public page, including the canonical and the share card.
 *
 * `title.absolute` is used rather than the layout's template: these titles are written for
 * a search result, where the product name appended twice reads as spam and costs characters
 * that could have carried the query.
 */
export function pageMetadata(path: string): Metadata {
  const page = publicPage(path);
  const url = absoluteUrl(path);
  // A share card that carries the page's own title is opened far more often than the
  // site's generic one (ADR 0038). The image route validates the path against this list.
  const image = {
    url: absoluteUrl(`/og?path=${encodeURIComponent(path)}`),
    width: 1200,
    height: 630,
    alt: page.title,
  };
  return {
    title: { absolute: page.title },
    description: page.description,
    ...(page.keywords === undefined ? {} : { keywords: [...page.keywords] }),
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: PRODUCT_NAME,
      locale: page.locale,
      url,
      title: page.title,
      description: page.description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [image.url],
    },
  };
}

/**
 * The per-request CSP nonce, recovered from the header the proxy set (SPEC §30).
 *
 * Structured data is delivered in a `<script type="application/ld+json">`, and the policy
 * has no `unsafe-inline`: browsers apply `script-src` to the element regardless of its
 * type, so without the nonce the block is dropped and the rich result never appears.
 * Returns undefined rather than throwing — a missing nonce should cost a rich result, not
 * the page.
 */
export async function cspNonce(): Promise<string | undefined> {
  const csp = (await headers()).get("content-security-policy") ?? "";
  return /'nonce-([^']+)'/u.exec(csp)?.[1];
}
