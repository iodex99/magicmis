import { minorCell } from "@magicmis/billing";

import { Flash, input, num, td, th, type FlashParams } from "@/components/Flash";
import { Button, Panel } from "@/components/ui";
import { listPacks } from "@/server/catalog";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

import { createPackAction, togglePackAction } from "../actions";

export const metadata = { title: "Credit packs" };
export const dynamic = "force-dynamic";

export default async function PacksPage({ searchParams }: { searchParams: FlashParams }) {
  await requireAdmin();
  const packs = await listPacks(db());
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight text-neutral-900">
        Credit packs
      </h1>
      <Flash searchParams={searchParams} />
      <Panel title="New pack">
        <p className="mb-3 text-xs text-neutral-600">
          Packs are never edited. To change one, create its replacement and deactivate the
          old pack; past purchases keep what they bought.
        </p>
        <form
          action={createPackAction}
          className="flex flex-wrap items-end gap-3 text-sm"
        >
          <label className="flex flex-col gap-1">
            Name
            <input name="name" className={input} maxLength={40} required />
          </label>
          <label className="flex flex-col gap-1">
            Price ex-GST (₹)
            <input name="priceRupees" className={input} inputMode="numeric" required />
          </label>
          <label className="flex flex-col gap-1">
            Price ex-tax ($)
            <input
              name="priceDollars"
              className={input}
              inputMode="numeric"
              placeholder="not sold abroad"
            />
          </label>
          <label className="flex flex-col gap-1">
            Credits
            <input name="credits" className={input} inputMode="numeric" required />
          </label>
          <label className="flex flex-col gap-1">
            Bonus credits
            <input
              name="bonusCredits"
              className={input}
              inputMode="numeric"
              defaultValue="0"
            />
          </label>
          <label className="flex flex-col gap-1">
            Sort order
            <input
              name="sortOrder"
              className={input}
              inputMode="numeric"
              defaultValue="0"
            />
          </label>
          <Button type="submit">Create pack</Button>
        </form>
      </Panel>
      <Panel title="Packs">
        <table className="w-full">
          <thead>
            <tr>
              {[
                "Name",
                "Price (₹)",
                "Price ($)",
                "Credits",
                "Bonus",
                "Sort",
                "Active",
                "",
              ].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {packs.map((p) => (
              <tr
                key={p.id}
                className="border-b border-neutral-100 last:border-0 hover:bg-neutral-25"
              >
                <td className={td}>{p.name ?? "—"}</td>
                <td className={num}>
                  {p.price_inr_minor === null ? "—" : minorCell(p.price_inr_minor)}
                </td>
                <td className={num}>
                  {p.price_usd_minor === null ? "—" : minorCell(p.price_usd_minor)}
                </td>
                <td className={num}>{p.credits_granted}</td>
                <td className={num}>{p.bonus_credits}</td>
                <td className={num}>{p.sort_order}</td>
                <td className={td}>{p.active ? "yes" : "no"}</td>
                <td className={td}>
                  <form action={togglePackAction}>
                    <input type="hidden" name="packId" value={p.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={p.active ? "false" : "true"}
                    />
                    <Button type="submit" variant="secondary">
                      {p.active ? "Deactivate" : "Activate"}
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
