"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ReportingConventions } from "@magicmis/core/reporting-conventions";

import { Alert, Button, Field, SelectField } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";

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

/**
 * Reporting currencies offered in the select.
 *
 * A short list, not all 180: these cover where this product is actually sold, and an
 * unlisted one is a real request rather than a gap to pad with options nobody picks. All
 * are two-decimal — the engine carries amounts as integer minor units at two decimals, so
 * JPY and the Gulf three-decimal currencies would be read a hundredfold out and are
 * refused rather than offered (R-61).
 */
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

/**
 * Adding a company.
 *
 * The four reporting conventions are pre-filled from where the account is billed and
 * tucked behind a disclosure, so the common case is still "type a name and press add".
 * They are settled once and reused every month afterwards — which is the point: a setting
 * asked every month is a question, and a setting asked once is a convention.
 */
export function NewCompanyForm({ defaults }: { defaults: ReportingConventions }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showConventions, setShowConventions] = useState(false);

  const monthName = MONTHS[defaults.fyStartMonth - 1] ?? "April";
  const summary = `${defaults.currency} · year starts ${monthName} · ${
    defaults.dateOrder === "day_first" ? "day-first dates" : "month-first dates"
  }`;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        void api<{ companyId: string }>("/api/companies", {
          body: {
            name: formText(form, "name"),
            fyStartMonth: Number.parseInt(formText(form, "fyStartMonth"), 10),
            currency: formText(form, "currency"),
            numberFormat: formText(form, "numberFormat"),
            dateOrder: formText(form, "dateOrder"),
          },
          idempotencyKey: newIdempotencyKey(),
        }).then((r) => {
          setBusy(false);
          if (!r.ok) {
            setError(r.message);
            setFields(r.fields);
            return;
          }
          router.push(`/app/companies/${r.data.companyId}/run`);
        });
      }}
    >
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      <Field
        id="company-name"
        name="name"
        label="Company name"
        placeholder="Northwind Traders Pvt Ltd"
        required
        minLength={2}
        maxLength={120}
        error={fields["name"]}
      />

      {/*
        Hidden rather than absent while collapsed: the form still submits all four, so the
        defaults are what gets stored whether or not anyone opens this.
      */}
      <div className="rounded-lg border border-neutral-200/80 bg-neutral-25 p-3">
        <button
          type="button"
          onClick={() => {
            setShowConventions((v) => !v);
          }}
          className="flex w-full items-center justify-between text-left text-[0.8125rem]"
          aria-expanded={showConventions}
        >
          <span>
            <span className="font-medium text-neutral-900">Reporting conventions</span>
            <span className="mt-0.5 block text-neutral-500">{summary}</span>
          </span>
          <span className="ml-3 shrink-0 font-medium text-accent-700">
            {showConventions ? "Done" : "Change"}
          </span>
        </button>

        <div className={showConventions ? "mt-4 flex flex-col gap-3" : "hidden"}>
          <p className="text-[0.8125rem] leading-relaxed text-neutral-500">
            How this company&rsquo;s own books are kept — not how you are billed. Settled
            once and reused every month.
          </p>
          <SelectField
            id="company-currency"
            name="currency"
            label="Books are in"
            defaultValue={defaults.currency}
            error={fields["currency"]}
          >
            {CURRENCIES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="company-fy-start"
            name="fyStartMonth"
            label="Financial year starts in"
            defaultValue={defaults.fyStartMonth.toString()}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={(i + 1).toString()}>
                {m}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="company-number-format"
            name="numberFormat"
            label="Numbers shown as"
            defaultValue={defaults.numberFormat}
          >
            <option value="lakhs_crores">Lakhs and crores (12,34,567)</option>
            <option value="absolute">Full figures (1,234,567)</option>
            <option value="millions">Millions (1.23)</option>
          </SelectField>
          <SelectField
            id="company-date-order"
            name="dateOrder"
            label="Dates in exports are written"
            defaultValue={defaults.dateOrder}
            hint="Checked against every file you load — if a file disagrees, nothing is generated until it is sorted out."
          >
            <option value="day_first">Day first — 03/04 is 3 April</option>
            <option value="month_first">Month first — 03/04 is 4 March</option>
          </SelectField>
        </div>
      </div>

      <Button type="submit" disabled={busy} icon="plus" className="w-full">
        {busy ? "Adding…" : "Add company"}
      </Button>
    </form>
  );
}
