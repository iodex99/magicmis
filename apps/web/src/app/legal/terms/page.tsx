import Link from "next/link";

export const metadata = { title: "Terms" };

/**
 * TODO(review): R-10. SPEC §31 — structure only. Each section records how the product behaves so a
 * reviewer can draft the terms; none of it is final legal language. Periods and amounts are set in
 * configuration and shown in the price book, so they are not repeated here.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm leading-6 text-neutral-700">
      <h1 className="mb-2 text-xl font-semibold text-neutral-900">Terms of service</h1>
      <p className="mb-8 rounded-md border border-warning bg-warning-subtle px-3 py-2 text-warning">
        Draft pending professional review. Not final legal text.
      </p>

      <Section title="1. Credits">
        <p>
          Credits are bought in advance. One credit equals one rupee before GST. Credits
          are non-refundable, non-transferable and cannot be exchanged for cash. Each
          purchase is valid for the period shown at purchase, after which unused credits
          expire. There is no free tier or trial, and a balance can never go below zero.
        </p>
      </Section>

      <Section title="2. Prices">
        <p>
          Each action has a fixed credit price, shown before you confirm it, from the{" "}
          <Link href="/pricing" className="underline">
            price book
          </Link>
          . Chat messages and monthly refreshes are charged. Some large jobs need a quote
          you accept first.
        </p>
      </Section>

      <Section title="3. Company memory fee and lifecycle">
        <p>
          Each set-up company is charged a monthly memory fee. If the fee cannot be paid,
          the company enters a grace period, is then archived, and is eventually purged;
          notices are sent before each step. An archived company can be restored for the
          restore price. Purged data cannot be recovered.
        </p>
      </Section>

      <Section title="4. Your data and outputs">
        <p>
          Outputs are prepared from data you provide. You are responsible for the accuracy
          of that data, including GSTIN and other identifiers. Outputs require review by a
          qualified professional before they are relied on.
        </p>
      </Section>

      <Section title="5. Acceptable use">
        <p>{/* TODO(review): R-10 — acceptable use terms. */}To be added.</p>
      </Section>

      <Section title="6. Account">
        <p>
          One login per account; no shared access. You can delete your account at any time
          from{" "}
          <Link href="/settings/privacy" className="underline">
            Privacy and data
          </Link>{" "}
          settings; unused credits are forfeited.
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
