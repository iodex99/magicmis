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
 * Where the files go, and what happens to them there (ADR 0032).
 *
 * A CA firm holds its clients' books; "we take security seriously" is worth nothing to them.
 * This page states the arrangement precisely, including the parts that are weaker than a
 * reader might assume — a security page that only lists strengths is not evidence. The
 * retention period is read from configuration, so the page cannot promise a different one
 * from the purge that enforces it.
 */

export default async function SecurityPage() {
  const { retentionDays } = await uploadLimits(db());
  const days = `${retentionDays.toString()} days`;

  const zones: readonly { zone: string; holds: string; highlight: boolean }[] = [
    {
      zone: "Our servers",
      holds: `Your uploaded files, each encrypted under a key that belongs to that company alone and deleted automatically ${days} after upload, or sooner when you delete them. Files are read, ledgers mapped and every figure computed here.`,
      highlight: true,
    },
    {
      zone: "Anthropic",
      holds:
        "Only what a specific step sends: the structure of a sheet, a small sample of its rows and the names of ledgers, with party names, employee names and identifiers replaced by tokens first. Never a whole file, never a figure to calculate, never a prompt chosen by the browser.",
      highlight: false,
    },
    {
      zone: "Your browser",
      holds:
        "Files leave it over an encrypted connection and the finished workbook comes back to it. Nothing from your files is kept in the browser.",
      highlight: false,
    },
  ];

  const controls: readonly { title: string; body: string }[] = [
    {
      title: "Files are encrypted the moment they arrive",
      body: "Each part of an uploaded file is encrypted under its company's own key before it is stored, so storage only ever holds ciphertext.",
    },
    {
      title: "Uploaded files are deleted on a schedule",
      body: `Files are deleted automatically ${days} after upload. The Uploaded files page lists every file kept and lets you delete any of them sooner. Deleting a company deletes its files.`,
    },
    {
      title: "Names and identifiers are redacted before the AI sees anything",
      body: "Party names, employee names, tax numbers, bank details, emails and phone numbers are replaced with tokens before any part of a file is sent to the AI model. The model proposes which line a ledger belongs on; it never produces a figure.",
    },
    {
      title: "Company data is encrypted under its own key",
      body: "Each company has its own data encryption key, wrapped by a master key held in a cloud KMS. Deleting a company destroys its key, which makes its stored data and files unreadable rather than merely flagged as deleted.",
    },
    {
      title: "One active session per account",
      body: "A new sign-in ends the previous session on its next request. There are no team logins, shared accounts or access links of any kind.",
    },
    {
      title: "Sensitive actions ask for the password again",
      body: "Data export, account deletion, company deletion and credential changes each require re-authentication, within a short session-bound window, throttled with its own lockout.",
    },
    {
      title: "The ledger is append-only and hash-chained",
      body: "Credit movements and audit events are chained by hash and carry no UPDATE or DELETE permission at the database level, so a silent edit is not available even to us. Anchors over the chain are verified nightly.",
    },
    {
      title: "Operator access is scoped and visible",
      body: "Break-glass access covers one company at a time, needs a fresh authenticator code, is written to the audit log, and emails you every day it is used.",
    },
  ];

  const faqs: readonly Faq[] = [
    {
      question: "Does my client's trial balance get uploaded?",
      answer: `Yes. It is sent over an encrypted connection, encrypted on arrival under a key unique to that company, used only for the runs you pay for, and deleted automatically ${days} after upload, or as soon as you delete it.`,
    },
    {
      question: "Does Anthropic see my accounting data?",
      answer:
        "Anthropic receives only what a specific step sends: a sheet's structure, a small sample of rows and ledger names, with names and identifiers replaced by tokens. There is no endpoint that forwards a prompt chosen by the browser, the API key is server-side only, and API data is not used to train models by default.",
    },
    {
      question: "Is there two-factor authentication?",
      answer:
        "Not for customer accounts. Sign-in is by password, with one active session per account, throttling by both IP and email address, re-authentication before anything irreversible, and login history with new-device email alerts. Stated plainly so you can weigh it: a leaked password is the single factor protecting an account, so use a password manager and a password unique to this service.",
    },
    {
      question: "Where is the data stored?",
      answer:
        "In the Mumbai region, with encryption keys held in a cloud KMS in the same region. The processing register lists the subprocessors involved and what each one holds.",
    },
    {
      question: "What happens if I delete my account?",
      answer:
        "Deletion requires re-authentication and typing your email address. The encryption keys are destroyed, which renders the stored data and files unreadable. Unused credits are forfeited, and deletion is refused while credits are held against running work.",
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
        intro="You hold your clients' books. That makes where they are sent, who can read them and when they are deleted the first things worth checking — so here they are exactly, including where the arrangement is weaker than you might assume."
      />

      <WideSection
        title="The three places"
        intro="The architecture is arranged around this table. Everything else follows from it."
      >
        <div className="mx-auto grid max-w-[1000px] gap-4 md:grid-cols-3">
          {zones.map((zone) => (
            <div
              key={zone.zone}
              className={`rounded-xl border p-5 ${
                zone.highlight
                  ? "border-accent-200 bg-accent-50/50"
                  : "border-neutral-200/80 bg-white"
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

      <Section title="The controls behind that">
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
          No external security audit has been carried out, and no compliance certification
          is held. The controls above are design decisions with automated tests behind
          them, which is a different and weaker thing than an independent assessment — and
          worth knowing before you decide.
        </p>
        <p>
          Your files are on our servers while they are kept. They are encrypted and
          deleted on a schedule, but they are there, and a service that never received the
          file would be a stronger guarantee than this one.
        </p>
        <p>
          Customer sign-in has one factor. That was a deliberate decision, recorded with
          its cost, and the compensating controls are listed above. If a second factor is
          a requirement for your firm, it is not available today.
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
