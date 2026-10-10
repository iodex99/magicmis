import type { Metadata } from "next";
import Link from "next/link";

import {
  AlsoCalled,
  ClosingCta,
  Faqs,
  MarketingHeader,
  MidCta,
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
import { db } from "@/lib/db";
import { pageMetadata } from "@/lib/seo";
import { welcomeOffer } from "@/lib/server/welcome";
import { WELCOME_TERMS_HREF, welcomeEvaluation } from "@/lib/welcome-copy";

const PATH = "/for-accountants";
export const metadata: Metadata = pageMetadata(PATH);
// Says what evaluating it costs from the live welcome offer (ADR 0068), so rendered per request.
export const dynamic = "force-dynamic";

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
    body: "Pasted values survive until someone asks where a number came from in a client meeting. Then the answer has to be reconstructed from the raw file, if it still exists.",
  },
  {
    title: "Client data lives in email and shared drives",
    body: "Trial balances move by attachment and sit in inboxes. Under data-protection law that is the firm's exposure, not the client's.",
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
    title: "Client files are encrypted, kept for you and opened by nobody",
    body: "Each client's files are encrypted under that company's own key, and nobody on our side has a way to open one. The AI receives redacted samples and ledger names, never a whole file.",
  },
];

const FAQS: readonly Faq[] = [
  {
    question: "Can I use one account for several clients?",
    answer:
      "Yes. One account holds as many companies as you need, each with its own mapping, its own history and its own encryption key. What an account does not have is multiple logins — there are no team members, roles or shared logins, and a second sign-in ends the first session.",
  },
  {
    question: "Can my team have their own logins?",
    answer:
      "No. One account means one login, deliberately: it keeps the audit trail unambiguous about who did what. If a firm needs separate access for separate staff, that is separate accounts today.",
  },
  {
    question: "How is it priced for a practice with many clients?",
    answer:
      "By action, paid from prepaid credits you buy in packs. Each action has a standard price, listed in your wallet. Credits are charged only for what you run, and each active company also carries a monthly memory fee. There is no per-seat or per-client subscription.",
  },
  {
    question: "What happens to a client's data when we stop acting for them?",
    answer:
      "Deleting a company destroys its encryption key, which makes the stored data unreadable rather than merely marked deleted. Retention periods and the purge schedule are set in configuration and recorded.",
  },
  {
    question: "Is the output a file we can edit and put our name on?",
    answer:
      "Yes. It is an ordinary Excel workbook with live formulas — not an image or a locked file. You can change it, extend it, and issue it however your firm issues its reports.",
  },
];

export default async function ForAccountantsPage() {
  const offer = await welcomeOffer(db());
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

      <Section title="The time goes on repeating work that has not changed">
        <ul className="flex flex-col gap-5">
          {PRESSURES.map((p) => (
            <li key={p.title}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">{p.title}</h3>
              <p className="mt-1.5 leading-relaxed text-neutral-600">{p.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="The mapping becomes a record, and a refresh makes no AI calls">
        <ul className="flex flex-col gap-5">
          {ANSWERS.map((a) => (
            <li key={a.title}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">{a.title}</h3>
              <p className="mt-1.5 leading-relaxed text-neutral-600">{a.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Client accounting services (CAS) reporting is the same package, client after client">
        <p>
          For a CPA firm with a client accounting services practice, the monthly
          deliverable is the reporting package: income statement and balance sheet with
          comparatives, KPIs, A/R and A/P aging, and a short commentary. CAS reporting is
          where the margin of the service is won or lost, because the bookkeeping is
          already done and the package is rebuilt by hand for each client after the close.
        </p>
        <p>
          Here each client is a company in one account, with its own mapping, history and
          encryption key. Upload the client&apos;s raw trial balance from QuickBooks, Xero
          or whatever they use, with the aging reports if you want them; the package comes
          back as an Excel workbook with live formulas — income statement with year to
          date, balance sheet summary, KPIs and aging — a dashboard and commentary,
          checked to tie to the trial balance. From the second month it is a refresh.
        </p>
      </Section>

      <Section title="A monthly MIS for CA firms, client by client, from the books they already keep">
        <p>
          Indian CA firms that offer a monthly MIS usually receive a Tally export from
          each client and rebuild the same workbook from it: P&amp;L and balance sheet in
          lakhs, against last month and the same month last year, ratios, debtors and
          creditors ageing, and commentary for the promoter. The firm&apos;s time goes on
          mapping ledgers that were mapped last month too.
        </p>
        <p>
          {PRODUCT_NAME} keeps that mapping for each client company, reads the financial
          year from April by default (configurable per company), parses dates day-first
          and formats figures in lakhs and crores, or in absolute figures or millions if
          the client prefers. Each client&apos;s files are encrypted under that
          company&apos;s own key, nobody on our side can open one, and deleting a
          client&apos;s company destroys its key.
        </p>
      </Section>

      <Section title="Client reporting for bookkeepers turns closed books into a report the client reads">
        <p>
          A bookkeeper&apos;s clients see the books as a set of reports exported from the
          ledger, which most owners do not open. Client reporting is the step after: a
          month&apos;s figures set out as a profit and loss, a balance sheet, cash and the
          handful of KPIs that matter, with sentences explaining what moved.
        </p>
        <p>
          It is a service a bookkeeper can add without a new system. Upload the trial
          balance you closed, and the client gets a workbook and a dashboard you can
          present to them live, full screen, where every figure opens onto the ledgers it
          came from — so the question “where does that number come from?” is answered in
          the meeting. You pay per action from prepaid credits; there is no per-client
          subscription.
        </p>
      </Section>

      <Section title="What it does not do">
        <p>
          It is worth being direct about this, because the gaps matter more to a practice
          than the features.
        </p>
        <p>
          There are no team logins or client portals, and none are planned — one account
          is one login. What a client can be sent is a read-only link to a copy of their
          board, frozen when the link is made, which expires and which you can withdraw;
          it opens no chat, file or workbook. There is no live connector to any accounting
          system: you take the raw reports and load the files. There is no scheduled
          refresh without someone uploading the month. {welcomeEvaluation(offer)}
          {offer.credits > 0n ? (
            <>
              {" "}
              <Link href={WELCOME_TERMS_HREF} className="text-accent-700 underline">
                Offer terms
              </Link>
            </>
          ) : null}
        </p>
        <p>
          The professional judgement stays yours. The workbook is a prepared report to be
          reviewed and signed off, not an opinion — the commentary says what moved, and a
          reviewer decides what it means.
        </p>
      </Section>

      <MidCta />

      <Section title="What practices ask before moving client months onto it">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext paths={["/how-it-works", "/security", "/fathom-alternative"]} />
      <ClosingCta
        heading="Try it on one client's month"
        body={`Create an account and run one company's last month. ${PRODUCT_NAME} charges per action rather than per seat.`}
      />
    </PublicShell>
  );
}
