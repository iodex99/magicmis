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

const PATH = "/guides/mis-report-from-marg";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Trial balance in Marg software", "profit and loss report in Marg", "profit and loss in Marg
 * software", "Marg balance sheet", "Marg export to Excel", "Marg outstanding report" — Google
 * autocomplete completions under the India setting on 2026-10-05.
 *
 * Every menu path, report name and export option below was read on Marg's own help site, Marg
 * Help (care.margcompusoft.com), on 2026-10-05 (SPEC §0.4), and no others are printed:
 * - https://care.margcompusoft.com/margerp/trail-balance/152969/1/How-to-view-Trial-balance
 *   (Final Reports > Trial Balance; Alt+P; Trial Printing; Excel)
 * - https://care.margcompusoft.com/margerp/trail-balance/55912/1/How-to-view-trial-balance
 * - https://care.margcompusoft.com/margerp/balance-sheet/150230/1/How-to-export-balance-sheet
 *   (Final Reports > Balance Sheet; Stock Valuation window; Alt+P; Excel, Word, PDF, HTML)
 * - https://care.margcompusoft.com/margerp/profit-and-loss/55911/1/How-to-view-profit--
 *   (Final Reports > Profit & Loss; Alt+P; View/Print/Excel/PDF)
 * - https://care.margcompusoft.com/margerp/profit-and-loss/109990/1/How-to-view-month-wise
 *   (F2 for a Month window)
 * - https://care.margcompusoft.com/margerp/outstandings/45/1/How-to-view-debtors-outstanding
 *   (Books > Outstanding > Whole)
 * - https://care.margcompusoft.com/margerp/outstandings/181767/1/how-to-view-party-wise-creditor-outstanding-on-the-basis-of-due-days-in-marg-software
 *   (Books > Outstandings > Creditors: Party Wise)
 * - https://care.margcompusoft.com/margerp/purchase-register/135689/1/How-to-view-Purchase-Register
 *   (Books > Purchase Register)
 * - https://care.margcompusoft.com/margerp/entry-books/2007/1/How-to-view-excel-print-Sale-Book
 *   (Reports > Sale Analysis > Sale Book; Alt+P; View/Excel/Print)
 * Re-check them before changing a path: menus move between Marg releases.
 *
 * Nothing here claims a connection to Marg. There is none: the product works from exports.
 * The mapping table is invented (SPEC §2.3).
 */

const EXPORTS: readonly {
  report: string;
  why: string;
  required: boolean;
}[] = [
  {
    report: "Trial Balance",
    why: "Every ledger's balance. Everything in the MIS is built from it, so take one for each month you want to report.",
    required: true,
  },
  {
    report: "Profit & Loss",
    why: "Income, expenses and profit for the period, with opening and closing stock. Useful to check the MIS income statement back against the books.",
    required: false,
  },
  {
    report: "Balance Sheet",
    why: "Assets and liabilities at the month end, for the same check on the balance sheet side.",
    required: false,
  },
  {
    report: "Outstanding (debtors and creditors)",
    why: "What each party owes or is owed, bill by bill. This is what the debtors and creditors ageing is built from.",
    required: false,
  },
  {
    report: "Sale Book and Purchase Register",
    why: "Invoice-level sales and purchases, where the MIS needs revenue by customer or by month in more detail than the ledgers give.",
    required: false,
  },
];

const SETTINGS: readonly { title: string; body: string }[] = [
  {
    title: "Choose Excel in the print window, never PDF",
    body: "Marg offers Excel beside View, Print and PDF. A PDF holds every figure as text on a page, so each one would have to be re-keyed, and the errors that brings are invisible until someone reconciles.",
  },
  {
    title: "Settle the stock valuation the same way every month",
    body: "Opening the profit and loss or the balance sheet brings up a Stock Valuation window. Marg's help explains that No shows the statement as it was last updated, not brought up to date, and that the valuation rate is chosen there too. Closing stock moves profit directly, so pick the update and the rate once and use them every month.",
  },
  {
    title: "One file per month, not the year in one",
    body: "A single export covering the year cannot be split back into months reliably. Export each month on its own and the comparatives build themselves.",
  },
];

const MAPPING: readonly [string, string, string, string][] = [
  ["Sale GST 12%", "Income", "(212.40)", "Revenue from operations"],
  ["Purchase GST 12%", "Expense", "171.85", "Purchases of stock-in-trade"],
  ["Staff Salary", "Expense", "9.60", "Employee cost"],
  ["Delivery Van Expenses", "Expense", "2.15", "Other expenses"],
  ["Interest on OD", "Expense", "1.40", "Finance costs"],
  ["Shree Medical Stores", "Asset", "6.25", "Trade receivables"],
];

const STEPS = [
  {
    icon: "upload" as const,
    title: "Upload the Marg exports",
    body: "The monthly trial balances, and the debtors and creditors outstanding if you want ageing. Before you pay for anything, the screen shows only file names, sizes, sheet counts and row counts.",
  },
  {
    icon: "sliders" as const,
    title: "Every ledger is mapped to a report head, once",
    body: "Each Marg ledger is placed under a head of your MIS: revenue, purchases, employee cost, finance costs, trade receivables and so on. Rules settle most of them; AI suggests the rest, and anything it cannot place is shown as unmapped rather than guessed. The mapping is kept.",
  },
  {
    icon: "check-circle" as const,
    title: "Take a checked workbook, a dashboard and commentary",
    body: "An Excel workbook with the P&L and year to date, a balance sheet summary, key ratios, debtors and creditors ageing, and a payroll summary when payroll data is loaded, in lakhs and crores on an April to March year by default. Beside it, a dashboard you build by chatting and a written commentary on the month. Every figure opens onto the ledgers it came from.",
  },
  {
    icon: "refresh" as const,
    title: "Next month is a refresh",
    body: "Export the new month's trial balance from Marg and upload it. The mapping is reused, and if no ledger has been added the refresh makes no AI call at all. A new ledger is flagged for you to place.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Can Marg ERP produce an MIS report by itself?",
    answer:
      "Marg produces the reports an MIS is made from: the trial balance, profit and loss, balance sheet, outstandings and the sale and purchase books. What it does not produce is one management report with the month beside the year to date and last year, ratios worked the same way every month, ageing and a written explanation of the month. That is usually assembled by hand in Excel.",
  },
  {
    question: "Which Marg report do I have to export for an MIS?",
    answer:
      "The Trial Balance, one for each month. It holds every ledger's balance, so a P&L, a balance sheet and the ratios can all be built from it. The Profit & Loss and Balance Sheet are useful as a check, the outstandings add the ageing, and the Sale Book and Purchase Register add invoice-level detail.",
  },
  {
    question: "How do I see one month's profit and loss in Marg?",
    answer:
      "Marg's help gives it as Final Reports > Profit & Loss, then F2 in the window that follows to pick a month, and a From and Upto date for the period. Whatever period you choose, use the same Stock Valuation choice each month so the closing stock is valued the same way.",
  },
  {
    question: `Does ${PRODUCT_NAME} connect to Marg?`,
    answer:
      "No. There is no connector, no add-on and nothing to install beside Marg. You export the reports you would export anyway and upload the files; nothing holds standing access to your books.",
  },
  {
    question: "Is it safe to upload Marg exports?",
    answer:
      "Each file is encrypted under a key unique to that company and kept until you delete it. No member of staff can open a file, every opening is on a record you can see, and deleting the company destroys its key. The AI receives redacted ledger names and capped, redacted samples, never a whole file and never your parties' names.",
  },
];

export default function MisReportFromMargGuide() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Guide"
        heading="MIS report from Marg ERP: which reports to export, and what to do next"
        intro="Marg holds every figure a monthly MIS needs, in reports it already produces. What it does not do is turn them into one management report with comparatives, ratios, ageing and commentary. This is which reports to take each month, where Marg keeps them, and what to do with them."
      />

      <WideSection
        title="Five Marg reports make a monthly MIS, and only the trial balance is essential"
        intro="Each of the others adds a section to the report or a check on it, rather than being needed to produce one."
      >
        <div className="mx-auto max-w-[860px] overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
          <table className="w-full min-w-[520px] border-collapse text-[0.9375rem]">
            <thead>
              <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  Marg report
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
          Report names and menu paths are as Marg&rsquo;s own help gives them for Marg
          ERP. Menus can differ between releases and editions, so where your screen
          disagrees, trust the screen.
        </p>
      </WideSection>

      <Section title="Marg keeps the statements under Final Reports and the outstandings under Books">
        <p>
          <strong className="font-medium text-neutral-900">Trial balance.</strong>{" "}
          <strong className="font-medium text-neutral-900">
            Final Reports &gt; Trial Balance
          </strong>
          . Selecting a head shows its detail, and F2 shows a particular month or date.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">
            Profit and loss and balance sheet.
          </strong>{" "}
          <strong className="font-medium text-neutral-900">
            Final Reports &gt; Profit &amp; Loss
          </strong>{" "}
          and{" "}
          <strong className="font-medium text-neutral-900">
            Final Reports &gt; Balance Sheet
          </strong>
          . Each first asks how to update the stock valuation: No, Current Date or All
          Days. For the profit and loss, F2 then opens a Month window and a From and Upto
          date.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">Outstandings.</strong>{" "}
          <strong className="font-medium text-neutral-900">
            Books &gt; Outstanding &gt; Whole
          </strong>{" "}
          for debtors, with an As on Date and filters for negative amounts and post-dated
          cheques, and{" "}
          <strong className="font-medium text-neutral-900">
            Books &gt; Outstandings &gt; Creditors: Party Wise
          </strong>{" "}
          for creditors, where the Detailed List can be limited to bills past a number of
          days.
        </p>
        <p>
          <strong className="font-medium text-neutral-900">Sales and purchases.</strong>{" "}
          <strong className="font-medium text-neutral-900">
            Reports &gt; Sale Analysis &gt; Sale Book
          </strong>{" "}
          and{" "}
          <strong className="font-medium text-neutral-900">
            Books &gt; Purchase Register
          </strong>
          , each for the From and To dates you enter.
        </p>
      </Section>

      <Section title="Marg to Excel: press Alt+P on the report, then choose Excel">
        <p>
          With the report open, press{" "}
          <strong className="font-medium text-neutral-900">Alt+P</strong>. For the trial
          balance a Trial Printing window appears; set the filters and click{" "}
          <strong className="font-medium text-neutral-900">Excel</strong>, and the file is
          saved to the location you choose. The profit and loss offers View, Print, Excel
          and PDF; the balance sheet can be exported to Excel, Word, PDF or HTML.
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

      <Section title="A monthly MIS from Marg is rebuilt by hand, and the rebuild is where the days go">
        <p>
          A monthly MIS holds a P&amp;L for the month and the year to date beside last
          year, a balance sheet, the key ratios, debtors and creditors ageing, and a
          written note on what changed. For a distributor or a pharmacy on Marg, producing
          it by hand means pasting each trial balance into a workbook, mapping every
          ledger to a report head with lookups, fixing the signs, rolling the comparatives
          forward and writing the commentary from scratch.
        </p>
        <p>
          The mapping is the fragile part. A ledger opened mid-year, such as a new GST
          rate on sales or a second overdraft, falls through the lookup, a head quietly
          understates, and nobody notices until the balance sheet does not tie. The
          commentary is the slow part: it is written last, by whoever has the least time
          left.
        </p>
      </Section>

      <WideSection
        title="Mapping Marg ledgers to MIS heads is the step that has to be right"
        intro="A few rows from the mapping of a fictional pharmaceutical distributor. Balances in lakhs of rupees for the year to date; credits in brackets, as a trial balance holds them."
      >
        <div className="mx-auto max-w-[900px]">
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-surface">
            <table className="w-full min-w-[620px] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-neutral-200/80 text-[0.8125rem] text-neutral-500">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">
                    Marg ledger
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
        title={`${PRODUCT_NAME} turns the Marg exports into a checked MIS, and month two is a refresh`}
        intro="It works from the files you export. It does not connect to Marg."
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

      <Section title="What people ask about an MIS from Marg">
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
        heading="Upload last month's Marg trial balance and see the MIS"
        body={`${PRODUCT_NAME} maps every Marg ledger to a report head once, builds a checked workbook, a dashboard and commentary, and keeps the mapping so next month is a refresh.`}
      />
    </PublicShell>
  );
}
