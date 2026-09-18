import Link from "next/link";
import type { Metadata } from "next";

import {
  AlsoCalled,
  ClosingCta,
  Faqs,
  MarketingHeader,
  MidCta,
  ReadNext,
  Section,
  Steps,
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

const PATH = "/boardroom-ready-mis";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * "Dump raw data and get an MIS", "boardroom-ready MIS", "board meeting dashboard from a trial
 * balance", "build a dashboard by chatting", "AI dashboard builder for finance" (ADR 0046). The
 * reader wants to stop assembling slides the night before. The page's argument: you bring the
 * raw files, the first MIS is built for you, you shape the board by saying what you want on it,
 * and you present from the live dashboard, where any figure a director questions opens to its
 * source.
 */

const ASKS: readonly string[] = [
  "Add a box comparing revenue and profit with the same month last year.",
  "Show staff cost as a share of revenue, and how it moved on last month.",
  "Put a chart of the three biggest cost lines for the last six months under the KPIs.",
  "Draw this year's revenue against last year's, month by month.",
  "Rename the first card to Sales and move cash to the top.",
  "Turn the working capital table into a comparison with March.",
];

const STEPS: readonly {
  title: string;
  body: string;
  icon: "upload" | "chart" | "chat" | "play";
}[] = [
  {
    title: "Dump the raw data in",
    body: "The trial balance as it comes out of your accounting system, and ledgers, registers or ageing if you have them. Any number of files, any format that holds readable text. No template to fill in first.",
    icon: "upload",
  },
  {
    title: "The first MIS is built for you",
    body: "Ledgers are mapped, the month is computed and checked, and you get the workbook and a standard dashboard: revenue, margins, cash, the bridge from revenue to profit, costs and working capital.",
    icon: "chart",
  },
  {
    title: "Chat to make it yours",
    body: "Say what the board should show. Comparison boxes, trends against last year, tables and your own formulas appear as you ask, and every one is saved for that company from then on.",
    icon: "chat",
  },
  {
    title: "Press Present",
    body: "The dashboard takes the whole screen with nothing else on it. Step through the months with the arrow keys, and when someone asks where a number came from, click it.",
    icon: "play",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "What does “boardroom-ready” mean here?",
    answer:
      "Three things. The figures are checked before you see them: the trial balance nets to zero, subtotals tie, and anything that does not is flagged rather than hidden. Every figure is traceable: click it and you get the formula and the ledgers behind it. And it presents cleanly: one button puts the dashboard full screen in your company's own currency and number style, with no menus, chat or edit controls around it.",
  },
  {
    question: "Can I really just dump files in?",
    answer:
      "Yes. There is no input template. Upload the raw trial balance from Tally, QuickBooks, Xero, Sage, Zoho Books, SAP or a spreadsheet, along with anything else you have. Files are read by their content, not their name; a sheet that cannot be placed is set aside and said so, rather than failing the run.",
  },
  {
    question: "What can I ask the chat to build?",
    answer:
      "KPI cards, comparison boxes against the previous month or the same month last year, line and bar trends with last year alongside, stacked costs, a revenue-to-profit bridge, tables across months, and ageing charts. You can also ask for a figure that is not built in, such as a cost as a share of revenue: the chat writes the formula, and the engine computes it from your books every month.",
  },
  {
    question: "Does the AI make up the numbers on the dashboard?",
    answer:
      "No. The AI never writes a figure. When you ask for a new box it describes the box: which metrics, which months, what to compare. When you ask for a new formula it writes the formula. A deterministic engine computes every number from your loaded data, exactly, and the formula is shown in the lineage of each figure so you can check it.",
  },
  {
    question: "Can I export the dashboard to PDF or PowerPoint?",
    answer:
      "No, deliberately. A deck is out of date the moment it is exported, and a number on a slide cannot be questioned. You present from the live dashboard, where it can. The Excel workbook with live formulas is still yours to download for anyone who wants the file.",
  },
  {
    question: "Is what I build remembered?",
    answer:
      "Yes, for good, and per company. Each company you add keeps its own boxes, names and formulas through every later month. Next month you add the new files, refresh, and present the same board with the new figures. Every change can be undone.",
  },
];

export default function BoardroomReadyMisPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="From raw data to the boardroom"
        heading="Dump your raw data. Chat to build the board. Present it live."
        intro="Bring the files as they are. The first MIS is built and checked for you; from there you shape the dashboard by saying what you want on it, and run the meeting from it with one button. Every figure is computed from your books and one click from its source."
      />
      <AlsoCalled path={PATH} />

      <Section title="How it goes">
        <Steps steps={STEPS} />
      </Section>

      <Section title="Things you can say">
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {ASKS.map((q) => (
            <li
              key={q}
              className="rounded-xl border border-neutral-200/80 bg-surface px-4 py-3 text-[0.9375rem] text-neutral-800"
            >
              {q}
            </li>
          ))}
        </ul>
        <p>
          There is no mode to pick. Type a question and you get an answer; say what the
          dashboard should show and it changes beside you as you read the reply, with Undo
          on every change. The same box answers{" "}
          <Link href="/chat-with-your-mis" className="text-accent-700 hover:underline">
            questions about your figures
          </Link>
          .
        </p>
      </Section>

      <Section title="Why build the board by chatting">
        <p>
          A dashboard tool gives you a canvas and a learning curve. A slide deck gives you
          a night of copying numbers out of Excel, and a version that is wrong by the time
          it is projected. Both make the month-end report something you assemble.
        </p>
        <p>
          Here the report already exists when you start: {PRODUCT_NAME} builds the first
          MIS from the raw data, to the same checked standard every month. What is left is
          taste, and that is quicker said than dragged: what your directors look at first,
          which comparison they always ask for, the ratio your business watches that no
          template includes. You say it once, and it is on the board from then on.
        </p>
      </Section>

      <Section title="A formula of your own, without a number from the AI">
        <p>
          Ask for “staff cost as a share of revenue” and the chat adds a formula: staff
          cost ÷ revenue × 100. It does not calculate it. The engine that builds your
          workbook does, from your books, in exact arithmetic, for every month you have
          loaded, including how it moved on last month and last year. Click the figure and
          the formula and its inputs are there. This is the same rule the rest of the
          product follows, described on{" "}
          <Link href="/ai-mis-report" className="text-accent-700 hover:underline">
            MIS with AI
          </Link>
          : the AI describes and the engine computes.
        </p>
      </Section>

      <MidCta />

      <Section title="Questions people ask">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext paths={["/chat-with-your-mis", "/mis-dashboard", "/board-pack"]} />
      <ClosingCta
        heading="Put your own month on the board"
        body={`Create an account, add a company, and drop in the raw files. ${PRODUCT_NAME} builds the first MIS; you chat the rest into shape and press Present.`}
      />
    </PublicShell>
  );
}
