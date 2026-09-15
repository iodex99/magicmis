import { ACCOUNTING_REPORTS } from "@magicmis/billing";

import { input, type FlashParams } from "@/components/Flash";
import { Panel } from "@/components/ui";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Accounting exports" };
export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  credits_sold: "Credits sold (value ex-GST)",
  credits_consumed: "Credits consumed",
  credits_expired: "Credits expired",
  outstanding_credits: "Outstanding unexpired credits (liability)",
  gst_summary: "GST summary",
  invoice_register: "Invoice register",
};

/** SPEC §13 monthly CSVs, months in IST. */
export default async function ExportsPage({
  searchParams,
}: {
  searchParams: FlashParams;
}) {
  await requireAdmin();
  const { month } = await searchParams;
  const now = new Date(Date.now() + 330 * 60_000);
  const selected =
    month !== undefined && /^\d{4}-\d{2}$/u.test(month)
      ? month
      : now.toISOString().slice(0, 7);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight text-neutral-900">
        Accounting exports
      </h1>
      <form className="flex items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          Month
          <input type="month" name="month" defaultValue={selected} className={input} />
        </label>
        <button type="submit" className="h-8 rounded-md border border-neutral-300 px-3">
          Select
        </button>
      </form>
      <Panel title={`Reports for ${selected}`}>
        <ul className="flex flex-col gap-2 text-sm">
          {ACCOUNTING_REPORTS.map((r) => (
            <li key={r}>
              <a
                className="font-medium text-accent-700 hover:underline"
                href={`/exports/${r}?month=${selected}`}
              >
                {LABELS[r] ?? r}
              </a>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
