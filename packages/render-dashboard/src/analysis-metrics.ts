/**
 * Figures the engine computes beside the MIS library, which a dashboard box can show (ADR 0085).
 *
 * The library (`METRIC_CATALOG`) is what a template row binds to; these come from the reports
 * a company uploads beside its books — bills receivable and payable aged by bucket, and the pay
 * sheet — and the engine has computed them every month since Phase 7. ADR 0056 added the
 * breakdown box so they could finally be shown, but every list of what a board may hold was the
 * library alone, so the first-dashboard check and the chat's check both refused them. These are
 * kept apart from the library on purpose: it also maps a customer's reference MIS and feeds the
 * chat's synonyms, and none of that should change.
 *
 * `dimension` is the split the engine stores the figure by, or null for a single figure.
 */
export interface AnalysisMetric {
  readonly id: string;
  readonly label: string;
  readonly unit: "money" | "count";
  readonly dimension: string | null;
}

export const ANALYSIS_METRICS: readonly AnalysisMetric[] = [
  {
    id: "receivables_ageing",
    label: "Receivables by age",
    unit: "money",
    dimension: "bucket",
  },
  { id: "payables_ageing", label: "Payables by age", unit: "money", dimension: "bucket" },
  {
    id: "payroll_cost",
    label: "Payroll cost by designation",
    unit: "money",
    dimension: "designation",
  },
  { id: "headcount", label: "Headcount", unit: "count", dimension: null },
  { id: "gross_pay", label: "Gross pay", unit: "money", dimension: null },
  { id: "employer_pf", label: "Employer PF", unit: "money", dimension: null },
  { id: "employer_esi", label: "Employer ESI", unit: "money", dimension: null },
];

export const ANALYSIS_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  ANALYSIS_METRICS.map((m) => [m.id, m.label]),
);

/**
 * Everything a dashboard box may show: the library the caller holds, then the analysis figures.
 * Takes the library rather than importing it, because this package does not depend on templates.
 */
export function dashboardMetrics(
  library: readonly {
    readonly id: string;
    readonly label: string;
    readonly unit: string;
    /** False for a line that belongs on its sheet and not on a board (ADR 0087). */
    readonly onBoard?: boolean;
  }[],
): { id: string; label: string; unit: string }[] {
  const ids = new Set(library.map((m) => m.id));
  return [
    ...library
      .filter((m) => m.onBoard !== false)
      .map((m) => ({ id: m.id, label: m.label, unit: m.unit })),
    ...ANALYSIS_METRICS.filter((m) => !ids.has(m.id)).map((m) => ({
      id: m.id,
      label: m.label,
      unit: m.unit,
    })),
  ];
}
