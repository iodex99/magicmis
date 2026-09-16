import type { Metadata } from "next";

import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

export const metadata: Metadata = pageMetadata("/legal/privacy");

/**
 * TODO(review): R-11. SPEC §31 — structure only. Every section below states the facts of how the
 * product works so a reviewer can draft the legal wording; none of it is final legal language.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm leading-6 text-neutral-700">
      <h1 className="mb-2 text-xl font-semibold text-neutral-900">Privacy notice</h1>
      <p className="mb-8 rounded-md border border-warning bg-warning-subtle px-3 py-2 text-warning">
        Draft pending professional review. Not final legal text.
      </p>

      <Section title="1. What is processed in your browser">
        <p>
          Source files you choose (trial balances, registers, payroll and similar exports)
          are opened and analysed inside your browser. They are held in browser memory and
          temporary browser storage only, and cleared when you sign out, choose Clear
          session data, start a new session, or close the tab where the browser allows.
        </p>
      </Section>

      <Section title="2. What leaves your browser">
        <p>
          Before anything is sent, identifiers such as party and employee names, PAN,
          Aadhaar, GSTIN, bank account numbers, IFSC codes, email addresses and mobile
          numbers are replaced in your browser with tokens. The key that links tokens to
          names never leaves your browser. What is sent, only for a paid action you start:
          structural profiles of your files, a small capped sample of redacted rows,
          computed totals, and — for chat — query results within fixed size limits.
        </p>
      </Section>

      <Section title="3. Subprocessors">
        <p>
          AI requests are processed by Anthropic as our subprocessor, and receive only
          what our server sends for that specific action. Other subprocessors: database
          and storage hosting, email delivery, and the payment gateway.{" "}
          {/* TODO(review): R-11 — list names, regions and links. */}
        </p>
      </Section>

      <Section title="4. What we store and for how long">
        <ul className="list-disc space-y-1 pl-5">
          <li>Account, security and consent records — while the account exists.</li>
          <li>
            Company memory (template, mappings, dashboard) and monthly snapshots —
            encrypted, until you delete the company or your account, or the company is
            purged for unpaid memory fees.
          </li>
          <li>Generated workbooks — encrypted, for the configured retention period.</li>
          <li>
            Invoices and credit records — for the statutory retention period, with
            personal details removed after account deletion.
          </li>
        </ul>
        <p className="mt-2">
          Deleted data is destroyed by destroying its encryption key.
        </p>
      </Section>

      <Section title="5. Your rights">
        <p>
          Access and export your data, correct your profile, and erase your account or any
          company, from{" "}
          <Link href="/settings/privacy" className="underline">
            Privacy and data
          </Link>{" "}
          settings.{" "}
          {/* TODO(review): R-11 — DPDP Act rights wording, consent withdrawal, nomination. */}
        </p>
      </Section>

      <Section title="6. Grievance contact">
        <p>
          {/* TODO(review): R-11 — grievance officer name, email and response timeline. */}
          To be added.
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-semibold text-neutral-900">{title}</h2>
      {children}
    </section>
  );
}
