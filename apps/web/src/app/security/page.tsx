import { uploadLimits } from "@magicmis/jobs";
import type { Metadata } from "next";

import {
  ClosingCta,
  Faqs,
  MarketingHeader,
  ReadNext,
  Section,
  WideSection,
} from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import {
  ArticleSchema,
  BreadcrumbSchema,
  FaqSchema,
  type Faq,
} from "@/components/StructuredData";
import { db } from "@/lib/db";
import { pageMetadata } from "@/lib/seo";

const PATH = "/security";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * Where the files go, and what happens to them there (ADR 0032, trimmed in ADR 0042).
 *
 * What a buyer needs in order to decide, and nothing about how it is built: no vendor, no
 * product name, no region, no description of the internals. Naming the stack tells a reader
 * nothing they can act on and tells an attacker where to start. What the law requires to be
 * disclosed — who processes personal data, and where — lives in the privacy notice, which is
 * the document written for that purpose.
 *
 * The limits stay. A security page that lists only strengths is not evidence, and the three
 * things this one admits are the three a careful firm would ask about anyway. The retention
 * period is read from configuration, so the page cannot promise a different one from the purge
 * that enforces it.
 */

export default async function SecurityPage() {
  const { retentionDays } = await uploadLimits(db());
  const days = `${retentionDays.toString()} days`;

  const zones: readonly { zone: string; holds: string; highlight: boolean }[] = [
    {
      zone: "Our servers",
      holds: `Your uploaded files, each encrypted under a key that belongs to that company alone, and deleted automatically ${days} after upload or sooner if you delete them. Every figure is computed here.`,
      highlight: true,
    },
    {
      zone: "The AI model",
      holds:
        "Only what one step needs: the shape of a sheet, a small sample and ledger names, with names and identifiers replaced by tokens first. Never a whole file, and never a figure to calculate.",
      highlight: false,
    },
    {
      zone: "Your browser",
      holds:
        "Files leave it over an encrypted connection and the finished workbook comes back. Nothing from your files is kept in the browser.",
      highlight: false,
    },
  ];

  const controls: readonly { title: string; body: string }[] = [
    {
      title: "Encrypted the moment it arrives",
      body: "Every file is encrypted under its company's own key before it is stored. Each company has a separate key.",
    },
    {
      title: "Deleted on a schedule",
      body: `Uploaded files are deleted automatically ${days} after upload. Each company's page lists the files kept for it and lets you delete any of them sooner.`,
    },
    {
      title: "Redacted before any AI sees it",
      body: "Party names, employee names, tax numbers, bank details, emails and phone numbers are replaced with tokens first. The AI suggests where a ledger belongs and drafts sentences; it never produces a figure.",
    },
    {
      title: "Deleting means unreadable",
      body: "Deleting a company destroys its encryption key, so its data and files cannot be read again by anyone — not merely marked as deleted.",
    },
    {
      title: "One session, and a second check for anything irreversible",
      body: "A new sign-in ends the previous one; there are no shared logins or access links. Exporting data, deleting a company or an account, and changing credentials each ask for your password again.",
    },
    {
      title: "Our own access is limited and visible to you",
      body: "Support access covers one company at a time, is recorded, and emails you on every day it is used.",
    },
  ];

  const faqs: readonly Faq[] = [
    {
      question: "Does my client's trial balance get uploaded?",
      answer: `Yes. It is sent over an encrypted connection, encrypted on arrival under a key unique to that company, used only for the runs you pay for, and deleted automatically ${days} after upload, or as soon as you delete it.`,
    },
    {
      question: "Does the AI see my accounting data?",
      answer:
        "Only a redacted fragment of it, for the one step it is performing: a sheet's structure, a small sample and ledger names, with names and identifiers replaced by tokens. It never receives a whole file, and your data is not used to train AI models.",
    },
    {
      question: "Is there two-factor authentication?",
      answer:
        "Not for customer accounts. Sign-in is by password, with one active session per account, sign-in throttling, a password check before anything irreversible, and an email alert when a new device signs in. Stated plainly so you can weigh it: use a password manager and a password unique to this service.",
    },
    {
      question: "What happens if I delete my account?",
      answer:
        "Deletion asks for your password and your email address. The encryption keys are destroyed, which makes the stored data and files unreadable. Unused credits are forfeited, and an account cannot be deleted while work is still running.",
    },
    {
      question: "Who else processes my data?",
      answer:
        "The privacy notice lists every processor involved and what each one handles. It is the document written for that question, and it is kept current.",
    },
  ];

  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={faqs} />

      <MarketingHeader
        path={PATH}
        eyebrow="Security"
        heading="Where your files go, and what happens to them"
        intro="You hold your clients' books, so where they are sent, who can read them and when they are deleted are the first things worth checking. Here they are, including the limits."
      />

      <WideSection
        title="The three places"
        intro="Everything about how your data is handled follows from this."
      >
        <div className="mx-auto grid max-w-[1000px] gap-4 md:grid-cols-3">
          {zones.map((zone) => (
            <div
              key={zone.zone}
              className={`rounded-xl border p-5 ${
                zone.highlight
                  ? "border-accent-200 bg-accent-50/50"
                  : "border-neutral-200/80 bg-surface"
              }`}
            >
              <h3 className="text-[0.9375rem] font-semibold text-neutral-900">
                {zone.zone}
              </h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-neutral-600">
                {zone.holds}
              </p>
            </div>
          ))}
        </div>
      </WideSection>

      <Section title="What protects it">
        <ul className="flex flex-col gap-5">
          {controls.map((c) => (
            <li key={c.title}>
              <h3 className="text-[1rem] font-semibold text-neutral-900">{c.title}</h3>
              <p className="mt-1.5 leading-relaxed text-neutral-600">{c.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="What we do not claim">
        <p>
          No external security audit has been carried out and no compliance certification
          is held. Your files are on our servers while they are kept — encrypted and
          deleted on a schedule, but there. And customer sign-in has one factor. If any of
          those is a requirement for your firm, it is better to know now.
        </p>
      </Section>

      <Section title="Questions">
        <Faqs faqs={faqs} />
      </Section>

      <ReadNext paths={["/how-it-works", "/legal/privacy", "/for-accountants"]} />
      <ClosingCta />
    </PublicShell>
  );
}
