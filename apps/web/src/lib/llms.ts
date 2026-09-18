import { PRODUCT_NAME } from "./brand";
import {
  GUIDE_PATHS,
  PUBLIC_PAGES,
  REPORT_NAMES,
  SOLUTION_PATHS,
  absoluteUrl,
  publicPage,
} from "./seo";

/**
 * `/llms.txt` and `/llms-full.txt` (https://llmstxt.org).
 *
 * A search engine reads a site page by page; an assistant answering "what is a tool that
 * builds an MIS from a trial balance" reads whatever short, plain description it can find.
 * This is that description, in the format the proposal specifies: an H1, a blockquote
 * summary, plain paragraphs, then H2 sections of `- [name](url): note` links, with an
 * "Optional" section for what can be skipped when context is short.
 *
 * Built from `PUBLIC_PAGES`, like the sitemap, so a page cannot be added without appearing
 * here. Everything stated is already stated on the site: no vendor, no stack, no price that
 * lives in the admin-editable price book.
 */

const PRODUCT_PATHS: readonly string[] = [
  "/product",
  "/how-it-works",
  "/pricing",
  "/security",
];
const LEGAL_PREFIX = "/legal";

const link = (path: string): string => {
  const page = publicPage(path);
  return `- [${page.title}](${absoluteUrl(path) || "/"}): ${page.description}`;
};

const SUMMARY =
  "Upload the raw trial balance from any accounting system and get a checked monthly management report: an Excel workbook with live formulas, a boardroom-ready dashboard built by chatting and presented full screen, written commentary, and a chat that answers questions about the figures. Every number is computed by a deterministic engine and traceable to its ledger; the AI maps ledgers and writes sentences and never outputs a number.";

const FACTS: readonly string[] = [
  `${PRODUCT_NAME} produces the monthly management report that India calls an MIS report, the UK and Commonwealth call management accounts, and the US calls monthly financial reporting or the month-end reporting package.`,
  "Input: raw accounting data — a trial balance, and optionally ledgers, registers and ageing reports — as Excel, CSV, PDF or text, from Tally, QuickBooks, Xero, Sage, Zoho Books, NetSuite or any other system. There is no connector and no live access to the books.",
  "Output: a validated Excel workbook with live formulas and lineage on every cell, a web dashboard, written variance commentary, and a chat where every figure in an answer links to its formula and ledgers.",
  "The dashboard is dynamic and built by chatting: after the first MIS is built from the raw data, the customer asks in plain English for comparison boxes, trends against last year, tables or formulas of their own, and the dashboard changes as they chat, saved per company, with undo. It is presented live, full screen, from the product; it is not exported to PDF or slides.",
  "The AI recognises sheets, maps ledgers that rules cannot place, and drafts text around placeholders. It never computes or states a figure, never sees a whole file, and receives only redacted samples. A monthly refresh on an unchanged chart of accounts makes no AI calls.",
  "Sold as prepaid credit packs with no subscription, no per-seat fee and no minimum; credits never expire. Each action has a standard price in credits, and a job that needs more shows a quote first. There is no free tier or trial.",
  "One login per account, with as many companies as needed. Desktop browsers only.",
];

function sections(full: boolean): string {
  const others = PUBLIC_PAGES.map((p) => p.path).filter(
    (path) =>
      path !== "/" &&
      !PRODUCT_PATHS.includes(path) &&
      !SOLUTION_PATHS.includes(path) &&
      !GUIDE_PATHS.includes(path),
  );
  const legal = others.filter((p) => p.startsWith(LEGAL_PREFIX));
  const rest = others.filter((p) => !p.startsWith(LEGAL_PREFIX));
  const solutions = full ? SOLUTION_PATHS : SOLUTION_PATHS.slice(0, 8);
  const out = [
    "## Product",
    ...PRODUCT_PATHS.map(link),
    "",
    "## Solutions",
    ...solutions.map(link),
    "",
    "## Guides",
    ...[...GUIDE_PATHS, ...rest].map(link),
    "",
    "## Optional",
    ...(full ? [] : SOLUTION_PATHS.slice(8).map(link)),
    ...legal.map(link),
    `- [Sample monthly MIS workbook](${absoluteUrl("/samples/sample-monthly-mis.xlsx")}): A complete month for a fictional company, rendered by the product, to download.`,
  ];
  return out.join("\n");
}

export function llmsTxt(full: boolean): string {
  const names = REPORT_NAMES.map((n) => `- ${n.term}: ${n.where}`).join("\n");
  return [
    `# ${PRODUCT_NAME}`,
    "",
    `> ${SUMMARY}`,
    "",
    ...(full ? FACTS : FACTS.slice(0, 3)).flatMap((f) => [f, ""]),
    ...(full ? ["The same report, by the name each market uses:", "", names, ""] : []),
    sections(full),
    "",
  ].join("\n");
}
