/**
 * Where each company stands this month (ADR 0087), for anyone keeping several: an accountant or
 * bookkeeper with clients, a group with subsidiaries, a part-time finance director.
 *
 * A company is due when the month that has just ended is not in its figures yet. Months are
 * calendar months in UTC: a period is a month, and a few hours either side of midnight on the
 * first decide nothing anyone acts on.
 */

export type MonthStatus =
  | { readonly kind: "not_set_up" }
  | { readonly kind: "due"; readonly month: string; readonly behind: number }
  | { readonly kind: "up_to_date" };

/** The month that has just ended, as "YYYY-MM". */
export function lastClosedMonth(now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based, so this is already last month's 1-based number
  return month === 0
    ? `${(year - 1).toString()}-12`
    : `${year.toString()}-${month.toString().padStart(2, "0")}`;
}

const monthIndex = (period: string): number => {
  const [y = "0", m = "0"] = period.split("-");
  return Number.parseInt(y, 10) * 12 + Number.parseInt(m, 10) - 1;
};

export function monthStatus(latestPeriod: string | null, now: Date): MonthStatus {
  if (latestPeriod === null) return { kind: "not_set_up" };
  const closed = lastClosedMonth(now);
  const behind = monthIndex(closed) - monthIndex(latestPeriod);
  return behind > 0 ? { kind: "due", month: closed, behind } : { kind: "up_to_date" };
}

/** Due first, the furthest behind first among them, then set up, then not yet set up; by name. */
export function portfolioOrder<T extends { name: string; status: MonthStatus }>(
  rows: readonly T[],
): T[] {
  const rank = (s: MonthStatus) =>
    s.kind === "due" ? -s.behind : s.kind === "up_to_date" ? 1 : 2;
  return [...rows].sort(
    (a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name),
  );
}
