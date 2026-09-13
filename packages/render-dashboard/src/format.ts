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
): string {
  switch (unit) {
    case "paise":
      return `₹${formatPaise(paise(BigInt(value)), money)}`;
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

export function companyFormat(money: NumberFormatOptions) {
  return {
    money: (p: string) => formatValue(p, "paise", money),
    decimal: (v: string, unit: MetricValue["unit"]) => formatValue(v, unit, money),
    period: periodLabel,
    label: metricLabel,
  };
}
