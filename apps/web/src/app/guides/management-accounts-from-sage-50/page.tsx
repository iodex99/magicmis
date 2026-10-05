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

const PATH = "/guides/management-accounts-from-sage-50";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Sage 50 management accounts", "how to produce management accounts on Sage 50", "can Sage
 * produce management accounts" (docs/plans/seo-keywords.md, new page 9). Written for Sage 50
 * Accounts in the UK and Ireland, with a short section for the US and Canadian editions,
 * which are different products with different menus.
 *
 * Every menu path, report name and export option was read on Sage's own help on 2026-10-05
 * (SPEC §0.4).
 * Sage 50 Accounts (UK knowledge base):
 * - Trial balance: https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=200427112357142
 * - Profit and loss: https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=200427112357111
 * - Management reports: https://gb-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=200427112226556
 * - Aged debtors: https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=200427112231182
 * - Aged creditors: https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=200427112555990
 * - Export to Excel: https://gb-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=200427112402216
 * - Common reports: https://gb-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=200909145539413
 * Sage 50 US and Canadian editions:
 * - https://help-sage50.na.sage.com/en-us/2023/Content/Reports_Forms/FinancialReports/GeneralLedgerTrialBalance.htm
 * - https://help-sage50.na.sage.com/en-us/2023/Content/Reports_Forms/AccountsReceivable/Aged_Receivables_Report.htm
 * - https://help-sage50.na.sage.com/en-us/2023/Content/Reports_Forms/MICROSOFT/Copy_Report_to_a_Microsoft_Excel_Spreadsheet.htm
 * - https://help-sage50.na.sage.com/en-ca/core/2018/Content/Reports_Forms/Financial/TrialBalance.htm
 * - https://help-sage50.na.sage.com/en-ca/core/2023/Content/Reports_Forms/ExportingReports.htm
 *
 * Deliberately not printed: the US edition's menu path to its reports list (Sage's page could
 * not be read in full), Sage 200 and Sage Pastel. The mapping table is invented (SPEC §2.3).
 */

const EXPORTS: readonly {
  report: string;
  where: string;
  why: string;
  required: boolean;
}[] = [
  {
    report: "Trial balance",
    where: "Nominal codes, then Trial balance",
    why: "Each nominal code's balance up to the period you choose, as balancing debits and credits. Everything in the pack is built from it. Run one for each month-end period.",
    required: true,
  },
  {
    report: "Profit and loss",
    where: "Nominal codes, then Profit & loss",
    why: "Sales, purchases, direct expenses and overheads for the period, laid out by the chart of accounts you choose. A check on the pack's P&L.",
    required: false,
  },
  {
    report: "Balance sheet",
    where: "Nominal codes, then Balance sheet",
    why: "Assets and liabilities at the period end, for the same check on the balance sheet.",
    required: false,
  },
  {
    report: "Aged debtors, Detailed",
    where: "Customers, then Reports, then Aged debtors",
    why: "Each outstanding transaction, grouped by customer: the aged debtors section of the pack. The Summary report gives one line per account.",
    required: false,
  },
  {
    report: "Aged creditors, Detailed",
    where: "Suppliers, then Reports, then Aged Creditors",
    why: "Each outstanding transaction owed to suppliers: the aged creditors section.",
    required: false,
  },
];

const SETTINGS: readonly { title: string; body: string }[] = [
  {
    title: "Use Data to Excel, not a PDF",
    body: "From a report, Sage 50 Accounts offers three ways out: Export saves the report with a file type you choose, Report to Excel sends it in the same format as the preview, and Data to Excel puts the information in columns ready for analysis. Take Data to Excel. If the header lines are missing from what reaches Excel, Sage's help says to switch them on in Report Designer, under View, Properties, Export Options.",
  },
  {
    title: "One month-end period per file",
    body: "The trial balance runs up to the period you select. Run it once for each month end you report, and if you also export the profit and loss and balance sheet, choose the same chart of accounts every time. Twelve periods, twelve files.",
  },
  {
    title: "Run the aged reports as at the month end",
    body: "When you run aged debtors or aged creditors after the month has closed, tick Exc Later Payments in the criteria window. Sage's help says this shows what was outstanding at the report date, which is what the month's pack needs, and the aged total then has a chance of agreeing with the control account on the trial balance.",
  },
];

const MAPPING: readonly [string, string, string][] = [
  ["Sales – trade customers", "(522)", "Revenue"],
  ["Materials purchased", "243", "Direct costs"],
  ["Gross wages", "104", "Employee cost"],
  ["Rent and rates", "21", "Other operating expenses"],
  ["Loan interest", "5", "Finance costs"],
  ["Debtors control account", "148", "Trade receivables"],
];

const STEPS = [
  {
    icon: "upload" as const,
    title: "Upload the Sage 50 exports",
    body: "The month-end trial balances, and the detailed aged debtors and aged creditors reports if you want ageing. Before you pay for anything, the screen shows only file names, sizes, sheet counts and row counts.",
  },
  {
    icon: "sliders" as const,
    title: "Every nominal code is mapped to a report head, once",
    body: "Each nominal account is placed under a head of your management accounts: revenue, direct costs, employee cost, finance costs, debtors and so on. AI suggests the places that rules cannot settle; anything it cannot place is shown as unmapped rather than guessed. The mapping is kept.",
  },
  {
    icon: "check-circle" as const,
    title: "Take a checked workbook, a dashboard and commentary",
    body: "An Excel workbook with the P&L and year to date, a balance sheet summary, key ratios, aged debtors and creditors, and a payroll summary when payroll data is loaded. Beside it, a dashboard and a written commentary on the month. Every figure opens to the nominal accounts it came from.",
  },
  {
    icon: "refresh" as const,
    title: "Next month is a refresh",
    body: "Export the next period from Sage 50 and upload it. The mapping is reused, and if no nominal code has been added the refresh makes no AI call at all. A new code is flagged for you to place.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Can Sage 50 produce management accounts?",
    answer:
      "Sage 50 Accounts has what it calls management reports: the Profit and loss, Balance sheet and Trial balance reports under Nominal codes, run by period and chart of accounts, with transactional versions for a date range. They are the raw material of management accounts. A pack in the business's own report heads, with this year beside last, ratios, ageing and a written explanation of the month, is usually still assembled by hand in Excel.",
  },
  {
    question: `Does ${PRODUCT_NAME} connect to Sage 50?`,
    answer:
      "No. There is no Sage integration, no connector and nothing to install beside Sage 50. You export the reports you would export anyway and upload the files, so nothing holds standing access to your books. Each month starts with an export.",
  },
  {
    question: "Which Sage 50 report do I have to export?",
    answer:
      "The trial balance for each month-end period. It holds every nominal code's balance, so the P&L, the balance sheet and the ratios can all be built from it. The profit and loss and balance sheet exports are useful as a check, and the detailed aged debtors and aged creditors reports add the ageing.",
  },
  {
    question: "Does it work with Sage 50 in the US and Canada?",
    answer:
      "Yes. It reads the exported files, not the software, and files are read by their column headers rather than fixed positions, so a trial balance exported as Excel or CSV from the US or Canadian edition is read the same way as one from Sage 50 Accounts.",
  },
  {
    question: "Is it safe to upload Sage 50 exports?",
    answer:
      "Each file is encrypted under a key unique to that company and kept until you delete it. No member of staff can open a file, every opening is on a record you can see, and deleting the company destroys its key. The AI receives redacted account names and capped, redacted samples, never a whole file and never your customers' or employees' names.",
  },
];

export default function ManagementAccountsFromSage50Guide() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="Management accounts from Sage 50: the reports to export each month"
        intro="Sage 50 holds everything a set of monthly management accounts needs. Producing management accounts on Sage 50 comes down to a trial balance per period and a few supporting reports, sent to Excel, and then the work of turning them into a pack the directors want to read."
      />

      <WideSection
        title="Five Sage 50 Accounts reports make a monthly pack, and only the trial balance is essential"
        intro="Paths are from Sage's UK help for Sage 50 Accounts. For each one, click Preview, then Run, choose the period, and click OK."
      >
        <div className="mx-auto max-w-[860px] overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[620px] border-collapse text-[0.9375rem]">
            <thead>
              <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  Report
                </th>
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  Where it is
                </th>
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  What it gives the pack
                </th>
              </tr>
            </thead>
            <tbody>
              {EXPORTS.map((row) => (
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
                  <td className="px-5 py-3 align-top text-neutral-600">{row.where}</td>
                  <td className="px-5 py-3 align-top text-neutral-600">{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mx-auto mt-4 max-w-[860px] text-[0.8125rem] text-neutral-500">
          The aged reports open a criteria window rather than a period: set the
          transaction dates and, after the month has closed, tick Exc Later Payments.
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

      <Section title="The US and Canadian editions of Sage 50 have different menus and the same job">
        <p>
          Sage 50 in the United States and Canada has its own help, menus and report
          names. In the US edition the trial balance is the General Ledger Trial Balance,
          which shows each account and its balance as of the date or period you select,
          and the Aged Receivables report ages invoices by invoice date or due date,
          depending on your Customer Defaults. Select a report in the Select a Report or
          Form window and click the Excel toolbar button to send it to a new workbook;
          Premium and higher editions offer a raw data layout.
        </p>
        <p>
          In the Canadian edition, open the Report Centre from the Home window, select
          Financials, then the trial balance report by name, and click Display.
          Sage&rsquo;s help lists Standard, Comparative and Net Changes for Period trial
          balances among others, and reports export as .xls or .csv files as well as PDF.
          Whichever edition you use, the rule is the same: one month-end trial balance per
          file, in a spreadsheet format.
        </p>
      </Section>

      <Section title="A monthly pack is rebuilt by hand, and the rebuild is where the days go">
        <p>
          A set of monthly management accounts holds a P&amp;L for the month and the year
          to date, a balance sheet, the key ratios, aged debtors and creditors, and
          commentary on what changed. Producing it from Sage 50 by hand usually means
          pasting the trial balance into a workbook, mapping each nominal code to a report
          head with lookups, fixing signs, rolling the comparatives forward and writing
          the commentary from scratch.
        </p>
        <p>
          The mapping is the fragile part. Sage&rsquo;s own reports group nominal codes by
          the chart of accounts you choose, but the directors usually want the
          business&rsquo;s own heads, and a nominal code added mid-year falls through the
          lookup until the totals fail to tie. The commentary is the slow part: it is
          written last, under the most pressure, by whoever has the least time left.
        </p>
      </Section>

      <WideSection
        title="Mapping nominal codes to report heads is the step that has to be right"
        intro="A few rows from the mapping of a fictional manufacturer. Balances in thousands of pounds; credits shown in brackets, as a trial balance holds them."
      >
        <div className="mx-auto max-w-[900px]">
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
            <table className="w-full min-w-[520px] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Nominal account
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    Year to date
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Report head
                  </th>
                </tr>
              </thead>
              <tbody>
                {MAPPING.map(([account, balance, head]) => (
                  <tr key={account} className="border-b border-neutral-100 last:border-0">
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-normal text-neutral-800"
                    >
                      {account}
                    </th>
                    <td className="px-5 py-2.5 text-right text-neutral-900 tabular-nums">
                      {balance}
                    </td>
                    <td className="px-5 py-2.5 text-neutral-800">{head}</td>
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
        title={`${PRODUCT_NAME} turns Sage 50 exports into checked management accounts, and month two is a refresh`}
        intro="It works from the files you export. It does not connect to Sage."
      >
        <div className="mx-auto max-w-[760px]">
          <Steps steps={STEPS} />
          <p className="mt-6 text-[0.9375rem] leading-relaxed text-neutral-600">
            The AI maps nominal codes and writes the words. It is not allowed to write a
            figure: every number in the workbook, the dashboard and the commentary is
            computed by the engine from your trial balance, and a draft that contains a
            number of its own is rejected.
          </p>
        </div>
      </WideSection>

      <MidCta />

      <Section title="What people ask about management accounts on Sage 50">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/management-accounts",
          "/guides/trial-balance-to-management-report",
          "/guides/debtors-ageing-report",
          "/security",
        ]}
      />
      <ClosingCta
        heading="Upload last month's Sage 50 trial balance and see the pack"
        body={`${PRODUCT_NAME} maps every nominal code to a report head once, builds a checked workbook, a dashboard and commentary, and keeps the mapping so next month is a refresh.`}
      />
    </PublicShell>
  );
}
