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
export interface PublicPage {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  /** Sitemap hint. The marketing pages change rarely; the home and pricing pages more. */
  readonly changeFrequency: "daily" | "weekly" | "monthly";
  readonly priority: number;
}

export const PUBLIC_PAGES: readonly PublicPage[] = [
  {
    path: "/",
    title: `${PRODUCT_NAME} — monthly management reports from your accounting data`,
    description:
      "Turn a trial balance from any accounting system into a validated Excel report with live formulas, a dashboard and written commentary. Prepaid credits, no subscription.",
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    path: "/product",
    title: "What you get each month",
    description:
      "A validated Excel workbook with live formulas, a dashboard, and commentary where every figure traces back to the ledger it came from. See what the output actually looks like.",
    changeFrequency: "monthly",
    priority: 0.9,
  },
  {
    path: "/how-it-works",
    title: "How it works",
    description:
      "Upload your accounting exports and take the workbook. Ledgers are mapped for you, and later months reuse the mapping with no AI calls at all. Here is each step in detail.",
    changeFrequency: "monthly",
    priority: 0.9,
  },
  {
    path: "/management-accounts",
    title: "Management accounts: what they contain and how to prepare them monthly",
    description:
      "What monthly management accounts should include — P&L, balance sheet, cash flow, ratios and commentary — how long they take to prepare by hand, and how to stop rebuilding them every month.",
    changeFrequency: "monthly",
    priority: 0.85,
  },
  {
    path: "/mis-report-format",
    title: "MIS report format in Excel: what a monthly MIS should contain",
    description:
      "The monthly MIS report format used by Indian businesses, section by section: P&L summary, balance sheet, cash flow, ratios and ageing — with a worked example.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/tally-mis-report",
    title: "MIS report from Tally: which exports to take and what to do with them",
    description:
      "How to produce a monthly MIS from TallyPrime or Tally.ERP 9 exports: which reports to take, the export settings that matter, and how to stop rebuilding it monthly.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/for-accountants",
    title: "Monthly reporting for accounting firms",
    description:
      "Management reporting across a portfolio of clients, without a junior rebuilding each workbook by hand. One mapping per client, reused every month, with every number traceable.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/ai-mis-report",
    title: "AI MIS report generator: AI maps the ledgers, never writes the numbers",
    description:
      "MIS with AI, done safely: AI recognises your sheets, maps ledgers and drafts commentary, while every figure comes from a deterministic engine and traces back to a ledger.",
    changeFrequency: "monthly",
    priority: 0.85,
  },
  {
    path: "/mis-in-minutes",
    title: "MIS in minutes: automate the monthly MIS report you rebuild by hand",
    description:
      "Confirm the ledger mapping once, then each month's MIS refreshes from the new trial balance in minutes, with live Excel formulas and no AI calls when nothing has changed.",
    changeFrequency: "monthly",
    priority: 0.85,
  },
  {
    path: "/automated-management-accounts",
    title: "Automated management accounts from your trial balance",
    description:
      "Monthly management accounts produced from a trial balance export: P&L, balance sheet, KPIs, aged debtors and commentary in Excel, every figure traceable, paid per report.",
    changeFrequency: "monthly",
    priority: 0.85,
  },
  {
    path: "/monthly-financial-reporting",
    title: "Monthly financial reporting software for small businesses",
    description:
      "Month-end reporting from your accounting system's trial balance: P&L with year to date, balance sheet, KPIs, A/R and A/P aging and commentary, in an Excel workbook you can audit.",
    changeFrequency: "monthly",
    priority: 0.85,
  },
  {
    path: "/guides",
    title: "Guides to monthly management reporting and MIS",
    description:
      "Practical guides for accountants and finance teams: MIS format, ratios and KPIs, mapping a trial balance, ageing reports, commentary and the month-end close.",
    changeFrequency: "weekly",
    priority: 0.7,
  },
  {
    path: "/guides/mis-kpis-and-ratios",
    title: "KPIs and ratios for a monthly MIS: formulas and what they tell you",
    description:
      "The ratios a monthly MIS or management accounts pack should carry — margins, debtor, creditor and inventory days, cash conversion cycle, current and quick ratio — with formulas.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/guides/trial-balance-to-management-report",
    title: "Trial balance to management report: mapping ledgers to report heads",
    description:
      "How a trial balance becomes a P&L and balance sheet summary: grouping ledgers into report heads, sign conventions, checks that the totals tie, and reusing the mapping monthly.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/guides/debtors-ageing-report",
    title: "Debtors ageing report: format, buckets and how to read it",
    description:
      "How to build a receivables ageing report (aged debtors, A/R aging): choosing buckets, ageing from bill date or due date, unallocated receipts, and acting on the result.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/guides/mis-commentary",
    title: "MIS commentary and variance analysis: how to write it so it gets read",
    description:
      "Writing the commentary in a monthly MIS or management accounts pack: which variances to explain, a materiality threshold, sentence patterns that work, and ones to avoid.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/guides/month-end-close-checklist",
    title: "Month-end close checklist before the management report",
    description:
      "The checks to finish before a month's figures go into an MIS or management accounts: bank reconciliation, cut-off, accruals, depreciation, control accounts and suspense.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/security",
    title: "Security and data handling",
    description:
      "Where your accounting files go: encrypted under each company's own key, redacted before the AI sees any of them, and deleted automatically on a schedule. Stated exactly.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/pricing",
    title: "Pricing",
    description:
      "Prepaid credits, a fixed price per action, shown and confirmed before anything runs. Billed in US dollars, or in rupees for customers in India. No subscription and no free tier.",
    changeFrequency: "weekly",
    priority: 0.9,
  },
  {
    path: "/legal/terms",
    title: "Terms of service",
    description: `The terms on which ${PRODUCT_NAME} is provided: prepaid credits, what they buy, how long they last, and the limits of what a generated report is.`,
    changeFrequency: "monthly",
    priority: 0.3,
  },
  {
    path: "/legal/privacy",
    title: "Privacy notice",
    description: `How ${PRODUCT_NAME} handles personal data: what is collected, what happens to the files you upload, who processes it, and your rights in India, the UK and the EEA.`,
    changeFrequency: "monthly",
    priority: 0.3,
  },
];

/**
 * The guides, in the order the index and the home page list them. Each lives under
 * `/guides/` except the four written before the section existed, which keep their URLs —
 * moving a page that already ranks throws the ranking away.
 */
export const GUIDE_PATHS: readonly string[] = [
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
  "/ai-mis-report",
  "/mis-in-minutes",
  "/automated-management-accounts",
  "/monthly-financial-reporting",
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
  return {
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: PRODUCT_NAME,
      locale: "en_IN",
      url,
      title: page.title,
      description: page.description,
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
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
