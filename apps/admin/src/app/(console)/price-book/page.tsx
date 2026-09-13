import { ACTION_KEYS } from "@magicmis/wallet";

import { Flash, input, num, td, th, type FlashParams } from "@/components/Flash";
import { Button, Panel } from "@/components/ui";
import { listPriceBook } from "@/server/catalog";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

import { publishPriceAction } from "../actions";

export const metadata = { title: "Price book" };
export const dynamic = "force-dynamic";

const ist = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);

/**
 * Versioned price book (SPEC §12, §26). A change is always a new version with an effective
 * date. TODO(review): R-24 — margin-impact preview against the last 30 days of usage needs
 * `ai_calls` data and lands with the margin dashboard (Phase 4/9).
 */
export default async function PriceBookPage({
  searchParams,
}: {
  searchParams: FlashParams;
}) {
  await requireAdmin();
  const rows = await listPriceBook(db());
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Price book</h1>
      <Flash searchParams={searchParams} />

      <Panel title="Publish a new version">
        <form action={publishPriceAction} className="grid grid-cols-4 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Action
            <select name="actionKey" className={input} required>
              {ACTION_KEYS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Base credits
            <input name="baseCredits" className={input} inputMode="numeric" required />
          </label>
          <label className="flex flex-col gap-1">
            Instant surcharge
            <input
              name="instantSurchargeCredits"
              className={input}
              inputMode="numeric"
              defaultValue="0"
            />
          </label>
          <label className="flex flex-col gap-1">
            Max AI cost ratio
            <input name="maxAiCostRatio" className={input} defaultValue="0.2" required />
          </label>
          <label className="flex flex-col gap-1">
            Efficient ×
            <input name="efficient" className={input} defaultValue="0.8" required />
          </label>
          <label className="flex flex-col gap-1">
            Professional ×
            <input name="professional" className={input} defaultValue="1.0" required />
          </label>
          <label className="flex flex-col gap-1">
            Expert ×
            <input name="expert" className={input} defaultValue="2.5" required />
          </label>
          <label className="flex flex-col gap-1">
            Reservation
            <select name="reservationMode" className={input}>
              <option>fixed</option>
              <option>capped</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Price from action (optional)
            <select name="priceFromActionKey" className={input} defaultValue="">
              <option value="">—</option>
              {ACTION_KEYS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Effective from (IST; blank = now)
            <input name="effectiveFrom" type="datetime-local" className={input} />
          </label>
          <label className="flex items-center gap-2 pt-5">
            <input name="enabled" type="checkbox" defaultChecked /> Enabled
          </label>
          <div className="flex items-end">
            <Button type="submit">Publish version</Button>
          </div>
        </form>
      </Panel>

      <Panel title="Versions">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "Action",
                  "Version",
                  "Status",
                  "Effective",
                  "Base",
                  "E / P / X",
                  "Instant",
                  "Ratio",
                  "Mode",
                  "From",
                  "Enabled",
                ].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.actionKey}:${r.version.toString()}`}
                  className={`border-t border-neutral-100 ${r.status === "superseded" ? "text-neutral-500" : ""}`}
                >
                  <td className={td}>{r.actionKey}</td>
                  <td className={num}>{r.version}</td>
                  <td className={td}>{r.status.replace("_", " ")}</td>
                  <td className={td}>{ist(r.effectiveFrom)}</td>
                  <td className={num}>{r.baseCredits}</td>
                  <td className={num}>
                    {r.multipliers.efficient} / {r.multipliers.professional} /{" "}
                    {r.multipliers.expert}
                  </td>
                  <td className={num}>{r.instantSurchargeCredits}</td>
                  <td className={num}>{r.maxAiCostRatio}</td>
                  <td className={td}>{r.reservationMode}</td>
                  <td className={td}>{r.priceFromActionKey ?? ""}</td>
                  <td className={td}>{r.enabled ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
