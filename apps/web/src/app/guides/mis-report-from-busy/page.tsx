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

const PATH = "/guides/mis-report-from-busy";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "MIS report in Busy software", "trial balance in Busy software", "Busy to Excel export",
 * "Busy data export to Excel", "profit and loss account in Busy software", "Busy software balance
 * sheet" — all Google autocomplete completions under the India setting on 2026-10-05.
 *
 * Every menu path, report name and export option below was read on BUSY's own FAQ pages on
 * 2026-10-05 (SPEC §0.4), and no others are printed:
 * - https://busy.in/faqs/final-results/trial-balance/1/ (Display > Trial Balance, Closing Trial -
 *   Alphabetical, Balance only or Detailed; Excel or PDF)
 * - https://busy.in/faqs/final-results/balance-sheet/5.md (Display > Final Results > Balance
 *   Sheet; Export tab or Alt+E; data format Microsoft Excel)
 * - https://busy.in/faqs/final-results/profit-and-loss-account/7.md (Display > Final Results >
 *   Profit and Loss Account)
 * - https://busy.in/faqs/accounting-reports/outstanding-analysis/5/ (Display > Outstanding
 *   Analysis > Bills Receivable, Ageing Receivables)
 * - https://busy.in/faqs/accounting-reports/account-books/21/ (Display > Account Books > Account
 *   Registers (Standard) > Sales Register / Purchase Register; Alt+E; Microsoft Excel)
 * Re-check them before changing a path: menus move between BUSY releases.
 *
 * Nothing here claims a connection to BUSY. There is none: the product works from exports.
 * The mapping table is invented (SPEC §2.3).
 */

const EXPORTS: readonly {
  report: string;
  why: string;
  required: boolean;
}[] = [
  {
    report: "Trial Balance",
    why: "Every ledger's closing balance. Everything in the MIS is built from it, so take one for each month you want to report, with the ledgers listed rather than only the groups.",
    required: true,
  },
  {
    report: "Profit & Loss A/c",
    why: "Income, expenses and profit for the period as BUSY lays them out. Useful to check the MIS income statement back against the books.",
    required: false,
  },
  {
    report: "Balance Sheet",
    why: "Assets and liabilities at the month end, for the same check on the balance sheet side.",
    required: false,
  },
  {
    report: "Bills Receivable and Bills Payable",
    why: "Each pending bill with its date, from Outstanding Analysis. This is what the debtors and creditors ageing is built from.",
    required: false,
  },
  {
    report: "Sales Register and Purchase Register",
    why: "Invoice-level sales and purchases, where the MIS needs revenue by customer or by month in more detail than the ledgers give.",
    required: false,
  },
];

const SETTINGS: readonly { title: string; body: string }[] = [
  {
    title: "Export to Microsoft Excel, never PDF",
    body: "BUSY offers both. A PDF holds every figure as text on a page, so each one would have to be re-keyed or scraped, and both introduce errors nobody sees until the totals fail to tie. Choose Microsoft Excel as the data format.",
  },
  {
    title: "Keep the ledgers, not just the groups",
    body: "A trial balance that shows only the groups has lost the ledger names, and the ledger names are what an MIS is mapped from. Pick the view that lists each ledger with its balance.",
  },
  {
    title: "One file per month, the same way every month",
    body: "A single export covering the year cannot be split back into months reliably. Set the date range for one month, export it, and repeat with the same options. Twelve months, twelve files, and the comparatives build themselves.",
  },
];

const MAPPING: readonly [string, string, string, string][] = [
  ["Sales GST 18%", "Income", "(84.60)", "Revenue from operations"],
  ["Purchase GST 18%", "Expense", "61.25", "Purchases of stock-in-trade"],
  ["Salary", "Expense", "6.80", "Employee cost"],
  ["Godown Rent", "Expense", "1.20", "Other expenses"],
  ["Interest on CC Limit", "Expense", "0.95", "Finance costs"],
  ["Sharma Traders", "Asset", "4.35", "Trade receivables"],
];

const STEPS = [
  {
    icon: "upload" as const,
    title: "Upload the BUSY exports",
    body: "The monthly trial balances, and the bills receivable and payable reports if you want ageing. Before you pay for anything, the screen shows only file names, sizes, sheet counts and row counts.",
  },
  {
    icon: "sliders" as const,
    title: "Every ledger is mapped to a report head, once",
    body: "Each BUSY ledger is placed under a head of your MIS: revenue, purchases, employee cost, finance costs, trade receivables and so on. Rules settle most of them; AI suggests the rest, and anything it cannot place is shown as unmapped rather than guessed. The mapping is kept.",
  },
  {
    icon: "check-circle" as const,
    title: "Take a checked workbook, a dashboard and commentary",
    body: "An Excel workbook with the P&L and year to date, a balance sheet summary, key ratios, debtors and creditors ageing, and a payroll summary when payroll data is loaded, in lakhs and crores on an April to March year by default. Beside it, a dashboard you build by chatting and a written commentary on the month. Every figure opens onto the ledgers it came from.",
  },
  {
    icon: "refresh" as const,
    title: "Next month is a refresh",
    body: "Export the new month's trial balance from BUSY and upload it. The mapping is reused, and if no ledger has been added the refresh makes no AI call at all. A new ledger is flagged for you to place.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "What is an MIS report in BUSY software?",
    answer:
      "An MIS report in BUSY usually means the monthly management report built from BUSY's data: a profit and loss with the month and the year to date, a balance sheet, key ratios, debtors and creditors ageing, and a written explanation of the month. BUSY produces the reports that report is made from. The MIS itself is assembled from them, usually in Excel.",
  },
  {
    question: "Which BUSY report do I have to export for an MIS?",
    answer:
      "The Trial Balance, one for each month, with every ledger shown. It holds every balance, so a P&L, a balance sheet and the ratios can all be built from it. The Profit & Loss A/c and Balance Sheet are useful as a check, Bills Receivable and Bills Payable add the ageing, and the sales and purchase registers add invoice-level detail.",
  },
  {
    question: `Does ${PRODUCT_NAME} connect to BUSY?`,
    answer:
      "No. There is no connector, no add-on and nothing to install beside BUSY. You export the reports you would export anyway and upload the files; nothing holds standing access to your books.",
  },
  {
    question: "Is it safe to upload BUSY exports?",
    answer:
      "Each file is encrypted under a key unique to that company and kept until you delete it. No member of staff can open a file, every opening is on a record you can see, and deleting the company destroys its key. The AI receives redacted ledger names and capped, redacted samples, never a whole file and never your parties' names.",
  },
  {
    question: "Does it charge every month?",
    answer:
      "It runs on prepaid credits, with no subscription, and credits never expire. The first month is the setup; each month after is a refresh that reuses the mapping, which is why it costs a fraction of the first.",
  },
];

export default function MisReportFromBusyGuide() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="MIS report from BUSY: which reports to export, and what to do next"
        intro="BUSY holds every figure a monthly MIS needs, in reports it already produces. What it does not do is turn them into one management report with comparatives, ratios, ageing and commentary. This is which reports to take each month, where they are, and what to do with them."
      />

      <WideSection
        title="Five BUSY reports make a monthly MIS, and only the trial balance is essential"
        intro="Each of the others adds a section to the report or a check on it, rather than being needed to produce one."
      >
        <div className="mx-auto max-w-[860px] overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[520px] border-collapse text-[0.9375rem]">
            <thead>
              <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  BUSY report
                </th>
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  What it gives the MIS
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
          Report names and menu paths are as BUSY&rsquo;s own help gives them. Menus can
          differ between releases, so where your screen disagrees, trust the screen.
        </p>
      </WideSection>

      <Section title="BUSY opens every one of these reports from the Display menu">
        <p>
          <strong className="font-medium text-neutral-900">Trial balance.</strong> In the
          Display menu, open Trial Balance and choose{" "}
          <strong className="font-medium text-neutral-900">
            Closing Trial - Alphabetical
          </strong>
          , with Balance only or Detailed. A window then asks which accounts to include
          (all accounts, a group of accounts or selected accounts) and the date range.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Profit and loss and balance sheet.
          </strong>{" "}
          Both are under{" "}
          <strong className="font-medium text-neutral-900">
            Display &gt; Final Results
          </strong>
          : choose Profit &amp; Loss A/c or Balance Sheet, set the date range and open the
          report.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Outstandings and ageing.
          </strong>{" "}
          Under{" "}
          <strong className="font-medium text-neutral-900">
            Display &gt; Outstanding Analysis
          </strong>{" "}
          are Bills Receivable and Bills Payable, which list pending bills summary only or
          bill-wise, and Ageing Receivables and Ageing Payables, party-wise or party
          group-wise.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">Registers.</strong> Under{" "}
          <strong className="font-medium text-neutral-900">
            Display &gt; Account Books &gt; Account Registers (Standard)
          </strong>{" "}
          are the Sales Register and the Purchase Register, for all parties or a
          selection, over the date range you enter.
        </p>
      </Section>

      <Section title="BUSY to Excel: the Export tab or Alt+E, with Microsoft Excel as the data format">
        <p>
          With the report open, click the{" "}
          <strong className="font-medium text-neutral-900">Export</strong> tab at the top
          of the BUSY screen or press{" "}
          <strong className="font-medium text-neutral-900">Alt+E</strong>. Choose{" "}
          <strong className="font-medium text-neutral-900">Microsoft Excel</strong> as the
          data format, give the file a path and name, and press OK.
        </p>
        <ul className="flex flex-col gap-4">
          {SETTINGS.map((s) => (
            <li key={s.title}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">{s.title}</h3>
              <p className="mt-1.5 leading-relaxed text-neutral-600">{s.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="A monthly MIS from BUSY is rebuilt by hand, and the rebuild is where the days go">
        <p>
          A monthly MIS holds a P&amp;L for the month and the year to date beside last
          year, a balance sheet, the key ratios, debtors and creditors ageing, and a
          written note on what changed. Producing it from BUSY by hand means pasting each
          trial balance into a workbook, mapping every ledger to a report head with
          lookups, fixing the signs, rolling the comparatives forward and writing the
          commentary from scratch.
        </p>
        <p>
          The mapping is the fragile part. A ledger opened mid-year, say a new GST sales
          ledger or a second bank account, falls through the lookup, a head quietly
          understates, and nobody notices until the balance sheet does not tie. The
          commentary is the slow part: it is written last, by whoever has the least time
          left.
        </p>
      </Section>

      <WideSection
        title="Mapping BUSY ledgers to MIS heads is the step that has to be right"
        intro="A few rows from the mapping of a fictional trading company. Balances in lakhs of rupees for the year to date; credits in brackets, as a trial balance holds them."
      >
        <div className="mx-auto max-w-[900px]">
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
            <table className="w-full min-w-[620px] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    BUSY ledger
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Nature
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    Year to date
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    MIS head
                  </th>
                </tr>
              </thead>
              <tbody>
                {MAPPING.map(([ledger, nature, balance, head]) => (
                  <tr key={ledger} className="border-b border-neutral-100 last:border-0">
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-normal text-neutral-800"
                    >
                      {ledger}
                    </th>
                    <td className="px-5 py-2.5 text-neutral-600">{nature}</td>
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
            Invented ledgers and balances, for illustration only. Nothing here comes from
            anyone&rsquo;s books.
          </FictionalNote>
        </div>
      </WideSection>

      <WideSection
        title={`${PRODUCT_NAME} turns the BUSY exports into a checked MIS, and month two is a refresh`}
        intro="It works from the files you export. It does not connect to BUSY."
      >
        <div className="mx-auto max-w-[760px]">
          <Steps steps={STEPS} />
          <p className="mt-6 text-[0.9375rem] leading-relaxed text-neutral-600">
            The AI maps ledgers and writes the words. It is not allowed to write a figure:
            every number in the workbook, the dashboard and the commentary is computed by
            the engine from your trial balance, and a draft that contains a number of its
            own is rejected.
          </p>
        </div>
      </WideSection>

      <MidCta />

      <Section title="What people ask about an MIS from BUSY">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext
        paths={[
          "/mis-report-format",
          "/guides/trial-balance-to-management-report",
          "/guides/debtors-ageing-report",
          "/how-to-make-an-mis-report-in-excel",
        ]}
      />
      <ClosingCta
        heading="Upload last month's BUSY trial balance and see the MIS"
        body={`${PRODUCT_NAME} maps every BUSY ledger to a report head once, builds a checked workbook, a dashboard and commentary, and keeps the mapping so next month is a refresh.`}
      />
    </PublicShell>
  );
}
