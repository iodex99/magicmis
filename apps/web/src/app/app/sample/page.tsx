import { currencySymbol, defaultConventions } from "@magicmis/core/reporting-conventions";

import { AppFrame } from "@/components/AppFrame";
import { Icon } from "@/components/Icon";
import { ButtonLink, PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";
import { sampleCompany } from "@/lib/sample-company";
import { visitorCountry } from "@/lib/server/visitor-currency";

import { SampleWorkspace } from "./SampleWorkspace";

export const metadata = { title: "Sample company" };
export const dynamic = "force-dynamic";

/**
 * A finished company to look at before adding one's own (ADR 0086).
 *
 * A new account otherwise meets an empty form and has to trust that a board, a commentary and
 * where to act are worth the files and the credits. This is all three, for an invented business,
 * exactly as the product draws them — recorded once, so reading it costs nothing and calls
 * nothing. It says on its face that it is invented, and every way off it leads to adding a
 * company.
 */
export default async function SamplePage() {
  const account = await accountOrRedirect("/app/sample");
  // In the reader's own money, as a company they add would start (ADR 0087).
  const billing = await db()
    .query<{ billing_country: string | null }>(
      `select billing_country from public.accounts where id = $1`,
      [account.accountId],
    )
    .then((r) => r.rows[0]?.billing_country ?? null);
  const conventions = defaultConventions(billing, await visitorCountry());
  const sample = sampleCompany({
    currencySymbol: currencySymbol(conventions.currency),
    style: conventions.numberFormat,
  });
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName} wide>
      <PageHeader
        eyebrow="Sample company"
        title={sample.name}
        description={`${sample.trade}, thirteen months of books. Invented, so you can see the whole of it before adding your own.`}
        back={{ href: "/app", label: "Companies" }}
        actions={
          <ButtonLink href="/app" icon="plus">
            Add your own company
          </ButtonLink>
        }
      />
      <p
        className="mb-5 flex items-start gap-2.5 rounded-xl border border-accent-100 bg-accent-50/60 px-4 py-3 text-[0.8125rem] leading-relaxed text-neutral-700"
        data-testid="sample-note"
      >
        <Icon name="info" size={16} className="mt-0.5 shrink-0 text-accent-600" />
        <span>
          <strong className="font-semibold text-neutral-900">
            This company and its books are invented.
          </strong>{" "}
          The board, the commentary and where to act are what the product made from them:
          every figure computed from the books, and each one opens the ledgers behind it.
          Read the board over a longer range, compare it with last year, or present it
          full screen. Nothing here is charged.
        </span>
      </p>
      <SampleWorkspace sample={sample} />
    </AppFrame>
  );
}
