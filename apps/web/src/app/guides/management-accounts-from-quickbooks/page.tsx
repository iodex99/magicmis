import type { Metadata } from "next";

import {
  ClosingCta,
  Faqs,
  FictionalNote,
  MarketingHeader,
  MidCta,
  ReadNext,
  Section,
  Steps,
  WideSection,
} from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import {
  ArticleSchema,
  BreadcrumbSchema,
  FaqSchema,
  type Faq,
} from "@/components/StructuredData";
import { PRODUCT_NAME } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/guides/management-accounts-from-quickbooks";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "QuickBooks management reports", "how to prepare management accounts in QuickBooks",
 * "QuickBooks Online management reports" (docs/plans/seo-keywords.md, new page 2). Written in
 * US and Canadian words: aging, A/R, financial reporting package.
 *
 * Every menu path, report name and export option was read on Intuit's own help on 2026-10-05
 * (SPEC §0.4):
 * - QuickBooks Online, run reports (US):
 *   https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/run-reports-quickbooks-online/L7aILHhbl_US_en_US
 * - QuickBooks Online, run reports (Canada):
 *   https://quickbooks.intuit.com/learn-support/en-ca/help-article/report-management/run-reports-quickbooks-online/L7aILHhbl_CA_en_CA
 * - Export reports to Excel:
 *   https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/export-reports-excel-quickbooks-online/L7iAoP97n_US_en_US
 * - Reports by plan and section:
 *   https://quickbooks.intuit.com/learn-support/en-us/help-article/purchase-orders/reports-included-quickbooks-online-subscription/L0s4KrGgr_US_en_US
 * - A/R aging: https://quickbooks.intuit.com/learn-support/en-us/help-article/accounts-receivable-reports/run-accounts-receivable-aging-report/L4N7PC2hg_US_en_US
 * - Matching aging reports: https://quickbooks.intuit.com/learn-support/en-us/help-article/financial-reports/get-aging-reports-match/L9T7gcIJw_US_en_US
 * - Management reports: https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/view-edit-management-reports-quickbooks-online/L90RAh2XZ_US_en_US
 * - QuickBooks Desktop, export to Excel:
 *   https://quickbooks.intuit.com/learn-support/en-us/help-article/export-reports/export-reports-excel-workbooks-quickbooks-desktop/L4cLJEeXt_US_en_US
 * - QuickBooks Desktop, company and financial reports:
 *   https://quickbooks.intuit.com/learn-support/en-us/help-article/customize-reports/customize-company-financial-reports/L0kGdvblz_US_en_US
 *
 * Deliberately not printed: the Desktop menu path to the Trial Balance and the Desktop aging
 * reports. Intuit's help articles did not state them (only community answers did), so the
 * page sends the reader to the Report Center to find them by name.
 */

const ONLINE_EXPORTS: readonly {
  report: string;
  section: string;
  why: string;
  required: boolean;
}[] = [
  {
    report: "Trial Balance",
    section: "For my accountant",
    why: "Every account's balance at the month end. The whole package is built from it. Run one for each month end you report.",
    required: true,
  },
  {
    report: "Profit and Loss",
    section: "Business overview",
    why: "Income and expenses for the period, as QuickBooks lays them out. A check on the package's income statement.",
    required: false,
  },
  {
    report: "Balance Sheet",
    section: "Business overview",
    why: "Assets, liabilities and equity at the month end, for the same check on the balance sheet.",
    required: false,
  },
  {
    report: "Accounts receivable aging detail",
    section: "Who owes you",
    why: "Each open invoice and how far past due it is: the A/R aging. The summary version gives one line per customer.",
    required: false,
  },
  {
    report: "Accounts payable aging detail",
    section: "What you owe",
    why: "Each unpaid bill and how far past due it is: the A/P aging.",
    required: false,
  },
];

const SETTINGS: readonly { title: string; body: string }[] = [
  {
    title: "Export to Excel or CSV, not PDF",
    body: "With a report open in QuickBooks Online, the Export/Print dropdown offers Export to Excel and Export as CSV, and Print/Save as PDF. Take Excel or CSV: a PDF turns every figure into text that has to be re-keyed. If data seems to be missing when the file opens, Intuit's help says the file is in protected view and Enable Editing shows the full report.",
  },
  {
    title: "One month end per file",
    body: "Run the Trial Balance with the period ending on the last day of the month, and start it on the same day every month, the first day of your fiscal year, so each file means the same thing. A dozen month ends make a dozen files.",
  },
  {
    title: "Accrual basis, and the aging matched to the balance sheet",
    body: "Intuit's own advice for making the A/R aging agree with the balance sheet and trial balance is to run those reports on the accrual accounting method, use the same dates, and set the aging report's Aging option to Report date. Do it once and keep it, so the aging ties to receivables every month.",
  },
];

const MAPPING: readonly [string, string, string, string][] = [
  ["Product sales", "Income", "(615)", "Revenue"],
  ["Cost of goods sold", "Cost of sales", "288", "Direct costs"],
  ["Salaries and wages", "Expense", "121", "Employee cost"],
  ["Warehouse rent", "Expense", "24", "Other operating expenses"],
  ["Interest on line of credit", "Expense", "6", "Finance costs"],
  ["Accounts receivable", "Asset", "173", "Trade receivables"],
];

const STEPS = [
  {
    icon: "upload" as const,
    title: "Upload the QuickBooks exports",
    body: "The month-end trial balances, and the A/R and A/P aging detail reports if you want aging. Before you pay for anything, the screen shows only file names, sizes, sheet counts and row counts.",
  },
  {
    icon: "sliders" as const,
    title: "Every account is mapped to a line of the package, once",
    body: "Each account in your QuickBooks chart of accounts is placed under a report line: revenue, direct costs, employee cost, finance costs, receivables and so on. AI suggests the places that rules cannot settle; anything it cannot place is shown as unmapped rather than guessed. The mapping is kept.",
  },
  {
    icon: "check-circle" as const,
    title: "Take a checked workbook, a dashboard and commentary",
    body: "An Excel workbook with the income statement and year to date, a balance sheet summary, key ratios and KPIs, A/R and A/P aging, and a payroll summary when payroll data is loaded. Beside it, a dashboard and a written commentary on the month. Every figure opens to the accounts it came from.",
  },
  {
    icon: "refresh" as const,
    title: "Next month is a refresh",
    body: "Export the new month end from QuickBooks and upload it. The mapping is reused, and if no account has been added the refresh makes no AI call at all. A new account is flagged for you to place.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Does QuickBooks have management reports?",
    answer:
      "QuickBooks Online has a Management reports tab under Reports. Its ready-made templates are Company Overview (Profit and Loss and Balance Sheet), Sales Performance (Profit and Loss, A/R Aging Detail and Sales by Customer Summary) and Expenses Performance (Profit and Loss, A/P Aging Detail and Expenses by Vendor Summary), and a report can be edited and saved as a copy. Intuit's help says they export as PDF on every plan, and as DOCX on Advanced and Intuit Enterprise Suite. They are a presentation of QuickBooks' own reports; the figures for your own package come from the standard reports, exported to Excel or CSV.",
  },
  {
    question: `Does ${PRODUCT_NAME} connect to QuickBooks?`,
    answer:
      "No. There is no QuickBooks integration, no sync and no app to authorize. You export the reports you would export anyway and upload the files, so nothing holds standing access to your books. The trade-off is plain: each month starts with an export. If a daily sync matters more to you than that, a tool that connects to QuickBooks is the better fit.",
  },
  {
    question: "Does it work with QuickBooks Desktop as well as QuickBooks Online?",
    answer:
      "Yes. It reads the exported files, not the software, so a trial balance exported from QuickBooks Desktop as an Excel workbook or CSV file is read the same way as one from QuickBooks Online. Files are read by their column headers, not by fixed positions.",
  },
  {
    question: "Which QuickBooks report do I have to export?",
    answer:
      "The Trial Balance at each month end. It holds every account's balance, so the income statement, the balance sheet and the ratios can all be built from it. The Profit and Loss and Balance Sheet exports are useful as a check, and the aging detail reports add the A/R and A/P aging.",
  },
  {
    question: "Is it safe to upload QuickBooks exports?",
    answer:
      "Each file is encrypted under a key unique to that company and kept until you delete it. No member of staff can open a file, every opening is on a record you can see, and deleting the company destroys its key. The AI receives redacted account names and capped, redacted samples, never a whole file and never your customers' or employees' names.",
  },
];

export default function ManagementAccountsFromQuickBooksGuide() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="Management reports from QuickBooks: what to export for a monthly package"
        intro="QuickBooks holds everything a monthly financial reporting package needs. Preparing management accounts in QuickBooks comes down to a handful of standard reports, exported to Excel at each month end, and then the work of turning them into a package someone wants to read. This covers QuickBooks Online and QuickBooks Desktop."
      />

      <WideSection
        title="Five QuickBooks Online reports make the package, and only the trial balance is essential"
        intro="In QuickBooks Online, go to Reports, then Standard reports, and use Find report by name or the section each report sits in. Open it, set the report period, then use the Export/Print dropdown."
      >
        <div className="mx-auto max-w-[860px] overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[620px] border-collapse text-[0.9375rem]">
            <thead>
              <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  Report
                </th>
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  Section
                </th>
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  What it gives the package
                </th>
              </tr>
            </thead>
            <tbody>
              {ONLINE_EXPORTS.map((row) => (
                <tr
                  key={row.report}
                  className="border-b border-neutral-100 last:border-0"
                >
                  <th
                    scope="row"
                    className="px-5 py-3 text-left align-top font-medium text-neutral-900"
                  >
                    {row.report}
                    {row.required ? (
                      <span className="mt-1 block text-[0.75rem] font-normal text-accent-700">
                        Required
                      </span>
                    ) : null}
                  </th>
                  <td className="px-5 py-3 align-top text-neutral-600">{row.section}</td>
                  <td className="px-5 py-3 align-top text-neutral-600">{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mx-auto mt-4 max-w-[860px] text-[0.8125rem] text-neutral-500">
          Report and section names are as Intuit&rsquo;s help gives them for the United
          States and Canada; some reports look different in the classic view and the new
          enhanced experience. Not every QuickBooks Online plan includes every report, and
          Intuit publishes the list by plan.
        </p>
      </WideSection>

      <Section title="Three export settings decide whether the month goes smoothly">
        <ul className="flex flex-col gap-4">
          {SETTINGS.map((s) => (
            <li key={s.title}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">{s.title}</h3>
              <p className="mt-1.5 leading-relaxed text-neutral-600">{s.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="In QuickBooks Desktop, the same reports export from the Report Center">
        <p>
          In QuickBooks Desktop for Windows, go to Reports, then Report Center, and
          double-click the report. Select the Excel dropdown, then Create New Worksheet or
          Update Existing Worksheet. If QuickBooks warns about too many columns, select
          Advanced and clear the Space between columns checkbox. Intuit&rsquo;s help says
          Desktop reports export as Excel workbooks, CSV files or PDFs.
        </p>
        <p>
          The Profit &amp; Loss Standard report is under Reports, then Company &amp;
          Financial, with the balance sheet reports beside it. Find the Trial Balance and
          the A/R and A/P aging summaries in the Report Center by name, and export each at
          the month end exactly as you would from QuickBooks Online.
        </p>
      </Section>

      <Section title="A monthly package is rebuilt by hand, and the rebuild is where the days go">
        <p>
          A monthly financial reporting package holds an income statement for the month
          and the year to date, a balance sheet, the KPIs the owners watch, A/R and A/P
          aging, and a written explanation of what changed. Producing it from QuickBooks
          by hand usually means pasting the trial balance into a workbook, mapping each
          account to a line with lookups, fixing signs, rolling the comparatives forward
          and writing the variance commentary from scratch.
        </p>
        <p>
          The mapping is the fragile part. An account added in QuickBooks mid-year falls
          through the lookup, a line quietly understates, and nobody notices until the
          totals fail to tie. The commentary is the slow part: it is written last, under
          the most pressure, at the end of the month-end close.
        </p>
      </Section>

      <WideSection
        title="Mapping QuickBooks accounts to report lines is the step that has to be right"
        intro="A few rows from the mapping of a fictional distributor. Balances in thousands of dollars; credits shown in parentheses, as a trial balance holds them."
      >
        <div className="mx-auto max-w-[900px]">
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
            <table className="w-full min-w-[620px] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Account
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Kind of account
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    Year to date
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Report line
                  </th>
                </tr>
              </thead>
              <tbody>
                {MAPPING.map(([account, type, balance, line]) => (
                  <tr key={account} className="border-b border-neutral-100 last:border-0">
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-normal text-neutral-800"
                    >
                      {account}
                    </th>
                    <td className="px-5 py-2.5 text-neutral-600">{type}</td>
                    <td className="px-5 py-2.5 text-right text-neutral-900 tabular-nums">
                      {balance}
                    </td>
                    <td className="px-5 py-2.5 text-neutral-800">{line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FictionalNote>
            Invented accounts and balances, for illustration only. Nothing here comes from
            anyone&rsquo;s books.
          </FictionalNote>
        </div>
      </WideSection>

      <WideSection
        title={`${PRODUCT_NAME} turns QuickBooks exports into a checked package, and month two is a refresh`}
        intro="It works from the files you export. It does not connect to QuickBooks."
      >
        <div className="mx-auto max-w-[760px]">
          <Steps steps={STEPS} />
          <p className="mt-6 text-[0.9375rem] leading-relaxed text-neutral-600">
            The AI maps accounts and writes the words. It is not allowed to write a
            figure: every number in the workbook, the dashboard and the commentary is
            computed by the engine from your trial balance, and a draft that contains a
            number of its own is rejected.
          </p>
        </div>
      </WideSection>

      <MidCta />

      <Section title="What people ask about management reports from QuickBooks">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/month-end-reporting-package",
          "/monthly-financial-reporting",
          "/guides/trial-balance-to-management-report",
          "/security",
        ]}
      />
      <ClosingCta
        heading="Upload last month's QuickBooks trial balance and see the package"
        body={`${PRODUCT_NAME} maps every QuickBooks account to a report line once, builds a checked workbook, a dashboard and commentary, and keeps the mapping so next month is a refresh.`}
      />
    </PublicShell>
  );
}
