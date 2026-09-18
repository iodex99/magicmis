/**
 * Display formatting for dashboard and commentary values, from the store's exact strings with
 * bigint arithmetic only (SPEC §4): money per the company's number style, percent to one place,
 * ratios to two, days to whole days. Rounding happens here, at the display boundary.
 */

import { formatPaise, type NumberFormatOptions } from "@magicmis/core/format";
import { divideRounded, formatDecimal, paise, parseDecimal } from "@magicmis/core/money";
import { periodParts, type PeriodId } from "@magicmis/core/time";
import { METRIC_LABELS, type MetricValue } from "@magicmis/engine";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function roundTo(value: string, places: number): string {
  const d = parseDecimal(value);
  const unscaled =
    d.scale <= places
      ? d.unscaled * 10n ** BigInt(places - d.scale)
      : divideRounded(d.unscaled, 10n ** BigInt(d.scale - places), "half_up");
  return formatDecimal({ unscaled, scale: places });
}

export function formatValue(
  value: string,
  unit: MetricValue["unit"],
  money: NumberFormatOptions,
  /**
   * The company's reporting currency symbol (ADR 0030). Required, with no default: a
   * rupee default let a company whose books are in dollars show `₹` on one surface and
   * `$` on another, which is worse than either (ADR 0034).
   */
  currencySymbol: string,
): string {
  switch (unit) {
    case "paise":
      return `${currencySymbol}${formatPaise(paise(BigInt(value)), money)}`;
    case "percent":
      return `${roundTo(value, 1)}%`;
    case "ratio":
      return roundTo(value, 2);
    case "days":
      return `${roundTo(value, 0)} days`;
    case "count":
      return roundTo(value, 0);
  }
}

export function periodLabel(period: string): string {
  const { year, month } = periodParts(period as PeriodId);
  return `${MONTHS[month - 1] ?? ""} ${year.toString()}`;
}

const SUFFIXES: Readonly<Record<string, string>> = {
  mom_abs: "change on last month",
  mom_pct: "% change on last month",
  yoy_abs: "change on last year",
  yoy_pct: "% change on last year",
  ytd: "year to date",
  ly_ytd: "last year to date",
};

export function metricLabel(metricId: string): string {
  const [base = "", suffix] = metricId.split(".");
  const label = METRIC_LABELS[base] ?? base.replace(/_/gu, " ");
  if (suffix === undefined) return label;
  return `${label}, ${SUFFIXES[suffix] ?? suffix.replace(/_/gu, " ")}`;
}

/**
 * Labels for one dashboard: its own formulas by the names the customer gave them (ADR 0046), the
 * catalog's otherwise.
 */
export function labelsFor(
  calculated: readonly { readonly id: string; readonly label: string }[],
): (metricId: string) => string {
  const own = new Map(calculated.map((c) => [c.id, c.label]));
  return (metricId) => {
    const [base = "", suffix] = metricId.split(".");
    const label = own.get(base);
    if (label === undefined) return metricLabel(metricId);
    if (suffix === undefined) return label;
    return `${label}, ${SUFFIXES[suffix] ?? suffix.replace(/_/gu, " ")}`;
  };
}

/**
 * How the company's own books are written, in words: what a reader needs to know before
 * reading a figure on a chart axis or a card (ADR 0034). `millions` shows figures divided
 * by a million with no suffix, so the scale has to be said somewhere on the screen.
 */
export function unitsNote(money: NumberFormatOptions, currencySymbol: string): string {
  return money.style === "millions"
    ? `Amounts in ${currencySymbol} millions`
    : `Amounts in ${currencySymbol}`;
}

const SHORT: readonly {
  readonly at: number;
  readonly by: number;
  readonly tag: string;
}[] = [
  { at: 1e7, by: 1e7, tag: " Cr" },
  { at: 1e5, by: 1e5, tag: " L" },
];
const SHORT_WESTERN: readonly {
  readonly at: number;
  readonly by: number;
  readonly tag: string;
}[] = [
  { at: 1e9, by: 1e9, tag: "bn" },
  { at: 1e6, by: 1e6, tag: "m" },
  { at: 1e3, by: 1e3, tag: "k" },
];

const trim = (n: number): string =>
  n
    .toFixed(Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2)
    .replace(/\.0+$/u, "")
    .replace(/(\.\d)0$/u, "$1");

/**
 * A chart axis label: the same currency as every other figure, shortened so the axis does
 * not become a wall of digits. Major units in (rupees, dollars), never paise.
 */
export function compactMoney(
  value: number,
  money: NumberFormatOptions,
  currencySymbol: string,
): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const scale = money.style === "lakhs_crores" ? SHORT : SHORT_WESTERN;
  const step = scale.find((s) => abs >= s.at);
  const body = step === undefined ? trim(abs) : `${trim(abs / step.by)}${step.tag}`;
  return `${negative ? "-" : ""}${currencySymbol}${body}`;
}

/**
 * Every display function a dashboard, commentary or answer needs, bound to one company's
 * conventions. The currency symbol is required for the same reason as in `formatValue`.
 */
export function companyFormat(money: NumberFormatOptions, currencySymbol: string) {
  return {
    money: (p: string) => formatValue(p, "paise", money, currencySymbol),
    decimal: (v: string, unit: MetricValue["unit"]) =>
      formatValue(v, unit, money, currencySymbol),
    axis: (value: number) => compactMoney(value, money, currencySymbol),
    period: periodLabel,
    label: metricLabel,
    units: unitsNote(money, currencySymbol),
    symbol: currencySymbol,
  };
}
