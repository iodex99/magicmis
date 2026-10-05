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

const PATH = "/guides/management-accounts-from-xero";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Management accounts in Xero", "Xero management report pack", "how to produce management
 * accounts in Xero" (docs/plans/seo-keywords.md, new page 1).
 *
 * Every menu path, report name, option and export format below was read on Xero Central on
 * 2026-10-05 (SPEC §0.4):
 * - https://central.xero.com/s/article/Trial-Balance-report-new-version
 * - https://central.xero.com/s/article/Export-or-print-a-report
 * - https://central.xero.com/s/article/Management-reports-UK
 * - https://central.xero.com/s/article/Profit-and-Loss-New
 * - https://central.xero.com/s/article/Aged-Receivables-Summary-report-New
 * - https://central.xero.com/s/article/Aged-Receivables-Detail-report-New
 * - https://central.xero.com/s/article/Aged-Payables-Detail-report-New
 * - https://central.xero.com/0/article/Aged-Payables-Detail-report-New-US (US report name)
 * Re-check them before changing a path: Xero renames reports between versions.
 *
 * Nothing here claims a connection to Xero. There is none: the product works from exports.
 * The mapping table is invented (SPEC §2.3).
 */

const EXPORTS: readonly {
  report: string;
  why: string;
  required: boolean;
}[] = [
  {
    report: "Trial Balance",
    why: "Every account's balance at the month end, with debit and credit year-to-date columns by default. Everything in the pack is built from it. Export one for each month end you want to report.",
    required: true,
  },
  {
    report: "Profit and Loss",
    why: "Income, expenses and profit for the period, as Xero lays them out. Useful to check the pack's P&L back against the books.",
    required: false,
  },
  {
    report: "Balance Sheet",
    why: "Assets, liabilities and equity at the month end, for the same check on the balance sheet side.",
    required: false,
  },
  {
    report: "Aged Receivables Detail",
    why: "Each invoice, credit note and overpayment owed to you, and how long it has gone unpaid: the receivables ageing. The Summary version gives one line per customer.",
    required: false,
  },
  {
    report: "Aged Payables Detail",
    why: "Each bill, credit note, expense claim and overpayment you owe, and how long it has gone unpaid: the payables ageing.",
    required: false,
  },
];

const SETTINGS: readonly { title: string; body: string }[] = [
  {
    title: "Export to Excel, not PDF",
    body: "Xero exports a report as a PDF, an Excel file or a Google Sheet. Take Excel: a PDF holds figures as text on a page, and every one of them would have to be re-keyed. If some amounts show as 0.00 when the file opens, Xero's own help says to click Enable Editing in Excel and they update.",
  },
  {
    title: "One month end per file",
    body: "Set the Trial Balance date to the last day of the month (End of last month is one of the set periods) and keep the default year-to-date columns. Comparison columns from Compare with put several dates in one sheet without separate debits and credits, which is harder to read back. Twelve month ends, twelve files.",
  },
  {
    title: "The same basis and filters every month",
    body: "The More menu switches the report between accrual and cash basis, and Filter narrows it to tracking categories. Both are useful, and both change the balances. Pick accrual or cash once, leave the filter off for the company as a whole, and keep it that way so one month can be compared with the next.",
  },
];

const MAPPING: readonly [string, string, string, string][] = [
  ["Sales", "Revenue", "(482)", "Revenue"],
  ["Cost of Goods Sold", "Expense", "201", "Direct costs"],
  ["Wages and Salaries", "Expense", "96", "Employee cost"],
  ["Rent", "Expense", "18", "Other operating expenses"],
  ["Interest Expense", "Expense", "4", "Finance costs"],
  ["Accounts Receivable", "Asset", "137", "Trade receivables"],
];

const STEPS = [
  {
    icon: "upload" as const,
    title: "Upload the Xero exports",
    body: "The month-end trial balances, and the aged receivables and payables detail reports if you want ageing. Before you pay for anything, the screen shows only file names, sizes, sheet counts and row counts.",
  },
  {
    icon: "sliders" as const,
    title: "Every account is mapped to a report head, once",
    body: "Each Xero account is placed under a head of your management accounts: revenue, direct costs, employee cost, finance costs, receivables and so on. AI suggests the places it cannot settle by rule; anything it cannot place is shown as unmapped rather than guessed. The mapping is kept.",
  },
  {
    icon: "check-circle" as const,
    title: "Take a checked workbook, a dashboard and commentary",
    body: "An Excel workbook with the P&L and year to date, a balance sheet summary, key ratios, receivables and payables ageing, and a payroll summary when payroll data is loaded. Beside it, a dashboard and a written commentary on the month. Every figure opens to the accounts it came from.",
  },
  {
    icon: "refresh" as const,
    title: "Next month is a refresh",
    body: "Export the new month end from Xero and upload it. The mapping is reused, and if no account has been added the refresh makes no AI call at all. A new account is flagged for you to place.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Can Xero produce management accounts by itself?",
    answer:
      "Xero produces the reports management accounts are made from, and its Management Report groups six of them in one pack: Executive Summary, Cash Summary, Profit and Loss, Balance Sheet, Aged Receivables Summary and Aged Payables Summary. You can add, remove and reorder reports and save the pack as a custom report. Whether that is enough depends on the reader. When the board wants the business's own report heads, the same lines every month, ratios worked the same way and a written explanation of the month, the pack is usually still finished by hand in a spreadsheet.",
  },
  {
    question: `Does ${PRODUCT_NAME} connect to Xero?`,
    answer: `No. There is no Xero integration, no live sync and no access to grant. You export the reports you would export anyway and upload the files; nothing holds standing access to your books. The trade-off is plain: each month starts with an export. If a daily sync matters more to you than that, a tool that connects to Xero is the better fit.`,
  },
  {
    question: "Which Xero report do I have to export?",
    answer:
      "The Trial Balance at each month end. It holds every account's balance, so a P&L, a balance sheet and the ratios can all be built from it. The Profit and Loss and Balance Sheet exports are useful as a check, and the aged receivables and payables detail reports add the ageing section.",
  },
  {
    question: "How do I get one month's P&L from a Xero trial balance?",
    answer:
      "By default Xero's Trial Balance shows year-to-date debit and credit columns: for revenue and expense accounts they run from the first day of the financial year to the report date. Subtract last month end's figure from this month end's and the difference is the month. Xero can also show Debit - Month and Credit - Month columns, which run from the first of the month to the report date.",
  },
  {
    question: "Is it safe to upload Xero exports?",
    answer:
      "Each file is encrypted under a key unique to that company and kept until you delete it. No member of staff can open a file, every opening is on a record you can see, and deleting the company destroys its key. The AI receives redacted account names and capped, redacted samples, never a whole file and never your customers' or employees' names.",
  },
];

export default function ManagementAccountsFromXeroGuide() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="Management accounts from Xero: the reports to export, and what to do with them"
        intro="Xero holds everything a monthly management pack needs. Producing management accounts in Xero comes down to five reports, exported to Excel at each month end, and then the work of turning them into a pack someone wants to read. This is which reports, where they are, and how to stop rebuilding the pack every month."
      />

      <WideSection
        title="Five Xero reports make a monthly management pack, and only the trial balance is essential"
        intro="Every one of them is in Xero under Reporting, then All reports, where the search field in the top right corner finds a report by name. Open it, set the date, click Update, then Export."
      >
        <div className="mx-auto max-w-[860px] overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[520px] border-collapse text-[0.9375rem]">
            <thead>
              <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  Xero report
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
                  <td className="px-5 py-3 align-top text-neutral-600">{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mx-auto mt-4 max-w-[860px] text-[0.8125rem] text-neutral-500">
          Report names are as Xero Central gives them. In the United States edition the
          aged reports are called Accounts Receivable Aging Detail and Accounts Payable
          Aging Detail. You need the administrator, standard + reports or viewer user role
          to run and export them.
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

      <Section title="Xero's Management Report is a pack of Xero's own reports">
        <p>
          Xero has its own management report pack. The Management Report, under Reporting
          then All reports, groups six reports by default: Executive Summary, Cash
          Summary, Profit and Loss, Balance Sheet, Aged Receivables Summary and Aged
          Payables Summary. You can add reports, including more than one version of the
          same report, remove and reorder them, add your own text, and save the result as
          a draft, a published report or a custom report pack to reuse.
        </p>
        <p>
          If the reader is happy with Xero&rsquo;s layout and Xero&rsquo;s account names,
          that pack is a good answer. The trouble starts when the reader wants management
          accounts in the business&rsquo;s own shape: revenue split the way the directors
          think about it, the same report heads every month whatever accounts were added,
          last year beside this year, ratios worked out the same way each time, ageing for
          every month, and a paragraph that says why the month moved. That is the part
          that moves into a spreadsheet.
        </p>
      </Section>

      <Section title="A monthly pack is rebuilt by hand, and the rebuild is where the days go">
        <p>
          A monthly management pack holds a P&amp;L for the month and the year to date, a
          balance sheet, the key ratios, receivables and payables ageing, and a written
          commentary on what changed. Producing it from Xero by hand usually means pasting
          the trial balance into a workbook, mapping each account to a report head with
          lookups, fixing signs, rolling the comparatives forward and writing the
          commentary from scratch.
        </p>
        <p>
          The mapping is the fragile part. A new account added in Xero mid-year falls
          through the lookup, a head quietly understates, and nobody notices until the
          totals fail to tie. The commentary is the slow part: it is written last, under
          the most pressure, by whoever has the least time left.
        </p>
      </Section>

      <WideSection
        title="Mapping Xero accounts to report heads is the step that has to be right"
        intro="A few rows from the mapping of a fictional wholesaler. Balances in thousands; credits shown in brackets, as a trial balance holds them."
      >
        <div className="mx-auto max-w-[900px]">
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
            <table className="w-full min-w-[620px] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Xero account
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Account class
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
                {MAPPING.map(([account, type, balance, head]) => (
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
        title={`${PRODUCT_NAME} turns the Xero exports into a checked pack, and month two is a refresh`}
        intro="It works from the files you export. It does not connect to Xero."
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

      <Section title="What people ask about management accounts in Xero">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/management-accounts",
          "/guides/trial-balance-to-management-report",
          "/month-end-reporting-package",
          "/security",
        ]}
      />
      <ClosingCta
        heading="Upload last month's Xero trial balance and see the pack"
        body={`${PRODUCT_NAME} maps every Xero account to a report head once, builds a checked workbook, a dashboard and commentary, and keeps the mapping so next month is a refresh.`}
      />
    </PublicShell>
  );
}
