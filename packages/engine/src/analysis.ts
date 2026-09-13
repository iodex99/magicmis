/**
 * Metric library, continued (SPEC §20): driver analysis, ageing buckets and payroll. Inputs are
 * parsed report lines already in the browser; outputs are metric values with lineage.
 */

import {
  calendarDate,
  calendarDateToExcelSerial,
  type PeriodId,
} from "@magicmis/core/time";
import type { BillLine, PayLine } from "@magicmis/tally";

import type { HeadCube } from "./compute";
import { divide, num, toValue, type MetricInput, type MetricValue } from "./values";

const serialOf = (iso: string): number => {
  const [y = "0", m = "0", d = "0"] = iso.split("-");
  return calendarDateToExcelSerial(
    calendarDate(Number.parseInt(y, 10), Number.parseInt(m, 10), Number.parseInt(d, 10)),
  );
};
const daysBetween = (from: string, to: string): number => serialOf(to) - serialOf(from);

export interface Contributor {
  readonly value: string;
  readonly current: bigint;
  readonly previous: bigint;
  readonly change: bigint;
  /** Share of the total change, % at 6 dp; null when the total change is zero. */
  readonly shareOfChangePct: string | null;
}

/**
 * Deterministic driver analysis: each dimension value's contribution to the total change of a
 * head between two periods, sorted by absolute contribution (ties by value).
 */
export function topContributors(
  cube: HeadCube,
  input: {
    dimension: string;
    head: string;
    period: PeriodId;
    previous: PeriodId;
    limit?: number;
  },
): Contributor[] {
  const values = new Map<string, { current: bigint; previous: bigint }>();
  for (const d of cube.dimensions) {
    if (d.dimension !== input.dimension || d.head !== input.head) continue;
    if (d.period !== input.period && d.period !== input.previous) continue;
    const e = values.get(d.value) ?? { current: 0n, previous: 0n };
    if (d.period === input.period) e.current += d.amount;
    else e.previous += d.amount;
    values.set(d.value, e);
  }
  const rows = [...values.entries()].map(([value, v]) => ({
    value,
    ...v,
    change: v.current - v.previous,
  }));
  const total = rows.reduce((s, r) => s + r.change, 0n);
  const abs = (x: bigint) => (x < 0n ? -x : x);
  return rows
    .sort((a, b) =>
      abs(b.change) === abs(a.change)
        ? a.value.localeCompare(b.value)
        : abs(b.change) > abs(a.change)
          ? 1
          : -1,
    )
    .slice(0, input.limit ?? rows.length)
    .map((r) => {
      const share = divide(num(r.change), num(total), 100n);
      return { ...r, shareOfChangePct: toValue(share, "percent").value };
    });
}

export type AgeingBucket = readonly [from: number, to: number | null];

export function bucketLabel([from, to]: AgeingBucket): string {
  return to === null ? `${from.toString()}+` : `${from.toString()}-${to.toString()}`;
}

/** Ageing by days from bill date to the report's as-at date; undated bills are reported apart. */
export function ageing(
  bills: readonly BillLine[],
  input: {
    asAt: string;
    period: PeriodId;
    buckets: readonly AgeingBucket[];
    side: "receivable" | "payable";
    fileId: string;
    sheet: string;
  },
): MetricValue[] {
  const totals = new Map<string, bigint>();
  const counts = new Map<string, number>();
  for (const b of input.buckets) totals.set(bucketLabel(b), 0n);
  totals.set("undated", 0n);
  for (const bill of bills) {
    if (bill.pending === null) continue;
    const amount = bill.pending < 0n ? -bill.pending : bill.pending;
    let label = "undated";
    if (bill.billDate !== null) {
      const days = daysBetween(bill.billDate, input.asAt);
      const bucket = input.buckets.find(
        ([from, to]) => days >= from && (to === null || days <= to),
      );
      // A bill dated after the as-at date cannot be aged; it is reported with the undated ones.
      label = bucket === undefined ? "undated" : bucketLabel(bucket);
    }
    totals.set(label, (totals.get(label) ?? 0n) + amount);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const metricId = input.side === "receivable" ? "receivables_ageing" : "payables_ageing";
  return [...totals.entries()].map(([bucket, total]) => {
    const inputs: MetricInput[] = [
      {
        kind: "source",
        description: `${input.side === "receivable" ? "Bills receivable" : "Bills payable"} pending amounts`,
        fileId: input.fileId,
        sheet: input.sheet,
        column: "Pending",
        filter: `bucket ${bucket} days as at ${input.asAt}`,
        rows: counts.get(bucket) ?? 0,
      },
    ];
    return {
      metricId,
      period: input.period,
      dims: { bucket },
      value: total.toString(),
      nullReason: null,
      unit: "paise" as const,
      formula: `Sum of pending bill amounts aged ${bucket} days from bill date`,
      inputs,
    };
  });
}

const EMPLOYER_PF = /employer.*(?:pf|provident)|(?:pf|provident).*employer/iu;
const EMPLOYER_ESI = /employer.*esi|esi.*employer/iu;

export function payroll(
  lines: readonly PayLine[],
  input: { period: PeriodId; fileId: string; sheet: string },
): MetricValue[] {
  const staff = lines.filter((l) => l.employee.trim() !== "");
  const src = (column: string, filter: string, rows: number): MetricInput => ({
    kind: "source",
    description: "Pay sheet",
    fileId: input.fileId,
    sheet: input.sheet,
    column,
    filter,
    rows,
  });
  const out: MetricValue[] = [
    {
      metricId: "headcount",
      period: input.period,
      dims: {},
      value: staff.length.toString(),
      nullReason: null,
      unit: "count",
      formula: "Headcount = employees on the pay sheet",
      inputs: [src("Employee", "rows with an employee", staff.length)],
    },
  ];
  const withGross = staff.filter((l) => l.gross !== null);
  out.push({
    metricId: "gross_pay",
    period: input.period,
    dims: {},
    ...(withGross.length === 0
      ? { value: null, nullReason: "missing_data" as const }
      : {
          value: withGross.reduce((s, l) => s + (l.gross ?? 0n), 0n).toString(),
          nullReason: null,
        }),
    unit: "paise",
    formula: "Gross pay = sum of gross pay",
    inputs: [src("Gross", "all employees", withGross.length)],
  });
  const componentSum = (re: RegExp, id: string, label: string) => {
    const names = new Set(
      staff.flatMap((l) => Object.keys(l.components).filter((k) => re.test(k))),
    );
    if (names.size === 0) return;
    let total = 0n;
    for (const l of staff) for (const n of names) total += l.components[n] ?? 0n;
    out.push({
      metricId: id,
      period: input.period,
      dims: {},
      value: total.toString(),
      nullReason: null,
      unit: "paise",
      formula: `${label} = sum of ${[...names].join(", ")}`,
      inputs: [src([...names].join(", "), "all employees", staff.length)],
    });
  };
  componentSum(EMPLOYER_PF, "employer_pf", "Employer PF");
  componentSum(EMPLOYER_ESI, "employer_esi", "Employer ESI");

  const byDesignation = new Map<string, { gross: bigint; rows: number }>();
  for (const l of withGross) {
    const key = l.designation.trim() === "" ? "Unspecified" : l.designation.trim();
    const e = byDesignation.get(key) ?? { gross: 0n, rows: 0 };
    byDesignation.set(key, { gross: e.gross + (l.gross ?? 0n), rows: e.rows + 1 });
  }
  for (const [designation, v] of [...byDesignation.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    out.push({
      metricId: "payroll_cost",
      period: input.period,
      dims: { designation },
      value: v.gross.toString(),
      nullReason: null,
      unit: "paise",
      formula: "Payroll cost by designation = sum of gross pay",
      inputs: [src("Gross", `designation ${designation}`, v.rows)],
    });
  }
  return out;
}
