"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Button, SelectField } from "@/components/ui";
import { api, newIdempotencyKey } from "@/lib/client-api";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const CURRENCIES: readonly (readonly [string, string])[] = [
  ["INR", "Indian Rupee (₹)"],
  ["USD", "US Dollar ($)"],
  ["GBP", "Pound Sterling (£)"],
  ["EUR", "Euro (€)"],
  ["AED", "UAE Dirham"],
  ["SGD", "Singapore Dollar"],
  ["AUD", "Australian Dollar"],
  ["CAD", "Canadian Dollar"],
  ["NZD", "New Zealand Dollar"],
  ["ZAR", "South African Rand"],
  ["HKD", "Hong Kong Dollar"],
  ["MYR", "Malaysian Ringgit"],
  ["LKR", "Sri Lankan Rupee"],
  ["BDT", "Bangladeshi Taka"],
  ["NPR", "Nepalese Rupee"],
  ["PKR", "Pakistani Rupee"],
];

export interface Conventions {
  fyStartMonth: number;
  currency: string;
  numberFormat: "lakhs_crores" | "absolute" | "millions";
  dateOrder: "day_first" | "month_first";
}

/**
 * How this company's own books are kept (ADR 0030), changeable after the fact (ADR 0035).
 *
 * The financial year is the one that bites: exports that run April–March loaded into a company
 * set to January read every year's first month as the whole year. A run says so when it sees it,
 * and this is where it gets fixed. Changing nothing here costs nothing and reads no data.
 */
export function ReportingConventions({
  companyId,
  current,
}: {
  companyId: string;
  current: Conventions;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Conventions>(current);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "error"; text: string } | null>(
    null,
  );

  const changed =
    form.fyStartMonth !== current.fyStartMonth ||
    form.currency !== current.currency ||
    form.numberFormat !== current.numberFormat ||
    form.dateOrder !== current.dateOrder;

  const save = async () => {
    setBusy(true);
    setNote(null);
    const r = await api(`/api/companies/${companyId}`, {
      method: "PATCH",
      body: form,
      idempotencyKey: newIdempotencyKey(),
    });
    setBusy(false);
    if (!r.ok) {
      setNote({ tone: "error", text: r.message });
      return;
    }
    setNote({
      tone: "success",
      text: "Saved. It applies to the next run; months already delivered are unchanged.",
    });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4" data-testid="reporting-conventions">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          id="conventions-fy"
          label="Financial year starts in"
          value={form.fyStartMonth.toString()}
          hint="Match the accounting system the exports come from."
          onChange={(e) => {
            setForm((f) => ({ ...f, fyStartMonth: Number.parseInt(e.target.value, 10) }));
          }}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={(i + 1).toString()}>
              {m}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="conventions-currency"
          label="Books are in"
          value={form.currency}
          onChange={(e) => {
            setForm((f) => ({ ...f, currency: e.target.value }));
          }}
        >
          {CURRENCIES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="conventions-number-format"
          label="Numbers shown as"
          value={form.numberFormat}
          onChange={(e) => {
            setForm((f) => ({
              ...f,
              numberFormat: e.target.value as Conventions["numberFormat"],
            }));
          }}
        >
          <option value="lakhs_crores">Lakhs and crores (12,34,567)</option>
          <option value="absolute">Full figures (1,234,567)</option>
          <option value="millions">Millions (1.23)</option>
        </SelectField>
        <SelectField
          id="conventions-date-order"
          label="Dates in exports are written"
          value={form.dateOrder}
          onChange={(e) => {
            setForm((f) => ({
              ...f,
              dateOrder: e.target.value as Conventions["dateOrder"],
            }));
          }}
        >
          <option value="day_first">Day first — 03/04 is 3 April</option>
          <option value="month_first">Month first — 03/04 is 4 March</option>
        </SelectField>
      </div>
      {note === null ? null : <Alert tone={note.tone}>{note.text}</Alert>}
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={busy || !changed}>
          {busy ? "Saving…" : "Save conventions"}
        </Button>
        <span className="text-[0.75rem] text-neutral-500">
          Applies to the next run. Nothing already delivered changes.
        </span>
      </div>
    </div>
  );
}
