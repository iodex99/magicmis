import Link from "next/link";

import { Flash, input, num, td, th, type FlashParams } from "@/components/Flash";
import { Button, Panel } from "@/components/ui";
import { searchAccounts } from "@/server/accounts";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: FlashParams;
}) {
  await requireAdmin();
  const { q = "" } = await searchParams;
  const accounts = await searchAccounts(db(), q);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Accounts</h1>
      <Flash searchParams={searchParams} />
      <form className="flex gap-2" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Email, business name or account id"
          className={`${input} w-96`}
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <Panel>
        <table className="w-full">
          <thead>
            <tr>
              {["Business", "Email", "Status", "Balance", "Created"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-t border-neutral-100">
                <td className={td}>
                  <Link href={`/accounts/${a.id}`} className="text-accent-700 underline">
                    {a.business_name}
                  </Link>
                </td>
                <td className={td}>{a.email}</td>
                <td className={td}>{a.status}</td>
                <td className={num}>{a.balance ?? "0"}</td>
                <td className={td}>{a.created_at.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
