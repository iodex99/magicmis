import { rupeeCell } from "@magicmis/billing";
import Link from "next/link";

import { Flash, input, num, td, th, type FlashParams } from "@/components/Flash";
import { Button, Panel } from "@/components/ui";
import { pendingBankTransfers } from "@/server/accounts";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

import { markReceivedAction } from "../actions";

export const metadata = { title: "Bank transfers" };
export const dynamic = "force-dynamic";

/** SPEC §13: confirm receipt against the bank statement, then record the UTR. */
export default async function BankTransfersPage({
  searchParams,
}: {
  searchParams: FlashParams;
}) {
  await requireAdmin();
  const pending = await pendingBankTransfers(db());
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight text-neutral-900">
        Bank transfers
      </h1>
      <Flash searchParams={searchParams} />
      <Panel>
        {pending.length === 0 ? (
          <p className="text-sm text-neutral-700">No transfers awaiting receipt.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "Proforma",
                  "Account",
                  "Total (₹)",
                  "Credits + bonus",
                  "Requested",
                  "Mark received",
                ].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-neutral-100 last:border-0 hover:bg-neutral-25"
                >
                  <td className={`${td} font-mono`}>{p.proforma_number ?? "—"}</td>
                  <td className={td}>
                    <Link
                      href={`/accounts/${p.account_id}`}
                      className="font-medium text-accent-700 hover:underline"
                    >
                      {p.business_name}
                    </Link>
                  </td>
                  <td className={num}>{rupeeCell(p.total_paise)}</td>
                  <td className={num}>
                    {p.credits} + {p.bonus_credits}
                  </td>
                  <td className={td}>
                    {p.bank_transfer_requested_at?.toISOString().slice(0, 10) ?? ""}
                  </td>
                  <td className={td}>
                    <form action={markReceivedAction} className="flex gap-2">
                      <input type="hidden" name="purchaseId" value={p.id} />
                      <input
                        name="utr"
                        placeholder="UTR"
                        className={`${input} w-48 font-mono`}
                        required
                        pattern="[A-Za-z0-9]{12,22}"
                      />
                      <Button type="submit">Confirm receipt</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
