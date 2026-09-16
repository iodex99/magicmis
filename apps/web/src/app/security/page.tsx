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
import { pageMetadata } from "@/lib/seo";

const PATH = "/security";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * What leaves the machine, and what does not.
 *
 * A CA firm holds its clients' books; "we take security seriously" is worth nothing to
 * them. This page states the boundary precisely, including the parts that are weaker than
 * a reader might assume — a security page that only lists strengths is not evidence.
 */

const BOUNDARY: readonly { zone: string; holds: string; tone: "stays" | "leaves" }[] = [
  {
    zone: "Your browser",
    holds:
      "The raw accounting files, all computation over them, and the token map that turns redacted placeholders back into real party names. None of this is transmitted.",
    tone: "stays",
  },
  {
    zone: "Our server",
    holds:
      "Your account, wallet and billing; the ledger mapping; job state; encrypted company memory; and the redacted profiles and aggregates sent for a specific action.",
    tone: "leaves",
  },
  {
    zone: "Anthropic",
    holds:
      "Only what a specific action's server code sends — a redacted structural profile, capped redacted samples, or computed aggregates. Never a file, never a party name, never a free-text prompt chosen by the browser.",
    tone: "leaves",
  },
];

const CONTROLS: readonly { title: string; body: string }[] = [
  {
    title: "Raw files never leave the browser",
    body: "Parsing and querying happen locally. What the server receives is a redacted structural profile — shapes, headers and row counts — and aggregate figures, not the file.",
  },
  {
    title: "Party names are redacted before anything is sent",
    body: "Names are replaced with tokens client-side, and the map from token back to name stays in your browser. It is re-applied locally when the workbook is written, so the readable names exist only on your machine.",
  },
  {
    title: "Company data is encrypted under its own key",
    body: "Each company has its own data encryption key, wrapped by a master key held in a cloud KMS. Deleting a company destroys its key, which makes the stored data unreadable rather than merely flagged as deleted.",
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

const FAQS: readonly Faq[] = [
  {
    question: "Does my client's trial balance get uploaded?",
    answer:
      "No. The file is read in your browser and stays there. The server receives a redacted structural profile and aggregate figures for the action you paid for — not the file, and not the party names.",
  },
  {
    question: "Does Anthropic see my accounting data?",
    answer:
      "Anthropic receives only what a specific action's server code sends: redacted profiles, capped redacted samples, or computed aggregates. There is no endpoint that forwards a prompt chosen by the browser, and the API key is server-side only.",
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
      "Deletion requires re-authentication and typing your email address. The encryption keys are destroyed, which renders the stored data unreadable. Unused credits are forfeited, and deletion is refused while credits are held against running work.",
  },
];

export default function SecurityPage() {
  return (
    <PublicShell>
      <ArticleSchema path={PATH} />
      <BreadcrumbSchema path={PATH} />
      <FaqSchema faqs={FAQS} />

      <MarketingHeader
        path={PATH}
        eyebrow="Security"
        heading="What leaves your machine, and what does not"
        intro="You hold your clients' books. That makes the boundary between your computer, our server and the model vendor the first thing worth checking — so here it is exactly, including where it is weaker than you might assume."
      />

      <WideSection
        title="The three zones"
        intro="The architecture is arranged around this table. Everything else follows from it."
      >
        <div className="mx-auto grid max-w-[1000px] gap-4 md:grid-cols-3">
          {BOUNDARY.map((zone) => (
            <div
              key={zone.zone}
              className={`rounded-xl border p-5 ${
                zone.tone === "stays"
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
          {CONTROLS.map((c) => (
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
          Customer sign-in has one factor. That was a deliberate decision, recorded with
          its cost, and the compensating controls are listed above. If a second factor is
          a requirement for your firm, it is not available today.
        </p>
      </Section>

      <Section title="Questions">
        <Faqs faqs={FAQS} />
      </Section>

      <ReadNext paths={["/how-it-works", "/legal/privacy", "/for-accountants"]} />
      <ClosingCta />
    </PublicShell>
  );
}
