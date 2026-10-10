import type { NumberFormatOptions } from "@magicmis/core/format";
import { currencySymbol } from "@magicmis/core/reporting-conventions";
import { formatValue, periodLabel } from "@magicmis/render-dashboard";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppFrame } from "@/components/AppFrame";
import { EmptyState, PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";
import { headChoices, ledgerMap, UNMAPPED } from "@/lib/server/ledger-map";
import { keyWrapper } from "@/lib/server/runtime";

import { LedgerMapClient } from "./LedgerMapClient";

export const metadata = { title: "Ledger map" };
export const dynamic = "force-dynamic";

/** Every ledger of a company and the MIS line it feeds, correctable in place (ADR 0086). */
export default async function LedgerMapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await accountOrRedirect(`/app/companies/${id}/ledgers`);
  if (!z.uuid().safeParse(id).success) notFound();
  const r = await db().query<{
    name: string;
    currency: string;
    number_format: NumberFormatOptions["style"];
    decimals: number;
  }>(
    `select name, currency, number_format, decimals from companies
      where id = $1 and account_id = $2 and deleted_at is null`,
    [id, account.accountId],
  );
  const company = r.rows[0];
  if (company === undefined) notFound();

  const map = await ledgerMap(db(), keyWrapper(), {
    accountId: account.accountId,
    companyId: id,
  });
  const money: NumberFormatOptions = {
    style: company.number_format,
    decimals: company.decimals,
    negativesInBrackets: false,
  };
  const symbol = currencySymbol(company.currency);
  // Debit positive in the books: shown as an accountant reads a trial balance, Dr or Cr.
  const balance = (closing: string | null): string | null => {
    if (closing === null) return null;
    const negative = closing.startsWith("-");
    const amount = formatValue(
      negative ? closing.slice(1) : closing,
      "paise",
      money,
      symbol,
    );
    return `${amount} ${negative ? "Cr" : "Dr"}`;
  };

  return (
    <AppFrame
      accountId={account.accountId}
      businessName={account.businessName}
      company={{ id, name: company.name }}
    >
      <PageHeader
        title="Ledger map"
        description="Every ledger in this company's books and the MIS line it feeds. Move one and it stays moved: the change reaches the figures the next time you add a file for this company."
        back={{ href: `/app/companies/${id}/manage`, label: "Files and settings" }}
      />
      {map === null || map.rows.length === 0 ? (
        <EmptyState icon="document" title="Nothing mapped yet">
          The map appears once a file has been processed.
        </EmptyState>
      ) : (
        <LedgerMapClient
          // A newer version of the map, from a reload after a refusal, starts the table afresh
          // rather than keeping the copy that was refused (ADR 0091).
          key={map.version}
          companyId={id}
          version={map.version}
          asAt={map.period === null ? null : periodLabel(map.period)}
          heads={headChoices()}
          unmapped={UNMAPPED}
          live={map.live}
          rows={map.rows.map((row) => ({
            key: row.key,
            group: row.group,
            name: row.name,
            tokenised: row.tokenised,
            head: row.head,
            keptOff: row.keptOff,
            balance: balance(row.closing),
          }))}
        />
      )}
    </AppFrame>
  );
}
