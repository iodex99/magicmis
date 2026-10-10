"use client";

import {
  COMMENTARY_LANGUAGES,
  currencySymbol,
  STATUTORY_FORMATS,
  type StatutoryFormat,
} from "@magicmis/core/reporting-conventions";
import { formatValue } from "@magicmis/render-dashboard";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/Icon";
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
  commentaryLanguage: string;
  statutoryFormat: StatutoryFormat;
}

/**
 * How this company's own books are kept (ADR 0030), changeable after the fact (ADR 0035).
 *
 * The financial year is the one that bites: raw data that runs April–March loaded into a company
 * set to January read every year's first month as the whole year. A run says so when it sees it,
 * and this is where it gets fixed. Changing nothing here costs nothing and reads no data.
 */
export function ReportingConventions({
  companyId,
  current,
  onChanged,
}: {
  companyId: string;
  current: Conventions;
  /**
   * Told whether there are changes not yet saved, so the setup page can hold its first run until
   * they are (ADR 0091): a year chosen here and not saved was silently ignored by the build.
   */
  onChanged?: (changed: boolean) => void;
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
    form.dateOrder !== current.dateOrder ||
    form.commentaryLanguage !== current.commentaryLanguage ||
    form.statutoryFormat !== current.statutoryFormat;
  useEffect(() => {
    onChanged?.(changed);
  }, [changed, onChanged]);

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
    // One wording, and the same promise each setting makes beneath it (ADR 0091).
    setNote({
      tone: "success",
      text: "Saved. Each setting takes effect as it says beneath it.",
    });
    router.refresh();
  };

  // What each choice does, shown as it is made: a setting nobody can picture gets left wrong.
  const symbol = currencySymbol(form.currency);
  const sample = formatValue(
    "123456789",
    "paise",
    { style: form.numberFormat, decimals: 2, negativesInBrackets: true },
    symbol,
  );
  const startsIn = MONTHS[form.fyStartMonth - 1] ?? "";
  const endsIn = MONTHS[(form.fyStartMonth + 10) % 12] ?? "";

  return (
    <div className="flex flex-col gap-4" data-testid="reporting-conventions">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Setting
          icon="clock"
          example={`Your year runs ${startsIn} to ${endsIn}.`}
          when="The board's year-to-date figures follow it as soon as it is saved. The next file you add is read with it."
          testId="conventions-fy-example"
        >
          <SelectField
            id="conventions-fy"
            label="Financial year starts in"
            value={form.fyStartMonth.toString()}
            onChange={(e) => {
              setForm((f) => ({
                ...f,
                fyStartMonth: Number.parseInt(e.target.value, 10),
              }));
            }}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={(i + 1).toString()}>
                {m}
              </option>
            ))}
          </SelectField>
        </Setting>
        <Setting
          icon="wallet"
          example={`Every figure carries ${symbol}.`}
          when="Relabels every figure on the board as soon as it is saved. Nothing is converted: choose the currency the books are kept in. Workbooks already made keep their label."
          warning={
            form.currency === current.currency
              ? undefined
              : `Saving puts ${symbol} on the same amounts that now read ${currencySymbol(current.currency)}. They are relabelled, not converted.`
          }
        >
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
        </Setting>
        <Setting
          icon="chart"
          example={
            <>
              1,234,567.89 is shown as <span className="num font-medium">{sample}</span>
              {form.numberFormat === "millions" ? " (millions)" : ""}.
            </>
          }
          when="The board shows it as soon as it is saved. Workbooks already made keep their format."
          testId="conventions-number-example"
        >
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
            <option value="absolute">Full figures</option>
            <option value="millions">Millions</option>
            <option value="lakhs_crores">Lakhs and crores</option>
          </SelectField>
        </Setting>
        <Setting
          icon="document"
          example={
            form.dateOrder === "day_first"
              ? "03/04 in a file is read as 3 April."
              : "03/04 in a file is read as 4 March."
          }
          when="Used to read the next file you add. Months already on the board are unchanged."
        >
          <SelectField
            id="conventions-date-order"
            label="Dates in your files are written"
            value={form.dateOrder}
            onChange={(e) => {
              setForm((f) => ({
                ...f,
                dateOrder: e.target.value as Conventions["dateOrder"],
              }));
            }}
          >
            <option value="day_first">Day first</option>
            <option value="month_first">Month first</option>
          </SelectField>
        </Setting>
        <Setting
          icon="chat"
          example="Commentary and where to act are written in it. The figures are the same in every language."
          when="Used the next time either is written. What was written before stays in its language."
        >
          <SelectField
            id="conventions-language"
            label="Commentary written in"
            value={form.commentaryLanguage}
            onChange={(e) => {
              setForm((f) => ({ ...f, commentaryLanguage: e.target.value }));
            }}
          >
            {COMMENTARY_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </SelectField>
        </Setting>
        <Setting
          icon="document"
          example={
            form.statutoryFormat === "none"
              ? "The workbook carries the MIS sheets only."
              : "The workbook adds a balance sheet and profit and loss in this layout, from the same figures, for management use rather than for filing."
          }
          when="Added to the workbook of the next run. Workbooks already made are unchanged."
        >
          <SelectField
            id="conventions-statutory"
            label="Statutory layout"
            value={form.statutoryFormat}
            onChange={(e) => {
              setForm((f) => ({
                ...f,
                statutoryFormat: e.target.value as StatutoryFormat,
              }));
            }}
          >
            {STATUTORY_FORMATS.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </SelectField>
        </Setting>
      </div>
      {note === null ? null : <Alert tone={note.tone}>{note.text}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={busy || !changed}>
          {busy ? "Saving…" : "Save conventions"}
        </Button>
        {changed ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setForm(current);
              setNote(null);
            }}
          >
            Reset
          </Button>
        ) : null}
        <span className="text-[0.75rem] text-neutral-500">
          Saving costs nothing and reads no data. Each setting says beneath it when it
          takes effect.
        </span>
      </div>
    </div>
  );
}

/** One convention: the control, and underneath it what the current choice actually does. */
function Setting({
  icon,
  example,
  when,
  warning,
  testId,
  children,
}: {
  icon: IconName;
  example: ReactNode;
  /**
   * When the choice takes effect, said per setting (ADR 0091): some reach the board the moment
   * they are saved and some only the next file or the next commentary, and one sentence for all
   * of them was untrue of most.
   */
  when: string;
  /** What saving this particular change will do that cannot be taken for granted. */
  warning?: string | undefined;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-neutral-200/80 bg-raised p-4">
      {children}
      <p
        className="flex items-start gap-1.5 text-[0.75rem] leading-relaxed text-neutral-600"
        data-testid={testId}
      >
        <Icon name={icon} size={13} className="mt-0.5 shrink-0 text-accent-600" />
        <span>{example}</span>
      </p>
      <p className="text-[0.75rem] leading-relaxed text-neutral-500">{when}</p>
      {warning === undefined ? null : (
        <p
          className="rounded-md bg-warning-subtle px-2.5 py-1.5 text-[0.75rem] leading-relaxed text-warning"
          role="status"
        >
          {warning}
        </p>
      )}
    </div>
  );
}
