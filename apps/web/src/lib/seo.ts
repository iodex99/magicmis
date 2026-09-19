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
    title: `${PRODUCT_NAME} — boardroom-ready MIS and management accounts from your raw data`,
    description:
      "Dump the raw trial balance from any accounting system and get a checked Excel MIS, a dashboard you build by chatting, and commentary. Present it live; every figure traces to its source.",
    changeFrequency: "weekly",
    priority: 1,
    locale: "en_US",
    updated: "2026-09-19",
    keywords: [
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
    title: "What you get each month",
    description:
      "A validated Excel workbook with live formulas, a dashboard, and commentary where every figure traces back to the ledger it came from. See what the output actually looks like.",
    changeFrequency: "monthly",
    priority: 0.9,
    locale: "en_US",
    updated: "2026-09-18",
  },
  {
    path: "/how-it-works",
    title: "How it works",
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
    title: "Monthly reporting for accounting firms",
    description:
      "Management reporting across a portfolio of clients, without a junior rebuilding each workbook by hand. One mapping per client, reused every month, with every number traceable.",
    changeFrequency: "monthly",
    priority: 0.8,
    locale: "en_GB",
    updated: "2026-09-18",
  },
  {
    path: "/ai-mis-report",
    title: "MIS with AI: an AI MIS report generator that never writes the numbers",
    description:
      "MIS with AI, done safely: AI recognises your raw data, maps ledgers and drafts commentary, while every figure comes from a deterministic engine and traces back to a ledger.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_IN",
    updated: "2026-09-18",
  },
  {
    path: "/mis-in-minutes",
    title: "MIS in minutes: automated MIS report from Tally or any raw trial balance",
    description:
      "MIS automation without a macro: confirm the ledger mapping once, then each month's MIS refreshes from the new raw trial balance in minutes, with live Excel formulas.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_IN",
    updated: "2026-09-18",
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
    title: "Monthly financial reporting software for small businesses",
    description:
      "Month-end reporting from your accounting system's trial balance: P&L with year to date, balance sheet, KPIs, A/R and A/P aging and commentary, in an Excel workbook you can audit.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_US",
    updated: "2026-09-18",
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
    title: "Chat with your MIS: ask your financial data in plain English",
    description:
      "Chat with your MIS or management accounts: ask why a margin moved, or say what to put on the dashboard. Every number is computed from your books and links to its source.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_US",
    updated: "2026-09-19",
    keywords: [
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
      "Dump your raw accounting data and get a checked MIS. Build the board by chatting: comparisons, trends against last year, your own formulas. Present it live, every figure traceable.",
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
      "Automated variance and flux analysis: month-over-month movements computed from your trial balance, filtered by materiality and written up, with every figure traceable.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_US",
    updated: "2026-09-18",
  },
  {
    path: "/ai-management-accounts",
    title: "AI management accounts: the AI maps and writes, never the numbers",
    description:
      "Management accounts with AI, honestly: AI recognises the raw data, maps nominal codes and drafts commentary; every figure is computed and checked. From Xero, Sage or any trial balance.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_GB",
    updated: "2026-09-18",
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
      "An MIS dashboard built from the same raw trial balance as the Excel MIS — KPI cards, trends, a revenue-to-profit bridge and ageing — with the formula and ledgers behind every figure.",
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
    title: "Board pack: what a monthly board report contains and how to produce it",
    description:
      "What a monthly board pack contains — management accounts, KPIs, variances, commentary — how long it takes by hand, and how to produce it from a trial balance each month.",
    changeFrequency: "monthly",
    priority: 0.85,
    locale: "en_GB",
    updated: "2026-09-18",
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
