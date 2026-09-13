import { Panel } from "@/components/ui";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

/** Phase 2 overview. The full margin dashboard (SPEC §26) arrives with the AI layer. */
export default async function OverviewPage() {
  await requireAdmin();
  const r = await db().query<{
    accounts: string;
    pending_transfers: string;
    outstanding: string;
    held: string;
  }>(
    `select (select count(*) from public.accounts where deleted_at is null)::text as accounts,
            (select count(*) from public.purchases where method = 'bank_transfer' and status = 'pending')::text as pending_transfers,
            (select coalesce(sum(balance_credits), 0) from public.wallets)::text as outstanding,
            (select coalesce(sum(held_credits), 0) from public.wallets)::text as held`,
  );
  const s = r.rows[0];
  const cards: [string, string][] = [
    ["Accounts", s?.accounts ?? "0"],
    ["Bank transfers awaiting receipt", s?.pending_transfers ?? "0"],
    ["Outstanding credits (liability)", s?.outstanding ?? "0"],
    ["Credits held by running actions", s?.held ?? "0"],
  ];
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Overview</h1>
      <div className="grid grid-cols-4 gap-4">
        {cards.map(([label, value]) => (
          <Panel key={label}>
            <p className="text-xs text-neutral-600">{label}</p>
            <p className="font-mono text-2xl tabular-nums text-neutral-900">{value}</p>
          </Panel>
        ))}
      </div>
    </>
  );
}
