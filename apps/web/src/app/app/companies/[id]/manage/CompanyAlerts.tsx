"use client";

import type { NumberFormatOptions } from "@magicmis/core/format";
import { formatValue } from "@magicmis/render-dashboard";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Button } from "@/components/ui";
import { alertWords, type BoardAlert } from "@/lib/alert-words";
import { api, newIdempotencyKey } from "@/lib/client-api";

const FIELD =
  "h-9 rounded-md border border-neutral-200 bg-surface px-2.5 text-[0.8125rem] text-neutral-900";

/**
 * A typed amount in whole currency units as minor units, rounded half up as the server rounds it
 * (`decimalStringToPaise`), or null when it is not a plain number. Only for saying back what was
 * understood: the server does its own reading.
 */
function typedMinor(typed: string): string | null {
  const m = /^(-?)(\d{1,15})(?:\.(\d{1,6}))?$/u.exec(typed);
  if (m === null) return null;
  const [, sign = "", whole = "0", fraction = ""] = m;
  const digits = `${fraction}000`;
  let minor = BigInt(whole) * 100n + BigInt(digits.slice(0, 2));
  if ((digits[2] ?? "0") >= "5") minor += 1n;
  return `${sign === "-" && minor !== 0n ? "-" : ""}${minor.toString()}`;
}

/** How the board writes amounts, as a phrase: what a typed amount is not in. */
const SCALE: Record<NumberFormatOptions["style"], string | null> = {
  millions: "millions",
  lakhs_crores: "lakhs or crores",
  absolute: null,
};

/**
 * The owner's alerts on this company (ADR 0087): a short list, each said in words, added and
 * removed here. Checked when a run completes, and on the board for whichever month is on screen.
 */
export function CompanyAlerts({
  companyId,
  alerts,
  metrics,
  money,
  currencySymbol,
}: {
  companyId: string;
  alerts: readonly BoardAlert[];
  metrics: readonly { id: string; label: string; unit: BoardAlert["unit"] }[];
  money: NumberFormatOptions;
  currencySymbol: string;
}) {
  const router = useRouter();
  const [metricId, setMetricId] = useState(
    metrics.find((m) => m.id === "cash_and_bank")?.id ?? metrics[0]?.id ?? "",
  );
  const [comparator, setComparator] = useState<"below" | "above">("below");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metric = metrics.find((m) => m.id === metricId);
  const unit = metric?.unit ?? "money";
  // Grouping is the reader's habit, not part of the number.
  const typed = value.replace(/[,\s]/gu, "");
  // A threshold is typed in full, whatever scale the board is read in, so it is written back in
  // full too: "5" on a board in millions is five, not five million (ADR 0091).
  const full: NumberFormatOptions = {
    ...money,
    style: money.style === "millions" ? "absolute" : money.style,
  };
  const minor = unit === "money" ? typedMinor(typed) : null;
  const understood =
    typed === "" || !/^-?\d+(\.\d+)?$/u.test(typed)
      ? null
      : unit === "money"
        ? minor === null
          ? null
          : formatValue(minor, "paise", full, currencySymbol)
        : unit === "percent"
          ? `${typed}%`
          : unit === "days"
            ? `${typed} days`
            : typed;
  const scale = SCALE[money.style];

  const add = async () => {
    setError(null);
    if (!/^-?\d+(\.\d+)?$/u.test(typed)) {
      setError("Enter the threshold as a number.");
      return;
    }
    setBusy(true);
    const r = await api(`/api/companies/${companyId}/alerts`, {
      body: { metricId, comparator, value: typed },
      idempotencyKey: newIdempotencyKey(),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setValue("");
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    const r = await api(`/api/companies/${companyId}/alerts`, {
      method: "DELETE",
      body: { id },
    });
    setBusy(false);
    if (!r.ok) setError(r.message);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4" data-testid="company-alerts">
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      {alerts.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No alerts yet. Add one, and every run checks it on the figures it computes.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-100 rounded-xl border border-neutral-200/80">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 px-4 py-2.5 text-sm"
              data-testid="company-alert"
            >
              <span className="flex-1 text-neutral-800">
                {alertWords(a, full, currencySymbol)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void remove(a.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[0.75rem] font-medium text-neutral-600">
          Figure
          <select
            id="alert-metric"
            className={FIELD}
            value={metricId}
            onChange={(e) => {
              setMetricId(e.target.value);
            }}
          >
            {metrics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-medium text-neutral-600">
          Is
          <select
            id="alert-comparator"
            className={FIELD}
            value={comparator}
            onChange={(e) => {
              setComparator(e.target.value === "above" ? "above" : "below");
            }}
          >
            <option value="below">below</option>
            <option value="above">above</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-medium text-neutral-600">
          {unit === "money"
            ? `Amount in ${currencySymbol}, in full${scale === null ? "" : `, not in ${scale}`}`
            : unit === "percent"
              ? "Percent"
              : unit === "days"
                ? "Days"
                : "Value"}
          <input
            id="alert-value"
            inputMode="decimal"
            aria-describedby="alert-understood"
            className={`${FIELD} w-40`}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
            }}
          />
        </label>
        <Button
          size="sm"
          disabled={busy || value.trim() === ""}
          onClick={() => void add()}
        >
          Add alert
        </Button>
      </div>
      <p
        id="alert-understood"
        className="min-h-[1.125rem] text-[0.8125rem] text-neutral-700"
        aria-live="polite"
        data-testid="alert-understood"
      >
        {understood === null || metric === undefined
          ? ""
          : `Understood as: ${metric.label} is ${comparator} ${understood}.`}
      </p>
      <p className="text-[0.75rem] text-neutral-500">
        Checked on every run&rsquo;s figures, with nothing charged. The email when one
        fires says how many, never a figure; the board says which.
      </p>
    </div>
  );
}
