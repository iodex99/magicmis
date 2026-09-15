import { priceImpactPreview, type PriceImpact } from "@magicmis/ai/margin";
import { ACTION_KEYS } from "@magicmis/wallet";

import { Flash, input, num, td, th } from "@/components/Flash";
import { Button, Panel } from "@/components/ui";
import { listPriceBook, priceBookVersionSchema } from "@/server/catalog";
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

interface Query {
  ok?: string;
  error?: string;
  preview?: string;
  actionKey?: string;
  baseCredits?: string;
  instantSurchargeCredits?: string;
  maxAiCostRatio?: string;
  efficient?: string;
  professional?: string;
  expert?: string;
  reservationMode?: string;
  priceFromActionKey?: string;
}

/**
 * Versioned price book (SPEC §12, §26). A change is always a new version with an effective
 * date. "Preview impact" reprices the last 30 days of captured usage under the entered values
 * before anything is published.
 */
export default async function PriceBookPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  await requireAdmin();
  const q = await searchParams;
  const rows = await listPriceBook(db());
  const preview = await impactFor(q);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight text-neutral-900">
        Price book
      </h1>
      <Flash searchParams={searchParams} />

      <Panel title="Publish a new version">
        <form action={publishPriceAction} className="grid grid-cols-4 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Action
            <select
              name="actionKey"
              className={input}
              defaultValue={q.actionKey}
              required
            >
              {ACTION_KEYS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Base credits
            <input
              name="baseCredits"
              className={input}
              inputMode="numeric"
              defaultValue={q.baseCredits}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            Instant surcharge
            <input
              name="instantSurchargeCredits"
              className={input}
              inputMode="numeric"
              defaultValue={q.instantSurchargeCredits ?? "0"}
            />
          </label>
          <label className="flex flex-col gap-1">
            Max AI cost ratio
            <input
              name="maxAiCostRatio"
              className={input}
              defaultValue={q.maxAiCostRatio ?? "0.2"}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            Efficient ×
            <input
              name="efficient"
              className={input}
              defaultValue={q.efficient ?? "0.8"}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            Professional ×
            <input
              name="professional"
              className={input}
              defaultValue={q.professional ?? "1.0"}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            Expert ×
            <input
              name="expert"
              className={input}
              defaultValue={q.expert ?? "2.5"}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            Reservation
            <select
              name="reservationMode"
              className={input}
              defaultValue={q.reservationMode ?? "fixed"}
            >
              <option>fixed</option>
              <option>capped</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Price from action (optional)
            <select
              name="priceFromActionKey"
              className={input}
              defaultValue={q.priceFromActionKey ?? ""}
            >
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
          <div className="flex items-end gap-2">
            <Button
              type="submit"
              variant="secondary"
              formAction="/price-book"
              formMethod="get"
              name="preview"
              value="1"
            >
              Preview impact
            </Button>
            <Button type="submit">Publish version</Button>
          </div>
        </form>
      </Panel>

      {preview === null ? null : <ImpactPanel impact={preview} />}

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

async function impactFor(q: Query): Promise<PriceImpact | { error: string } | null> {
  if (q.preview !== "1") return null;
  const parsed = priceBookVersionSchema.safeParse({
    actionKey: q.actionKey,
    baseCredits: q.baseCredits,
    efficient: q.efficient,
    professional: q.professional,
    expert: q.expert,
    instantSurchargeCredits: q.instantSurchargeCredits ?? "0",
    maxAiCostRatio: q.maxAiCostRatio,
    reservationMode: q.reservationMode ?? "fixed",
    priceFromActionKey:
      q.priceFromActionKey === undefined || q.priceFromActionKey === ""
        ? null
        : q.priceFromActionKey,
    enabled: true,
    effectiveFrom: new Date(),
  });
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Check the entered values." };
  const v = parsed.data;
  return priceImpactPreview(db(), {
    actionKey: v.actionKey,
    baseCredits: v.baseCredits,
    multipliers: {
      efficient: v.efficient,
      professional: v.professional,
      expert: v.expert,
    },
    instantSurchargeCredits: v.instantSurchargeCredits,
    maxAiCostRatio: v.maxAiCostRatio,
    priceFromActionKey: v.priceFromActionKey,
  });
}

const rupees = (paise: bigint) => `₹${(paise / 100n).toLocaleString("en-IN")}`;

function ImpactPanel({ impact }: { impact: PriceImpact | { error: string } }) {
  if ("error" in impact)
    return (
      <Panel title="Margin impact preview">
        <p className="text-sm text-negative">{impact.error}</p>
      </Panel>
    );
  const rows: [string, string][] = [
    ["Captured items repriced", impact.items.toString()],
    ["Quoted items (unchanged)", impact.quotedItems.toString()],
    ["AI cost", rupees(impact.aiCostPaise)],
    ["Credits captured — current", impact.currentCredits.toLocaleString("en-IN")],
    ["Credits captured — proposed", impact.proposedCredits.toLocaleString("en-IN")],
    ["AI cost ratio — current", impact.currentRatio ?? "—"],
    ["AI cost ratio — proposed", impact.proposedRatio ?? "—"],
    ["Proposed max ratio", impact.proposedMaxRatio],
    ["Items over the proposed cap", impact.itemsOverProposedCap.toString()],
  ];
  return (
    <Panel
      title={`Margin impact preview — ${impact.actionKey}, last ${impact.days.toString()} days`}
    >
      <div data-testid="price-impact" className="flex flex-col gap-3">
        {impact.flagged ? (
          <p
            className="text-sm font-medium text-negative"
            data-testid="price-impact-flag"
          >
            The proposed price puts this action over its max AI cost ratio on recent
            usage.
          </p>
        ) : null}
        <table className="w-full max-w-xl">
          <tbody>
            {rows.map(([label, value]) => (
              <tr
                key={label}
                className="border-b border-neutral-100 last:border-0 hover:bg-neutral-25"
              >
                <td className={td}>{label}</td>
                <td className={num}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
