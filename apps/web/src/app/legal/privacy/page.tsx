import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument, Pending, type LegalSection } from "@/components/LegalDocument";
import { PRODUCT_NAME } from "@/lib/brand";
import { legalFacts } from "@/lib/server/legal";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/legal/privacy");

/**
 * Privacy notice (R-11).
 *
 * Written from the processing register (docs/compliance/processing-register.md) and the
 * code it points to, not from a template: what is collected, what happens to uploaded files,
 * who receives what, and for how long. Periods come from configuration through
 * `legalFacts`, so they cannot drift from the product.
 *
 * It addresses readers under India's Digital Personal Data Protection Act and, because the
 * service is sold outside India, readers in the UK and the European Economic Area.
 *
 * TODO(review): R-11, R-50 — legal and data-protection review before launch; the grievance
 * officer, contact addresses and the background-job hosting provider are placeholders in
 * `legal.contacts` and below.
 */
export default async function PrivacyPage() {
  const f = await legalFacts();
  const we = f.sellerName ?? PRODUCT_NAME;
  const email = (address: string | null, fallback: string) =>
    address === null ? (
      <Pending>{fallback}</Pending>
    ) : (
      <a href={`mailto:${address}`} className="text-accent-700 underline">
        {address}
      </a>
    );
  const privacyContact = email(
    f.privacyEmail,
    "the privacy address published on this site",
  );

  // A null region depends on how our account with that provider is set up and has not been
  // confirmed (R-50); it is shown as such rather than guessed.
  const subprocessors: readonly [string, string, string | null][] = [
    [
      "Supabase",
      "Database and sign-in: your account, company memory and records",
      "India (Mumbai)",
    ],
    [
      "Amazon Web Services (KMS)",
      "Protects the encryption keys; holds no personal data",
      "India (Mumbai)",
    ],
    [
      "Anthropic",
      "AI processing of redacted profiles, samples, totals and chat messages",
      "United States",
    ],
    [
      "Vercel",
      "Hosts the website and application servers",
      "Global network, servers nearest India",
    ],
    ["Razorpay", "Payments: card and bank details you enter at checkout", "India"],
    ["Resend", "Sends account, security and billing emails", null],
    ["Sentry", "Error monitoring, with personal data removed before sending", null],
  ];

  const sections: LegalSection[] = [
    {
      id: "who",
      title: "Who we are",
      body: (
        <>
          <p>
            {PRODUCT_NAME} is provided by {we}
            {f.sellerAddress.length > 0 ? `, ${f.sellerAddress.join(", ")}` : ""}. For
            information about you as our customer, we decide how and why it is used.
          </p>
          <p>
            For personal data inside the files you load — the names of your clients&rsquo;
            customers, suppliers or employees, for example — <strong>you</strong> decide
            how and why it is used, and we process it on your behalf under section 7 of
            our{" "}
            <Link href="/legal/terms#processing" className="text-accent-700 underline">
              terms
            </Link>
            . Your own privacy notice to those people covers that processing.
          </p>
          <p>Contact us about privacy at {privacyContact}.</p>
        </>
      ),
    },
    {
      id: "collect",
      title: "Information we collect about you",
      body: (
        <ul>
          <li>
            <strong>Account:</strong> email address, business name, and — when you first
            buy credits — billing address, country and, if you have one, GST registration.
          </li>
          <li>
            <strong>Security:</strong> sign-in times, IP address, browser and device type,
            and a one-way fingerprint of the device, used to show you your sign-in history
            and to warn you about sign-ins from new devices.
          </li>
          <li>
            <strong>Payments:</strong> what you bought, the amount, and the payment
            reference. Card and bank details are entered with our payment provider and are
            never received by us.
          </li>
          <li>
            <strong>Use of the service:</strong> the actions you run, their price, and
            your credit balance and history.
          </li>
          <li>
            <strong>Consents:</strong> which version of each document you accepted, when,
            and from which IP address.
          </li>
        </ul>
      ),
    },
    {
      id: "files",
      title: "The files you upload",
      body: (
        <>
          <p>
            Files you upload are sent to our servers over an encrypted connection and
            encrypted as they arrive, under a key that belongs to that company alone. We
            read them to prepare the reports you pay for and to answer your questions
            about them, and for nothing else.
          </p>
          <p>
            Uploaded files are deleted automatically {f.uploadRetentionDays} days after
            upload. You can see every file we keep, and delete any of them sooner, on the
            Uploaded files page. Deleting a company or your account deletes its files.
          </p>
          <p>
            Before any part of a file is sent to our AI provider, names and identifiers —
            such as party and employee names, tax and registration numbers, bank details,
            email addresses and phone numbers — are replaced with tokens. What is sent is
            limited to a sheet&rsquo;s structure, a small sample of redacted rows, the
            names of ledgers, and — for chat — your question and the results of queries
            over your figures, within fixed size limits.
          </p>
          <p>
            We keep each company&rsquo;s memory — its mapping, templates, dashboard,
            monthly computed figures and generated workbooks — encrypted under a key that
            belongs to that company alone.
          </p>
        </>
      ),
    },
    {
      id: "use",
      title: "How we use information, and why",
      body: (
        <ul>
          <li>
            <strong>To provide the service you signed up for</strong> — running actions,
            keeping company memory, taking payment and sending the emails the service
            needs. This is necessary to perform our contract with you.
          </li>
          <li>
            <strong>To meet legal obligations</strong> — issuing tax invoices and keeping
            accounting records.
          </li>
          <li>
            <strong>To keep the service and your account secure</strong> — detecting
            new-device sign-ins, preventing fraud and abuse, and fixing errors. This is in
            our legitimate interest and yours.
          </li>
          <li>
            <strong>With your consent</strong> — before your first upload you are shown
            how your files will be processed and asked to agree. You can withdraw consent
            by deleting the company or your account.
          </li>
        </ul>
      ),
    },
    {
      id: "ai",
      title: "Artificial intelligence",
      body: (
        <>
          <p>
            AI requests are processed by Anthropic, acting as our subprocessor. It
            receives only the redacted content our server sends for the specific action
            you confirmed — never a whole file, and never the key that restores names.
          </p>
          <p>
            Anthropic does not use content sent through its commercial API to train its
            models by default. We do not use your data to train AI models either.
          </p>
          <p>
            Figures in your reports are calculated by our own calculation engine, not
            written by AI.
          </p>
        </>
      ),
    },
    {
      id: "subprocessors",
      title: "Who we share information with",
      body: (
        <>
          <p>
            We do not sell personal data, and we do not use advertising or analytics
            trackers. We share information only with these service providers, and only to
            run the service:
          </p>
          <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-white">
            <table className="w-full min-w-[520px] border-collapse text-[0.875rem]">
              <thead>
                <tr className="border-b border-neutral-200/80 text-left text-[0.8125rem] text-neutral-500">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Provider
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    What they do
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Where
                  </th>
                </tr>
              </thead>
              <tbody>
                {subprocessors.map(([name, what, where]) => (
                  <tr key={name} className="border-b border-neutral-100 last:border-0">
                    <th
                      scope="row"
                      className="px-4 py-2.5 text-left align-top font-medium text-neutral-900"
                    >
                      {name}
                    </th>
                    <td className="px-4 py-2.5 align-top">{what}</td>
                    <td className="px-4 py-2.5 align-top">
                      {where ?? <Pending>To be confirmed</Pending>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th
                    scope="row"
                    className="px-4 py-2.5 text-left align-top font-medium text-neutral-900"
                  >
                    <Pending>Background job hosting</Pending>
                  </th>
                  <td className="px-4 py-2.5 align-top">
                    Runs scheduled work such as data exports and monthly fees
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <Pending>To be confirmed</Pending>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            We may also disclose information where the law requires it, or to protect the
            rights and safety of our customers and ourselves.
          </p>
        </>
      ),
    },
    {
      id: "transfers",
      title: "International transfers",
      body: (
        <p>
          Your account and company data are stored in India. Some of the providers above
          process data in other countries, including the United States. Where the law of
          your country requires it — for example in the UK or the European Economic Area —
          we rely on appropriate safeguards for those transfers, such as standard
          contractual clauses.
        </p>
      ),
    },
    {
      id: "retention",
      title: "How long we keep information",
      body: (
        <ul>
          <li>
            <strong>Account, security and consent records:</strong> for as long as your
            account exists. When you delete your account, sign-in history is deleted and
            your email and business name are removed.
          </li>
          <li>
            <strong>Company memory:</strong> when you delete a company or your account, it
            is destroyed {f.deletionPurgeDelayDays} days later by destroying the
            company&rsquo;s encryption key. A company closed for an unpaid memory fee is
            destroyed the same way at the end of its archive period (section 5 of the
            terms).
          </li>
          <li>
            <strong>Uploaded files:</strong> {f.uploadRetentionDays} days after upload, or
            sooner when you delete them.
          </li>
          <li>
            <strong>Generated workbooks:</strong> {f.outputRetentionDays} days after they
            are created.
          </li>
          <li>
            <strong>Data export files:</strong> the download link works for{" "}
            {f.exportLinkHours} hours, after which the file is removed.
          </li>
          <li>
            <strong>Invoices and credit records:</strong> for as long as tax and company
            law requires — in India, at least eight financial years — with your personal
            details removed after your account is deleted.
          </li>
        </ul>
      ),
    },
    {
      id: "security",
      title: "How we protect information",
      body: (
        <>
          <p>
            Company data is encrypted under a key unique to each company, and those keys
            are themselves protected by a managed key service; uploaded files are stored
            only in that encrypted form. Names and identifiers are redacted before
            anything is sent to our AI provider. Access to each account&rsquo;s data is
            enforced in the database as well as in the application, and changes to credits
            and to sensitive settings are written to a tamper-evident log.
          </p>
          <p>
            Sign-in is by password alone, with one active session per account, limits on
            failed attempts, and a fresh password check before sensitive actions such as
            exporting data or deleting an account. Please use a password you do not use
            anywhere else.
          </p>
        </>
      ),
    },
    {
      id: "rights",
      title: "Your rights",
      body: (
        <>
          <p>You can, at any time:</p>
          <ul>
            <li>
              <strong>access and export</strong> your data, from{" "}
              <Link href="/settings/privacy" className="text-accent-700 underline">
                Privacy and data
              </Link>{" "}
              settings;
            </li>
            <li>
              <strong>correct</strong> your details, from{" "}
              <Link href="/settings/profile" className="text-accent-700 underline">
                Business profile
              </Link>
              ;
            </li>
            <li>
              <strong>delete</strong> a company, or your whole account; and
            </li>
            <li>
              <strong>withdraw consent</strong>, by deleting the company or account
              concerned.
            </li>
          </ul>
          <p>
            <strong>In India</strong>, under the Digital Personal Data Protection Act, you
            may also nominate someone to exercise your rights if you die or become
            incapacitated, and raise a grievance with our grievance officer (see below).
            If you are not satisfied with the response, you may complain to the Data
            Protection Board of India.
          </p>
          <p>
            <strong>In the UK and the European Economic Area</strong>, you also have the
            right to restrict or object to processing, and to receive your data in a
            portable format. You may complain to your local data protection authority.
          </p>
          <p>
            For anything you cannot do yourself in the service, write to {privacyContact}.
            We will respond within the time the law requires.
          </p>
        </>
      ),
    },
    {
      id: "children",
      title: "Children",
      body: (
        <p>
          The service is for businesses and is not intended for anyone under 18. We do not
          knowingly collect information about children.
        </p>
      ),
    },
    {
      id: "grievance",
      title: "Grievance officer and changes to this notice",
      body: (
        <>
          <p>
            Grievance officer:{" "}
            {f.grievanceOfficerName ?? <Pending>name to be published</Pending>},{" "}
            {email(f.grievanceOfficerEmail, "contact address to be published")}.
          </p>
          <p>
            We may update this notice. For a material change we will tell you by email or
            in the service before it takes effect, and where the change affects how your
            files are processed, we will ask for your agreement again before your next
            upload.
          </p>
        </>
      ),
    },
  ];

  return (
    <LegalDocument
      title="Privacy notice"
      version={f.versions.privacy}
      lastUpdated={f.lastUpdated}
      intro={
        <p>
          The short version: the files you upload are encrypted under a key for that
          company alone and deleted on a schedule, identifiers are replaced before
          anything reaches our AI provider, and every figure is calculated by our own
          engine. The detail follows.
        </p>
      }
      sections={sections}
    />
  );
}
