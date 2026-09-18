import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument, Pending, type LegalSection } from "@/components/LegalDocument";
import { PRODUCT_NAME } from "@/lib/brand";
import { legalFacts } from "@/lib/server/legal";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/legal/terms");

/**
 * Terms of service (R-10).
 *
 * A complete draft written against how the product actually behaves: prepaid credits,
 * the per-action price book, the company lifecycle, browser-side processing, AI assistance
 * with deterministic figures, one login per account, and sales in India and abroad. Every
 * period is read from configuration (`legalFacts`), so a changed setting changes the
 * document with it.
 *
 * TODO(review): R-10 — legal sign-off before launch. Points a lawyer should look at first:
 * the processor terms in section 7 (whether a separate data processing agreement is needed
 * for EU/UK customers), the liability cap in section 13, governing law and venue in
 * section 17, and whether any consumer-protection law overrides the no-refund rule in the
 * countries sold into.
 */
export default async function TermsPage() {
  const f = await legalFacts();
  const we = f.sellerName ?? PRODUCT_NAME;
  const contact =
    f.supportEmail === null ? (
      <Pending>the support address published on this site</Pending>
    ) : (
      <a href={`mailto:${f.supportEmail}`} className="text-accent-700 underline">
        {f.supportEmail}
      </a>
    );

  const sections: LegalSection[] = [
    {
      id: "about",
      title: "About these terms",
      body: (
        <>
          <p>
            These terms are an agreement between you and {we}
            {f.sellerAddress.length > 0 ? `, of ${f.sellerAddress.join(", ")}` : ""} (
            &ldquo;we&rdquo;, &ldquo;us&rdquo;), for your use of {PRODUCT_NAME} (the
            &ldquo;service&rdquo;).
          </p>
          <p>
            The service is for business use. By creating an account you confirm that you
            are using it for a business, practice or profession, and that you have
            authority to accept these terms for that business. It is not offered to
            consumers.
          </p>
          <p>
            You accept these terms when you create an account. Our{" "}
            <Link href="/legal/privacy" className="text-accent-700 underline">
              privacy notice
            </Link>{" "}
            explains how personal data is handled, and the{" "}
            <Link href="/pricing" className="text-accent-700 underline">
              price book
            </Link>{" "}
            sets out what each action costs.
          </p>
        </>
      ),
    },
    {
      id: "service",
      title: "The service",
      body: (
        <>
          <p>
            The service prepares monthly management reports — a workbook, a dashboard and
            written commentary — from accounting data you load, and lets you ask questions
            about that data.
          </p>
          <p>
            Your source files are uploaded to us and processed on our servers. Figures in
            every output are computed by a deterministic calculation engine. Artificial
            intelligence is used to help recognise files, suggest how ledgers map to
            report lines, write commentary around computed figures, and answer questions;
            it does not produce the figures themselves.
          </p>
          <p>
            The service runs in current desktop versions of Chrome, Edge and Firefox. It
            is not designed for phones or tablets.
          </p>
        </>
      ),
    },
    {
      id: "account",
      title: "Your account",
      body: (
        <>
          <p>
            An account has one login. It may not be shared, and there are no team members
            or shared access. Signing in on a new device ends the session on the previous
            one.
          </p>
          <p>
            Sign-in is by email and password, without a second factor. You are responsible
            for keeping your password secret and for everything done with your account.
            Use a password you do not use anywhere else, and tell us straight away at{" "}
            {contact} if you believe your account has been used without your permission.
          </p>
          <p>
            You must give accurate account and billing details and keep them up to date,
            including your business name, billing address, country and, where you have
            one, your GST registration.
          </p>
        </>
      ),
    },
    {
      id: "credits",
      title: "Credits, prices and payment",
      body: (
        <>
          <p>
            The service is paid for with prepaid credits. Each action has a fixed credit
            price from the published price book. Pressing the button for an action (for
            example, building an MIS, adding a month, writing commentary or sending a chat
            message) is your instruction to run it and to charge its price. Some larger
            actions need a quote, which you accept before anything runs. You are never
            charged for an action you did not start, credits are charged only when the
            action is delivered, and your balance cannot go below zero. There is no free
            tier or trial.
          </p>
          <ul>
            <li>
              <strong>Customers billed in India</strong> pay in Indian rupees, plus GST at
              the applicable rate, and receive a GST tax invoice.
            </li>
            <li>
              <strong>Customers billed outside India</strong> pay in US dollars. The
              supply is an export of services and Indian GST is not charged. You are
              responsible for any tax, duty or reverse-charge obligation that applies to
              you in your own country.
            </li>
          </ul>
          <p>
            Payments are processed by our payment provider. Your bank or card issuer may
            charge its own fees, including for currency conversion; those are not charged
            by us.
          </p>
          <p>
            Credits do not expire. They remain available on your account until you spend
            them or the account is closed, and are used in the order they were bought.
          </p>
          <p>
            Credits are non-refundable, cannot be transferred to another account and
            cannot be exchanged for cash, except where section 11 provides otherwise or
            where the law requires a refund. If an action fails because of a fault on our
            side, you are not charged for it.
          </p>
          <p>
            We may change prices in the price book. A change applies to actions confirmed
            after it takes effect, and never to an action you have already confirmed or a
            quote you have already accepted.
          </p>
        </>
      ),
    },
    {
      id: "lifecycle",
      title: "Company memory fee and what happens if it is not paid",
      body: (
        <>
          <p>
            Once a company has been set up, the service keeps its memory — its mapping,
            templates, dashboard and past months — so later months can be refreshed
            without starting again. Each active company is charged a monthly memory fee in
            credits.
          </p>
          <p>If the fee cannot be taken from your balance:</p>
          <ul>
            <li>
              the company enters a grace period, during which you can view it and buy
              credits but not run new actions on it;
            </li>
            <li>
              if the fee is still unpaid after {f.graceMonths} months, the company is
              archived, and can be restored for the restore price;
            </li>
            <li>
              if it remains archived for {f.archiveMonths} months, it is permanently
              deleted and cannot be recovered.
            </li>
          </ul>
          <p>We email you before a company is archived and before it is deleted.</p>
        </>
      ),
    },
    {
      id: "data",
      title: "Your data and outputs",
      body: (
        <>
          <p>
            You keep all rights in the data you load and in the outputs prepared from it.
            You give us permission to process that data only as needed to provide the
            service to you, as described in the privacy notice.
          </p>
          <p>
            You confirm that you have the right to use the data you load for this purpose
            — including any data about your clients, their customers, suppliers or
            employees — and that doing so does not breach any law, contract or duty of
            confidence.
          </p>
          <p>
            You are responsible for the accuracy and completeness of the data you load,
            including identifiers such as GST registrations. Outputs are only as reliable
            as the data they are prepared from.
          </p>
        </>
      ),
    },
    {
      id: "processing",
      title: "Data we process on your behalf",
      body: (
        <>
          <p>
            Where the data you load includes personal data about other people — for
            example the names of your clients&rsquo; customers or employees — you decide
            why and how it is processed, and we process it on your behalf. For that data
            we will:
          </p>
          <ul>
            <li>
              process it only to provide the service to you and on your instructions;
            </li>
            <li>
              make sure everyone who can access it is bound by a duty of confidentiality;
            </li>
            <li>
              protect it with appropriate technical and organisational security measures,
              including encryption of uploaded files under a key unique to each company,
              their deletion on a fixed schedule, and redaction before anything is sent to
              an AI provider;
            </li>
            <li>
              use only the subprocessors listed in the privacy notice, and give notice
              before adding a new one;
            </li>
            <li>
              help you respond to requests from people exercising their rights over that
              data;
            </li>
            <li>
              tell you without undue delay if we become aware of a breach affecting it;
            </li>
            <li>
              delete it when you delete the company or your account, as set out in the
              privacy notice; and
            </li>
            <li>
              give you the information reasonably needed to show that we meet these
              commitments.
            </li>
          </ul>
          <p>
            If you need a separate data processing agreement, contact us at {contact}.
          </p>
        </>
      ),
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      body: (
        <>
          <p>You must not:</p>
          <ul>
            <li>
              load data you are not entitled to use, or use the service for anything
              unlawful;
            </li>
            <li>
              share your login, create accounts automatically, or use one account for
              people outside your business;
            </li>
            <li>
              try to get around charges, quotes or limits, or to obtain analysis or
              outputs without paying for them;
            </li>
            <li>
              try to extract the instructions, prompts or configuration behind the
              service, or to make it produce content unrelated to your accounting data;
            </li>
            <li>
              probe, scan or test the security of the service, or interfere with its
              operation or with other customers&rsquo; use of it;
            </li>
            <li>
              copy, resell or reverse engineer the service, or use it or its outputs to
              build a competing product or to train a machine-learning model; or
            </li>
            <li>
              load malicious files or content designed to harm the service or other users.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "ai",
      title: "AI assistance and professional judgement",
      body: (
        <>
          <p>
            The service is a tool for preparing reports. It is not accounting, audit, tax,
            legal or investment advice, and it does not replace the judgement of a
            qualified professional.
          </p>
          <p>
            Suggested mappings may be wrong and must be reviewed. Commentary and chat
            answers are written with AI assistance and may be incomplete or misleading
            even where the figures in them are correct. You are responsible for reviewing
            every output before you rely on it, share it or issue it to anyone else.
          </p>
        </>
      ),
    },
    {
      id: "availability",
      title: "Availability and changes to the service",
      body: (
        <>
          <p>
            We work to keep the service available and secure, but we do not promise that
            it will be uninterrupted or free of errors. We may carry out maintenance, and
            we may change, add or remove features. We will not remove a feature you have
            already paid for in a way that deprives you of credits you have bought without
            offering a fair remedy.
          </p>
        </>
      ),
    },
    {
      id: "termination",
      title: "Suspension and ending the agreement",
      body: (
        <>
          <p>
            You can delete your account at any time from{" "}
            <Link href="/settings/privacy" className="text-accent-700 underline">
              Privacy and data
            </Link>{" "}
            settings. Deletion cannot be undone, unused credits are forfeited, and an
            account cannot be deleted while credits are held for work that is still
            running.
          </p>
          <p>
            We may suspend or close your account if you materially breach these terms, if
            we reasonably suspect fraud or misuse, or if the law requires it. Where it is
            reasonable to do so, we will tell you first and give you a chance to put
            things right.
          </p>
          <p>
            If we stop providing the service altogether, or close your account for a
            reason other than your breach, we will refund the purchase price of your
            unused credits.
          </p>
        </>
      ),
    },
    {
      id: "warranties",
      title: "What we do and do not promise",
      body: (
        <>
          <p>
            We will provide the service with reasonable skill and care. Apart from that,
            and to the extent the law allows, the service and its outputs are provided
            &ldquo;as is&rdquo;, without any other warranty, including warranties of
            fitness for a particular purpose or that outputs will be accurate or complete.
          </p>
        </>
      ),
    },
    {
      id: "liability",
      title: "Limits on liability",
      body: (
        <>
          <p>To the extent the law allows:</p>
          <ul>
            <li>
              neither of us is liable for loss of profit, revenue, business, goodwill or
              data, or for any indirect or consequential loss; and
            </li>
            <li>
              our total liability arising out of or in connection with these terms is
              limited to the amount you paid us for credits in the twelve months before
              the event giving rise to the claim.
            </li>
          </ul>
          <p>
            Nothing in these terms limits liability for fraud, for death or personal
            injury caused by negligence, or for anything else that cannot be limited by
            law.
          </p>
        </>
      ),
    },
    {
      id: "indemnity",
      title: "Your responsibility for data you load",
      body: (
        <p>
          You will compensate us for losses and reasonable costs arising from a claim by a
          third party that data you loaded infringed their rights or that you had no right
          to load it.
        </p>
      ),
    },
    {
      id: "confidentiality",
      title: "Confidentiality",
      body: (
        <p>
          Each of us will keep the other&rsquo;s confidential information confidential and
          use it only for the purposes of this agreement, except where disclosure is
          required by law. Your source data, outputs and company memory are your
          confidential information.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to these terms",
      body: (
        <p>
          We may update these terms. For a material change we will give you reasonable
          notice by email or in the service before it takes effect. If you do not agree to
          the change, you may stop using the service and delete your account before it
          takes effect.
        </p>
      ),
    },
    {
      id: "law",
      title: "Governing law and disputes",
      body: (
        <p>
          These terms are governed by the laws of India. The courts at{" "}
          {f.jurisdictionCity ?? <Pending>the city of our registered office</Pending>}{" "}
          have exclusive jurisdiction over any dispute arising out of or in connection
          with them, although we will always try to resolve a concern with you directly
          first.
        </p>
      ),
    },
    {
      id: "general",
      title: "General",
      body: (
        <ul>
          <li>
            These terms, with the privacy notice and the price book, are our entire
            agreement.
          </li>
          <li>
            You may not transfer your rights under these terms without our consent. We may
            transfer ours as part of a reorganisation or sale of our business.
          </li>
          <li>
            If any part of these terms is found unenforceable, the rest continues to
            apply.
          </li>
          <li>Not enforcing a right straight away does not mean giving it up.</li>
          <li>
            Neither of us is responsible for a delay or failure caused by events beyond
            our reasonable control.
          </li>
          <li>We may send you notices by email to the address on your account.</li>
        </ul>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: <p>Questions about these terms: {contact}.</p>,
    },
  ];

  return (
    <LegalDocument
      title="Terms of service"
      version={f.versions.terms}
      lastUpdated={f.lastUpdated}
      intro={
        <p>
          These terms set out how {PRODUCT_NAME} works: what you pay for, what you can
          expect from us, and what we expect from you. They are written to be read, so
          each section says plainly what it means.
        </p>
      }
      sections={sections}
    />
  );
}
