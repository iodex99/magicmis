import type { Metadata } from "next";

import {
  AlsoCalled,
  ClosingCta,
  Faqs,
  MarketingHeader,
  ReadNext,
  Section,
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

const PATH = "/for-accountants";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * The practice case: many clients, same month, same deadline.
 *
 * No claimed customers, no testimonials, no logo wall — there are none yet, and inventing
 * them is the one marketing lie that cannot be quietly corrected later. The argument is
 * made from what the product does instead.
 */

const PRESSURES: readonly { title: string; body: string }[] = [
  {
    title: "The mapping lives in one person's workbook",
    body: "Whoever built the client's template knows which ledger feeds which head. When they are on another assignment, the month is late — and the reviewer cannot tell a mapping decision from a typing error.",
  },
  {
    title: "Every month repeats work that has not changed",
    body: "Ledger structure is stable between months. Re-keying the trial balance, re-checking the lookups and re-formatting the workbook is effort spent re-deriving something already known.",
  },
  {
    title: "A figure nobody can trace cannot be defended",
    body: "Pasted values survive until someone asks where a number came from in a client meeting. Then the answer has to be reconstructed from the export, if the export still exists.",
  },
  {
    title: "Client data lives in email and shared drives",
    body: "Trial balances move by attachment and sit in inboxes. Under the DPDP Act that is the firm's exposure, not the client's.",
  },
];

const ANSWERS: readonly { title: string; body: string }[] = [
  {
    title: "The mapping is a record, not a spreadsheet",
    body: "It belongs to the company, is versioned, and is reused every month. A new ledger is flagged for a decision; everything else carries forward untouched.",
  },
  {
    title: "A refresh on unchanged structure makes no AI calls",
    body: "That is a design guarantee with a test behind it, not a tuning target — which is why a monthly refresh costs a fraction of the first setup.",
  },
  {
    title: "Every figure carries its lineage",
    body: "Click a number in the dashboard and it shows the ledgers and vouchers behind it. Commentary never contains a written number: figures are computed and inserted through placeholders.",
  },
  {
    title: "Client files are encrypted and deleted on schedule",
    body: "Each client's files are encrypted under that company's own key and deleted automatically. The AI receives redacted samples and ledger names, never a whole file.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Can I use one account for several clients?",
    answer:
      "Yes. One account holds as many companies as you need, each with its own mapping, its own history and its own encryption key. What an account does not have is multiple logins — there are no team members, roles or shared access, and a second sign-in ends the first session.",
  },
  {
    question: "Can my team have their own logins?",
    answer:
      "No. One account means one login, deliberately: it keeps the audit trail unambiguous about who did what. If a firm needs separate access for separate staff, that is separate accounts today.",
  },
  {
    question: "How is it priced for a practice with many clients?",
    answer:
      "By action, from a published price book, paid in prepaid credits — one credit is one rupee excluding GST. Credits are charged only for what you run, and each active company also carries a monthly memory fee. There is no per-seat or per-client subscription.",
  },
  {
    question: "What happens to a client's data when we stop acting for them?",
    answer:
      "Deleting a company destroys its encryption key, which makes the stored data unreadable rather than merely marked deleted. Retention periods and the purge schedule are set in configuration and recorded.",
  },
  {
    question: "Is the output a file we can edit and put our name on?",
    answer:
      "Yes. It is an ordinary Excel workbook with live formulas — not an image or a locked export. You can change it, extend it, and issue it however your firm issues its reports.",
  },
];

export default function ForAccountantsPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="For practices"
        heading="Monthly reporting across a portfolio of clients"
        intro="The difficulty in monthly management reporting is rarely one client. It is twenty of them, in the same week, to the same standard, with the work spread across people who did not build the template."
      />
      <AlsoCalled path={PATH} />

      <Section title="What actually costs the time">
        <ul className="flex flex-col gap-5">
          {PRESSURES.map((p) => (
            <li key={p.title}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">{p.title}</h3>
              <p className="mt-1.5 leading-relaxed text-neutral-600">{p.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="What changes">
        <ul className="flex flex-col gap-5">
          {ANSWERS.map((a) => (
            <li key={a.title}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">{a.title}</h3>
              <p className="mt-1.5 leading-relaxed text-neutral-600">{a.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="What it does not do">
        <p>
          It is worth being direct about this, because the gaps matter more to a practice
          than the features.
        </p>
        <p>
          There are no team logins, client portals or share links, and none are planned —
          one account is one login. There is no live connector to any accounting system:
          you export the reports and load the files. There is no scheduled refresh without
          someone uploading the month. And there is no free tier or trial, so evaluating
          it means buying credits for a real month.
        </p>
        <p>
          The professional judgement stays yours. The workbook is a prepared report to be
          reviewed and signed off, not an opinion — the commentary says what moved, and a
          reviewer decides what it means.
        </p>
      </Section>

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext paths={["/how-it-works", "/security", "/pricing"]} />
      <ClosingCta
        heading="Try it on one client's month"
        body={`Create an account and run one company's last month. ${PRODUCT_NAME} charges per action rather than per seat.`}
      />
    </PublicShell>
  );
}
