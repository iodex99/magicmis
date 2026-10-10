"use client";

/**
 * Dashboard (SPEC §24.2): widgets from the stored spec over the company's stored metric values.
 * It is the main surface of the company workspace (ADR 0033). Every number opens its lineage in
 * a drawer, and Investigate hands a question to the assistant beside it. Edits are JSON Patch operations: previewed, applied on
 * confirmation as a new blueprint version, and undoable.
 */

import { CompanyLogo } from "@/components/CompanyLogo";
import type { NumberFormatOptions } from "@magicmis/core/format";
import type { PeriodId } from "@magicmis/core/time";
import type { MetricValue } from "@magicmis/engine";
import {
  buildWidgetView,
  companyFormat,
  firedAlerts,
  formatValue,
  labelsFor,
  metricKey,
  NO_LENS,
  parseMetricKey,
  type BoardLens,
  type CompareBasis,
  type DashboardSpec,
  type ValueRef,
  type ViewFormat,
  type Widget,
} from "@magicmis/render-dashboard";
import {
  variance,
  varianceColor,
  type MetricPolarity,
  type VarianceDirection,
} from "@magicmis/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Sparkline } from "@/components/Charts";
import { Drawer, keepTabInside } from "@/components/Drawer";
import { EChart } from "@/components/EChart";
import { LineagePanel } from "@/components/LineagePanel";
import { PaidJobButton } from "@/components/PaidJobButton";
import { RollingNumber } from "@/components/RollingNumber";
import { Icon, type IconName } from "@/components/Icon";
import { Alert, Button, ButtonLink, MistakesNote, Panel } from "@/components/ui";
import { alertWords, type BoardAlert } from "@/lib/alert-words";
import { checkLines, type CheckSummary } from "@/lib/check-words";
import { api, newIdempotencyKey } from "@/lib/client-api";
import {
  isPresentAsk,
  presentChannelName,
  type PresentMessage,
} from "@/lib/present-channel";

const SELECT =
  "h-9 rounded-md border border-neutral-200 bg-surface px-2.5 text-[0.8125rem] font-medium text-neutral-900 hover:border-neutral-300";

/*
 * Reading the board differently (ADR 0064). "As saved" is first and is the default, because the
 * board a company built for itself is the one it should open on; everything below it is a
 * question the reader is asking of the same figures, answered without a charge.
 *
 * The windows are the ones the spec already allows, so nothing here can ask for a shape a saved
 * dashboard could not have held.
 */
type RangeChoice = "saved" | "month" | "fy" | "n3" | "n6" | "n12" | "n24";
const RANGES: readonly {
  id: RangeChoice;
  label: string;
  window: Widget["periods"] | null;
}[] = [
  { id: "saved", label: "As saved", window: null },
  { id: "month", label: "This month", window: { kind: "current" } },
  { id: "fy", label: "Financial year to date", window: { kind: "fy_to_date" } },
  { id: "n3", label: "Last 3 months", window: { kind: "last_n", n: 3 } },
  { id: "n6", label: "Last 6 months", window: { kind: "last_n", n: 6 } },
  { id: "n12", label: "Last 12 months", window: { kind: "last_n", n: 12 } },
  { id: "n24", label: "Last 24 months", window: { kind: "last_n", n: 24 } },
];

type CompareChoice = "saved" | "none" | "previous_month" | "last_year";
const COMPARISONS: readonly {
  id: CompareChoice;
  label: string;
  basis: CompareBasis | null;
  /** How Present says it to the room (ADR 0091). */
  said: string;
}[] = [
  { id: "saved", label: "As saved", basis: null, said: "" },
  { id: "none", label: "No comparison", basis: "none", said: "No comparison" },
  {
    id: "previous_month",
    label: "The month before",
    basis: "previous_month",
    said: "Against the month before",
  },
  {
    id: "last_year",
    label: "The same month last year",
    basis: "last_year",
    said: "Against the same month last year",
  },
];

/**
 * Whether a rise is good news (ADR 0091). Revenue up is; a cost up is not; a receivable up is
 * neither by itself. The arrow beside a movement follows the sign of the stored figure, and its
 * colour follows this, through the design system's own `varianceColor` — a green arrow on a rise
 * in costs undermined every other figure on the board. A metric missing here, including any
 * formula a customer added, is neutral: guessing would colour a cost increase green.
 *
 * Kept here rather than on the metric catalog, because the catalog is prompt input and a field
 * added there is a change every AI stage that reads it must be measured again for (ADR 0087).
 */
const POLARITY: Readonly<Record<string, MetricPolarity>> = {
  revenue: "higher_is_better",
  gross_profit: "higher_is_better",
  gross_margin_pct: "higher_is_better",
  other_income: "higher_is_better",
  ebitda: "higher_is_better",
  ebitda_pct: "higher_is_better",
  pbt: "higher_is_better",
  pat: "higher_is_better",
  pat_pct: "higher_is_better",
  cash_and_bank: "higher_is_better",
  current_ratio: "higher_is_better",
  quick_ratio: "higher_is_better",
  cf_operating: "higher_is_better",
  cf_net: "higher_is_better",
  direct_costs: "lower_is_better",
  employee_cost: "lower_is_better",
  employee_cost_pct: "lower_is_better",
  other_opex: "lower_is_better",
  finance_cost: "lower_is_better",
  payroll_cost: "lower_is_better",
  dso: "lower_is_better",
  inventory_days: "lower_is_better",
  cash_conversion_cycle: "lower_is_better",
};

/** The suffixes that state a movement, and so carry an arrow; a year-to-date total does not. */
const MOVEMENT_SUFFIXES = new Set(["mom_abs", "mom_pct", "yoy_abs", "yoy_pct"]);

/** Up, down or flat from the stored decimal string's own sign, never from how it is displayed. */
function directionOf(value: string | null | undefined): VarianceDirection | null {
  if (value === null || value === undefined) return null;
  if (!/[1-9]/u.test(value)) return "flat";
  return value.startsWith("-") ? "down" : "up";
}

/**
 * The class for a movement's arrow. `varianceColor` answers in the light theme's hex, which a
 * dark board must not be painted in, so its answer picks the theme's own class instead.
 */
function movementTone(direction: VarianceDirection, metricId: string): string {
  const base = metricId.split(".")[0] ?? metricId;
  const colour = varianceColor(direction, POLARITY[base] ?? "neutral");
  return colour === variance.positive
    ? "text-positive"
    : colour === variance.negative
      ? "text-negative"
      : "text-neutral-500";
}

function MovementArrow({
  direction,
  metricId,
}: {
  direction: VarianceDirection | null;
  metricId: string;
}) {
  if (direction === null || direction === "flat") return null;
  return (
    <Icon
      name={direction === "down" ? "arrow-down" : "arrow-up"}
      size={11}
      className={movementTone(direction, metricId)}
    />
  );
}

/** "Mar 2026, Apr 2026 and May 2026"; past four, the first three and how many more. */
function monthList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 4)
    return `${names.slice(0, 3).join(", ")} and ${(names.length - 3).toString()} more months`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * A card's headline, sized to its card (ADR 0091). A long figure in a narrow card ran out of it:
 * four cards a row beside the chat leave about 150px for "$1,234,567.00" at 24.5px. The size is
 * the card's width shared out over the figure's characters — a digit at about 0.62em in Inter's
 * tabular numerals, punctuation at about 0.4em — never more than the design size and never less
 * than the body text's.
 */
function headlineSize(display: string): string {
  let em = 0;
  for (const ch of display) em += /\d/u.test(ch) ? 0.62 : 0.4;
  return `min(1.75rem, max(1rem, ${(100 / Math.max(em, 1)).toFixed(2)}cqi))`;
}

import { monthsLabel } from "./CompanyFiles";
import { ShareBoard } from "./ShareBoard";

export interface DashboardPayload {
  company: {
    id: string;
    name: string;
    fyStartMonth: number;
    money: NumberFormatOptions;
    /** The company's reporting currency symbol (ADR 0030). */
    currencySymbol: string;
  };
  periods: string[];
  values: MetricValue[];
  dashboard: {
    blueprintVersion: number;
    spec: DashboardSpec;
    canUndo: boolean;
    dataThrough: string | null;
  } | null;
  latestPeriod: string | null;
  /** The company's stored files, each with the months it fed and its tick (ADR 0047). */
  files: {
    id: string;
    fileName: string;
    periods: string[];
    onDashboard: boolean;
    /** Deleted, but still hiding its months until it is ticked again. */
    deleted: boolean;
  }[];
  hiddenPeriods: string[];
  /** The checks behind each month, said in words below the board (ADR 0087). */
  checks?: Record<string, CheckSummary[]>;
  /** The owner's alerts, said when the month on screen trips one (ADR 0087). */
  alerts?: BoardAlert[];
}

type Operation = Record<string, unknown>;

/**
 * What was proved about the month on the board, in words (ADR 0087): the run's checks, passed
 * and to look at, folded to one line until opened. An unplaced ledger links to the ledger map,
 * where it can be put on a line.
 *
 * Something to look at leads (ADR 0091): the line used to open on a green tick and "0 checks
 * passed" with the failures after it, folded away. Now a month with anything to look at opens
 * with its warning first and the list showing, and each failure says where to go about it.
 */
function ChecksLine({
  checks,
  month,
  ledgerMap,
  onFiles,
}: {
  checks: readonly CheckSummary[];
  month: string;
  ledgerMap: string | null;
  /** Opens the board's files, where a missing or doubled month is sorted out; null on a sample. */
  onFiles: (() => void) | null;
}) {
  const { passed, look } = checkLines(checks);
  const box = useRef<HTMLDetailsElement>(null);
  const failing = look.length > 0;
  // Opened once per month, so a reader who folds it away is not overruled on the next render.
  useEffect(() => {
    if (failing && box.current !== null) box.current.open = true;
  }, [failing, month]);
  if (passed.length === 0 && look.length === 0) return null;
  const passedWords = `${passed.length.toString()} ${passed.length === 1 ? "check" : "checks"} passed for ${month}`;
  return (
    <details
      ref={box}
      className="mt-3 rounded-xl border border-neutral-200/80 bg-surface px-4 py-2.5 text-[0.8125rem] shadow-sm"
      data-testid="board-checks"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 select-none">
        {failing ? (
          <>
            <Icon name="alert" size={15} className="text-warning" />
            <span className="font-medium text-neutral-900">
              {look.length.toString()} to look at
              {passed.length === 0 ? ` for ${month}` : null}
            </span>
            {passed.length === 0 ? null : (
              <span className="text-neutral-600">· {passedWords}</span>
            )}
          </>
        ) : (
          <>
            <Icon name="check-circle" size={15} className="text-positive" />
            <span className="font-medium text-neutral-900">{passedWords}</span>
          </>
        )}
      </summary>
      <ul className="mt-2.5 flex flex-col gap-1.5 border-t border-neutral-100 pt-2.5">
        {look.map((l) => (
          <li key={l.id} className="flex items-start gap-2 text-neutral-800">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0 text-warning" />
            <span>
              {l.text}
              {l.id === "V1" && ledgerMap !== null ? (
                <>
                  {" "}
                  <a
                    href={ledgerMap}
                    className="font-medium text-accent-700 underline underline-offset-2"
                  >
                    Open the ledger map
                  </a>
                </>
              ) : null}
              {(l.id === "V8" || l.id === "V9") && onFiles !== null ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="font-medium text-accent-700 underline underline-offset-2"
                    onClick={onFiles}
                  >
                    See the files
                  </button>
                </>
              ) : null}
            </span>
          </li>
        ))}
        {passed.map((t) => (
          <li key={t} className="flex items-start gap-2 text-neutral-600">
            <Icon name="check" size={13} className="mt-0.5 shrink-0 text-positive" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * What a KPI card calls its supporting figures. The full metric label ("Revenue from
 * operations, % change on last month") is too long beside the headline, and the headline
 * already names the metric, so only the comparison is named here.
 */
const MOVEMENTS: Record<string, string> = {
  mom_abs: "vs last month",
  mom_pct: "vs last month",
  yoy_abs: "vs last year",
  yoy_pct: "vs last year",
  ytd: "year to date",
  ly_ytd: "last year to date",
};

function movementLabel(
  metricKey: string,
  format: { label: (metricId: string) => string },
): string {
  const metricId = metricKey.split("@")[0] ?? "";
  const suffix = metricId.split(".")[1];
  return suffix === undefined ? format.label(metricId) : (MOVEMENTS[suffix] ?? suffix);
}

/**
 * A value's name in the list under a chart: the figure, the split it belongs to if it is one bar
 * of a breakdown, and its month — "Payroll cost by designation, Accountant, Apr 2026".
 */
function valueName(
  metricKey: string,
  format: { label: (metricId: string) => string; period: (period: string) => string },
): string {
  const { metricId, period, dims } = parseMetricKey(metricKey);
  return [format.label(metricId), ...Object.values(dims), format.period(period)].join(
    ", ",
  );
}

/**
 * One control on a card while the layout is being edited: an icon with its name as the
 * accessible label and tooltip. Words were the first version, and four of them beside a title
 * did not fit a narrow card — they ran out through its rounded corner.
 */
function EditTool({
  label,
  icon,
  onClick,
  disabled = false,
  danger = false,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`press flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-surface hover:shadow-sm disabled:text-neutral-300 disabled:hover:bg-transparent disabled:hover:shadow-none ${
        danger ? "hover:text-negative" : "hover:text-neutral-900"
      }`}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

function ValueButton({
  value,
  onOpen,
  name,
  rolling = false,
}: {
  value: ValueRef;
  onOpen: (key: string) => void;
  /**
   * What the figure is and when — "Revenue from operations, May 2026" — for a screen reader,
   * which otherwise heard a bare number with no hint that it opens anything (ADR 0091).
   */
  name: string;
  /** Roll the figure in a character at a time (ADR 0036), for a card's headline only. */
  rolling?: boolean;
}) {
  return (
    <button
      type="button"
      className="tabular-nums underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-accent-600"
      onClick={() => {
        onOpen(value.metricKey);
      }}
      aria-label={`${name}: ${value.display}. Show where it comes from`}
      data-metric-key={value.metricKey}
    >
      {rolling ? <RollingNumber value={value.display} /> : value.display}
    </button>
  );
}

/**
 * Up to twelve months of a metric ending at the month on the board, for the sparkline beside its
 * headline (ADR 0036). It ends where the picker is, not at the newest month stored: picking last
 * March left a line ending this month beside a March figure (ADR 0091). Chart values only, never
 * a displayed figure: the number on the card is the one that is read.
 */
function trendOf(
  values: readonly MetricValue[],
  metricId: string,
  period: PeriodId,
): number[] {
  return values
    .filter(
      (v) =>
        v.metricId === metricId &&
        v.value !== null &&
        v.period <= period &&
        Object.keys(v.dims).length === 0,
    )
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-12)
    .map((v) => {
      const n = Number.parseFloat(v.value ?? "0");
      return v.unit === "paise" ? n / 100 : n;
    });
}

function WidgetCard({
  widget,
  index,
  count,
  values,
  period,
  payload,
  editing,
  presenting,
  label,
  onOpen,
  onEdit,
  onInvestigate,
  onChangeBox,
  lens,
  explore,
  stored,
}: {
  widget: Widget;
  index: number;
  count: number;
  values: MetricValue[];
  period: PeriodId;
  payload: DashboardPayload;
  editing: boolean;
  /** On the boardroom screen: figures and charts only, nothing to operate. */
  presenting: boolean;
  /** This dashboard's names: its own formulas by their given names, the catalog otherwise. */
  label: (metricId: string) => string;
  onOpen: (key: string) => void;
  onEdit: (ops: Operation[]) => void;
  onInvestigate: (metric: string, period: PeriodId, name: string) => void;
  onChangeBox: (title: string) => void;
  /** How the board is being read, if not as it was saved (ADR 0064). */
  lens: BoardLens;
  /** Whether the box ends in Investigate and Change: not on the sample, which has no chat. */
  explore: boolean;
  /** The stored value behind a metric key, whose sign decides a movement's arrow. */
  stored: (key: string) => string | null | undefined;
}) {
  const format = useMemo(
    () => ({
      ...companyFormat(payload.company.money, payload.company.currencySymbol),
      label,
    }),
    [payload.company.money, payload.company.currencySymbol, label],
  );
  const view = useMemo(
    () =>
      buildWidgetView(widget, values, {
        period,
        fyStartMonth: payload.company.fyStartMonth,
        format,
        dimensionFilter: null,
        lens,
      }),
    [widget, values, period, payload.company.fyStartMonth, format, lens],
  );
  // What the box is about, for the question Investigate writes: its figures by name, once each,
  // however many movement chips hang off them. "Revenue, Gross profit and Profit after tax".
  const subject = useMemo(() => {
    const names = [...new Set(widget.metrics.map((m) => m.split(".")[0] ?? m))]
      .slice(0, 3)
      .map((m) => label(m));
    return names.length < 2
      ? (names[0] ?? widget.title)
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
  }, [widget.metrics, widget.title, label]);
  const path = `/widgets/${index.toString()}`;
  const trend =
    widget.kind === "kpi_card" ? trendOf(values, widget.metrics[0] ?? "", period) : [];
  const nameOf = (key: string) => valueName(key, format);
  return (
    <section
      // Beside the assistant the grid can be narrow, so a card takes twice its width there
      // and its designed width once the grid has room.
      className="print-block rise lift flex flex-col rounded-xl border border-neutral-200/80 bg-surface p-4 shadow-sm [grid-column:span_var(--span-narrow)/span_var(--span-narrow)] @3xl:[grid-column:span_var(--span)/span_var(--span)]"
      style={
        {
          "--i": index.toString(),
          "--span": widget.layout.w.toString(),
          "--span-narrow": Math.min(12, widget.layout.w * 2).toString(),
          minHeight: `${(widget.layout.h * 4).toString()}rem`,
          // A chart needs a height in pixels to draw into; without one it is measured
          // mid-layout and stays that size, spilling out of the card (ADR 0034).
          "--chart-height": `${Math.max(11, widget.layout.h * 3.5).toString()}rem`,
        } as CSSProperties
      }
      data-testid={`widget-${widget.id}`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="eyebrow min-w-0">{widget.title}</h3>
        {!editing && trend.length >= 3 ? (
          <span
            className="-mt-1.5 shrink-0 opacity-90"
            title={`${trend.length.toString()} months to ${format.period(period)}`}
          >
            <Sparkline values={trend} width={88} height={26} />
          </span>
        ) : null}
      </div>
      {editing ? (
        <div
          className="mb-3 flex flex-wrap items-center gap-1 rounded-lg bg-neutral-100 p-1"
          role="toolbar"
          aria-label={`Edit ${widget.title}`}
          data-testid="widget-tools"
        >
          <EditTool
            label="Rename"
            icon="pencil"
            onClick={() => {
              const title = window.prompt("Box title", widget.title);
              if (title !== null && title.trim() !== "")
                onEdit([{ op: "replace", path: `${path}/title`, value: title.trim() }]);
            }}
          />
          <EditTool
            label="Earlier"
            icon="arrow-left"
            disabled={index === 0}
            onClick={() => {
              onEdit([
                { op: "move", from: path, path: `/widgets/${(index - 1).toString()}` },
              ]);
            }}
          />
          <EditTool
            label="Later"
            icon="arrow-right"
            disabled={index === count - 1}
            onClick={() => {
              onEdit([
                { op: "move", from: path, path: `/widgets/${(index + 1).toString()}` },
              ]);
            }}
          />
          <span className="flex-1" />
          <EditTool
            label="Remove"
            icon="trash"
            danger
            onClick={() => {
              onEdit([
                { op: "test", path: `${path}/id`, value: widget.id },
                { op: "remove", path },
              ]);
            }}
          />
        </div>
      ) : null}
      {view.kind === "empty" ? (
        <p className="text-[0.8125rem] text-neutral-500">{view.reason}</p>
      ) : view.kind === "kpi" ? (
        // A container of its own, so the headline can be sized to the card's width (ADR 0091).
        <div className="@container flex flex-1 flex-col">
          <div
            className="num text-[1.75rem] leading-none font-semibold tracking-tight whitespace-nowrap text-neutral-900"
            style={
              view.values[0] === undefined
                ? undefined
                : { fontSize: headlineSize(view.values[0].display) }
            }
          >
            {view.values[0] === undefined ? (
              "—"
            ) : (
              <ValueButton
                value={view.values[0]}
                onOpen={onOpen}
                name={nameOf(view.values[0].metricKey)}
                rolling
              />
            )}
          </div>
          {view.values.length < 2 ? null : (
            <dl className="mt-3 flex flex-wrap gap-1.5 text-[0.75rem]">
              {view.values.slice(1).map((v) => {
                // The arrow is for a movement only, from the stored figure's sign: reading it
                // off the display missed "$(1,234.00)", where the bracket follows the symbol,
                // and put a green up arrow on a fall (ADR 0091).
                const { metricId } = parseMetricKey(v.metricKey);
                const movement = MOVEMENT_SUFFIXES.has(metricId.split(".")[1] ?? "");
                return (
                  <div
                    key={v.metricKey}
                    className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pr-2 pl-1.5"
                  >
                    <dt className="sr-only">{movementLabel(v.metricKey, format)}</dt>
                    {movement ? (
                      <MovementArrow
                        direction={directionOf(stored(v.metricKey))}
                        metricId={metricId}
                      />
                    ) : null}
                    <dd className="num font-medium text-neutral-700">
                      <ValueButton value={v} onOpen={onOpen} name={nameOf(v.metricKey)} />
                    </dd>
                    <span className="text-neutral-500">
                      {movementLabel(v.metricKey, format)}
                    </span>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      ) : view.kind === "comparison" ? (
        // ADR 0046: this month set against another, every figure the engine's own and every one
        // of them open to its lineage. The arrow repeats the sign; it never stands in for it.
        <div className="overflow-x-auto" data-testid="comparison">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[0.6875rem] font-semibold tracking-[0.06em] text-neutral-500 uppercase">
                <th className="py-1.5" />
                <th className="py-1.5 text-right">{view.current}</th>
                <th className="py-1.5 text-right">{view.basis}</th>
                <th className="py-1.5 text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr
                  key={r.current.metricKey}
                  className="border-b border-neutral-100 last:border-0"
                >
                  <td className="py-2 pr-3 text-neutral-700">{r.label}</td>
                  <td className="num py-2 text-right font-semibold text-neutral-900">
                    <ValueButton
                      value={r.current}
                      onOpen={onOpen}
                      name={nameOf(r.current.metricKey)}
                    />
                  </td>
                  <td className="num py-2 text-right text-neutral-600">
                    <ValueButton
                      value={r.prior}
                      onOpen={onOpen}
                      name={nameOf(r.prior.metricKey)}
                    />
                  </td>
                  <td className="num py-2 text-right">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {/* Coloured by whether the move is good news for this line (ADR 0091). */}
                      <MovementArrow
                        direction={r.direction}
                        metricId={parseMetricKey(r.current.metricKey).metricId}
                      />
                      <ValueButton
                        value={r.change}
                        onOpen={onOpen}
                        name={nameOf(r.change.metricKey)}
                      />
                      {/* No prior month: one dash says it; a second beside it says nothing more. */}
                      {r.changePct === null || r.direction === null ? null : (
                        <span className="text-[0.75rem] text-neutral-500">
                          <ValueButton
                            value={r.changePct}
                            onOpen={onOpen}
                            name={nameOf(r.changePct.metricKey)}
                          />
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : view.kind === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[0.6875rem] font-semibold tracking-[0.06em] text-neutral-500 uppercase">
                <th className="py-1.5" />
                {view.columns.map((c) => (
                  <th key={c} className="py-1.5 text-right">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.label} className="border-b border-neutral-100 last:border-0">
                  <td className="py-1.5 text-neutral-700">{r.label}</td>
                  {r.cells.map((c) => (
                    <td key={c.metricKey} className="num py-1.5">
                      <ValueButton value={c} onOpen={onOpen} name={nameOf(c.metricKey)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="h-[var(--chart-height)] w-full">
            <EChart
              option={view.option}
              label={widget.title}
              onPoint={(s, d) => {
                const key = view.points[s]?.[d]?.metricKey;
                if (key !== undefined && key !== "") onOpen(key);
              }}
            />
          </div>
          {/* The same values as text: every charted number is reachable without a pointer. */}
          <details
            hidden={presenting}
            className="mt-3 border-t border-neutral-100 pt-2 text-[0.75rem] text-neutral-500"
          >
            <summary className="cursor-pointer select-none hover:text-neutral-900">
              Values
            </summary>
            <ul className="mt-1 flex flex-col gap-1">
              {view.points
                .flat()
                .filter((p) => p.metricKey !== "")
                .map((p) => (
                  <li key={p.metricKey} className="flex items-baseline gap-2">
                    <span className="truncate">{nameOf(p.metricKey)}</span>
                    <span className="num ml-auto">
                      <ValueButton value={p} onOpen={onOpen} name={nameOf(p.metricKey)} />
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        </div>
      )}
      {/*
        Every box ends in the chat (ADR 0047), not only the KPI cards: the chat is what the
        product earns from, and a reader looking at a chart has a question about that chart.
        Investigate asks why its figures moved (SPEC §27, a Deep question); Change hands the box
        to the chat to be reshaped. Both only write the message: nothing is sent or charged
        until the customer presses send.

        An empty box keeps both (ADR 0091): "No data for these months" is exactly the box that
        needs changing, and hiding Change left Edit layout as the only way to deal with it. Each
        names its box, because a screen reader listing the page's buttons heard "Investigate"
        and "Change" a dozen times over with nothing to tell them apart.
      */}
      {presenting || editing || !explore ? null : (
        <div
          className="mt-auto -mb-1 -ml-2 flex flex-wrap items-center gap-0.5 pt-3"
          data-testid="box-actions"
        >
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.75rem] font-medium text-accent-700 hover:bg-accent-50"
            aria-label={`Investigate ${widget.title}`}
            onClick={() => {
              onInvestigate(widget.metrics[0] ?? "", period, subject);
            }}
          >
            <Icon name="search" size={12} />
            Investigate
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.75rem] font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
            aria-label={`Change ${widget.title}`}
            onClick={() => {
              onChangeBox(widget.title);
            }}
          >
            <Icon name="sliders" size={12} />
            Change
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * What Range and Compare are doing, in a sentence, while either is set (ADR 0064, ADR 0091).
 * They often reach fewer boxes than a reader expects — a card or a waterfall states one month
 * whatever the range — and the only word on it was a tooltip, which a keyboard or a touch never
 * shows. So this says how many boxes they change, that nothing is saved, and offers the board
 * back as saved. The count draws each box with and without the lens and compares the two, so it
 * cannot disagree with what is on the screen.
 */
function LensNote({
  widgets,
  values,
  period,
  fyStartMonth,
  money,
  currencySymbol,
  label,
  lens,
  onReset,
}: {
  widgets: readonly Widget[];
  values: readonly MetricValue[];
  period: PeriodId;
  fyStartMonth: number;
  money: NumberFormatOptions;
  currencySymbol: string;
  label: (metricId: string) => string;
  lens: BoardLens;
  onReset: () => void;
}) {
  const changed = useMemo(() => {
    const format: ViewFormat = { ...companyFormat(money, currencySymbol), label };
    const input = { period, fyStartMonth, format, dimensionFilter: null };
    return widgets.filter(
      (w) =>
        JSON.stringify(buildWidgetView(w, values, { ...input, lens: NO_LENS })) !==
        JSON.stringify(buildWidgetView(w, values, { ...input, lens })),
    ).length;
  }, [widgets, values, period, fyStartMonth, money, currencySymbol, label, lens]);
  return (
    <p
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-neutral-600"
      role="status"
      data-testid="lens-note"
      data-print="hide"
    >
      <Icon name="info" size={14} className="shrink-0 text-neutral-500" />
      <span>
        {changed === 0
          ? "This changes no box on this board: Range reaches boxes that show several months, and Compare reaches comparison boxes, and line and bar charts against last year."
          : `This changes ${changed.toString()} of ${widgets.length.toString()} ${widgets.length === 1 ? "box" : "boxes"}.`}{" "}
        It is only how you are reading the board: nothing is saved, and it opens as saved
        next time.
      </span>
      <button
        type="button"
        className="font-medium text-accent-700 underline underline-offset-2"
        onClick={onReset}
      >
        Back to as saved
      </button>
    </p>
  );
}

export function DashboardClient({
  companyId,
  logoUrl,
  onInvestigate,
  reloadKey,
  onVersion,
  onChangeBox,
  onWhereToAct,
  sample,
  preparer = null,
}: {
  companyId: string;
  /** The company's own logo, shown before its name in Present; null for none. */
  logoUrl: string | null;
  onInvestigate: (metric: string, period: PeriodId, name: string) => void;
  /** Changes when the layout was changed elsewhere (the assistant), to load it again. */
  reloadKey: number;
  /** A box's Change button: hands the box to the chat to be reshaped. */
  onChangeBox: (title: string) => void;
  /** "Where to act" for the month on screen (ADR 0063). */
  onWhereToAct: (period: PeriodId) => void;
  /** The version of the layout on screen, so the chat knows which of its changes is current. */
  onVersion?: (version: number | null) => void;
  /**
   * A recorded board to show in place of a company's own (ADR 0086): the sample company, read
   * as a customer reads theirs, with nothing fetched and nothing that edits, charges or opens
   * the chat. Range, Compare, Present and every figure's lineage still work, because they only
   * read figures the engine computed.
   */
  sample?: DashboardPayload;
  /** The preparer's name and mark, beside the company's in Present (ADR 0087). */
  preparer?: { name: string; logoUrl: string | null } | null;
}) {
  const live = sample === undefined;
  const [payload, setPayload] = useState<DashboardPayload | null>(sample ?? null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeChoice>("saved");
  const [compare, setCompare] = useState<CompareChoice>("saved");
  // Neither is written anywhere: the board a customer saved is the board they get back.
  const lens = useMemo<BoardLens>(
    () => ({
      range: RANGES.find((r) => r.id === range)?.window ?? null,
      compare: COMPARISONS.find((c) => c.id === compare)?.basis ?? null,
    }),
    [range, compare],
  );
  const [period, setPeriod] = useState<PeriodId | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<{
    ops: Operation[];
    spec: DashboardSpec;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Present (ADR 0046): the dashboard alone on the screen, for a boardroom. It is shown from
   * here and nowhere else — there is no print and no export — so the figures a room sees are
   * always the live ones, each still one click from its source. The stage asks the browser
   * for the whole screen; where that is refused it still covers the window, so Present never
   * fails to present.
   */
  const [filesOpen, setFilesOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // A tick answers at once; the board follows when the server has. Cleared by the reload.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [presenting, setPresenting] = useState(false);
  // Whether the stage has the whole screen, or only the window (refused, or given up below).
  const [wholeScreen, setWholeScreen] = useState(false);
  // When the presenter's notes were last opened (ADR 0087): see the full-screen handler.
  const notesOpenedAt = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  const drawerOpen = useRef(false);
  drawerOpen.current = selected !== null;
  // Where focus was when Present began: a keyboard user is put back there, on Present, rather
  // than at the top of the page (ADR 0091).
  const presentedFrom = useRef<HTMLElement | null>(null);
  const present = useCallback(() => {
    presentedFrom.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(false);
    setPresenting(true);
    const el = stage.current;
    if (el !== null && typeof el.requestFullscreen === "function")
      void el.requestFullscreen().then(
        () => {
          setWholeScreen(true);
        },
        () => undefined,
      );
  }, []);
  const stopPresenting = useCallback(() => {
    setPresenting(false);
    setWholeScreen(false);
    if (document.fullscreenElement !== null)
      void document.exitFullscreen().catch(() => undefined);
    const back = presentedFrom.current;
    presentedFrom.current = null;
    if (back?.isConnected === true) back.focus({ preventScroll: true });
  }, []);
  const months = payload?.periods;
  const step = useCallback(
    (by: number) => {
      // Months are listed newest first; a step forward is the later month.
      const list = months ?? [];
      setPeriod((p) => {
        const at = list.indexOf(p ?? list[0] ?? "");
        const next = list[at - by];
        return next === undefined ? p : (next as PeriodId);
      });
    },
    [months],
  );
  useEffect(() => {
    if (!presenting) return;
    // Leaving full screen by the browser's own means (Esc, F11) leaves Present too — but not when
    // the presenter has just opened their notes: a browser gives up full screen for any new
    // window, and that is the presenter preparing to speak, not stopping. The board stays on the
    // window, and Full screen takes the whole screen back.
    const onScreen = () => {
      const whole = document.fullscreenElement !== null;
      setWholeScreen(whole);
      if (whole) return;
      // In full screen Esc is the browser's: it leaves full screen before the page hears the key.
      // With a figure's working open, that Esc was meant for the working, as it is on the window,
      // so it closes the working and Present carries on on the window (ADR 0091).
      if (drawerOpen.current) {
        setSelected(null);
        return;
      }
      if (Date.now() - notesOpenedAt.current > 3000) stopPresenting();
    };
    const onKey = (event: KeyboardEvent) => {
      // Esc closes an open lineage drawer first; only with nothing open does it end Present.
      if (event.key === "Escape") {
        if (drawerOpen.current) return;
        stopPresenting();
      } else if (event.key === "ArrowRight" || event.key === "PageDown") step(1);
      else if (event.key === "ArrowLeft" || event.key === "PageUp") step(-1);
    };
    document.addEventListener("fullscreenchange", onScreen);
    window.addEventListener("keydown", onKey);
    // Where the browser refused the whole screen the stage only covers the window: the page
    // behind it must not scroll under it.
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onScreen);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = scroll;
    };
  }, [presenting, stopPresenting, step]);
  // The keyboard starts on the stage, not behind it — once, as Present begins, and not again
  // whenever the board reloads under it.
  useEffect(() => {
    if (presenting) stage.current?.focus();
  }, [presenting]);

  /*
   * Presenter notes on another screen follow the month the room is looking at (ADR 0087). One
   * channel for the whole of Present: the notes ask for the month as they open and are answered
   * at once, every step is sent, and the notes are told when Present ends (ADR 0091).
   */
  const shownMonth = period ?? payload?.periods[0] ?? null;
  const shownRef = useRef(shownMonth);
  shownRef.current = shownMonth;
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (!presenting || !live || typeof BroadcastChannel === "undefined") return;
    const open = new BroadcastChannel(presentChannelName(companyId));
    channel.current = open;
    open.onmessage = (event: MessageEvent<unknown>) => {
      const month = shownRef.current;
      if (!isPresentAsk(event.data) || month === null) return;
      const answer: PresentMessage = { kind: "month", period: month };
      open.postMessage(answer);
    };
    return () => {
      const ended: PresentMessage = { kind: "ended" };
      open.postMessage(ended);
      open.close();
      channel.current = null;
    };
  }, [presenting, live, companyId]);
  useEffect(() => {
    if (!presenting || shownMonth === null) return;
    const message: PresentMessage = { kind: "month", period: shownMonth };
    channel.current?.postMessage(message);
  }, [presenting, shownMonth]);
  const openNotes = useCallback(() => {
    notesOpenedAt.current = Date.now();
    window.open(
      `/app/companies/${companyId}/notes${shownMonth === null ? "" : `?period=${shownMonth}`}`,
      `notes-${companyId}`,
      "popup=yes,width=560,height=860",
    );
  }, [companyId, shownMonth]);

  const version = payload?.dashboard?.blueprintVersion ?? null;
  useEffect(() => {
    onVersion?.(version);
  }, [onVersion, version]);

  const calculated = payload?.dashboard?.spec.calculated;
  const label = useMemo(() => labelsFor(calculated ?? []), [calculated]);
  // Each stored value by its key, for the sign a movement's arrow is read from (ADR 0091).
  const storedValues = useMemo(
    () =>
      new Map(
        (payload?.values ?? []).map((v) => [
          metricKey(v.metricId, v.period, v.dims),
          v.value,
        ]),
      ),
    [payload?.values],
  );
  const stored = useCallback((key: string) => storedValues.get(key), [storedValues]);

  const load = useCallback(async () => {
    if (sample !== undefined) {
      setPeriod((p) => p ?? ((sample.periods[0] ?? null) as PeriodId | null));
      return;
    }
    const r = await api<DashboardPayload>(`/api/companies/${companyId}/dashboard`);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setPayload(r.data);
    setPeriod((p) =>
      p !== null && r.data.periods.includes(p)
        ? p
        : ((r.data.periods[0] ?? null) as PeriodId | null),
    );
  }, [companyId, sample]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (payload === null)
    return error === null ? (
      <div className="grid grid-cols-12 gap-4" aria-busy="true" aria-label="Loading">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton col-span-3 h-32" />
        ))}
        <div className="skeleton col-span-8 h-72" />
        <div className="skeleton col-span-4 h-72" />
      </div>
    ) : (
      // A board that did not load says so and offers to try again, rather than leaving a reader
      // with an error and a page reload as the only way on (ADR 0091).
      <div className="flex flex-col gap-3" data-testid="dashboard-load-error">
        <Alert tone="error">{error}</Alert>
        <div>
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              setError(null);
              void load();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );

  if (payload.dashboard === null) {
    return (
      <section
        className="rounded-2xl border border-neutral-200/80 bg-surface p-8 shadow-sm"
        data-testid="dashboard-empty"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-50 text-accent-600">
          <Icon name="chart" size={22} />
        </span>
        <h2 className="mt-4 text-[1.25rem] font-semibold tracking-tight text-neutral-900">
          {payload.latestPeriod === null
            ? "Your dashboard appears here"
            : "Turn this MIS into a live dashboard"}
        </h2>
        {payload.latestPeriod === null ? (
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-neutral-600">
            Upload the company&rsquo;s trial balances first; the dashboard charts their
            figures.
          </p>
        ) : (
          <>
            <p className="mt-2 mb-5 max-w-lg text-sm leading-relaxed text-neutral-600">
              KPIs and charts for every month this company has, each figure one click from
              its source. Ask the assistant alongside about anything you see.
            </p>
            <PaidJobButton
              companyId={companyId}
              type="dashboard_addon"
              label="Build the dashboard"
              busyLabel="Building…"
              icon="chart"
              onHeld={async (jobId) => {
                const r = await api(`/api/jobs/${jobId}/deliver-dashboard`, {
                  body: {},
                  idempotencyKey: newIdempotencyKey(),
                });
                if (!r.ok) setError(r.message);
                await load();
              }}
            />
          </>
        )}
        {error === null ? null : <Alert tone="error">{error}</Alert>}
      </section>
    );
  }

  const dashboard = payload.dashboard;
  const spec = pending?.spec ?? dashboard.spec;
  const format = companyFormat(payload.company.money, payload.company.currencySymbol);
  const current = period ?? ((payload.periods[0] ?? "") as PeriodId);
  // Every file unticked: no month to show. Nothing below may format or chart an empty month.
  const noMonths = payload.periods.length === 0;
  // How the board is being read, in the words Present says it to the room (ADR 0091).
  const lensWords = [
    range === "saved" ? "" : (RANGES.find((r) => r.id === range)?.label ?? ""),
    COMPARISONS.find((c) => c.id === compare)?.said ?? "",
  ]
    .filter((w) => w !== "")
    .join(" · ");
  const display = (v: MetricValue) =>
    v.value === null
      ? "—"
      : formatValue(
          v.value,
          v.unit,
          payload.company.money,
          payload.company.currencySymbol,
        );

  // Only files a run has read can be ticked: a file that fed no month has nothing to show.
  const usedFiles = payload.files
    .filter((x) => x.periods.length > 0)
    .map((x) => ({ ...x, onDashboard: ticks[x.id] ?? x.onDashboard }));
  const tickFile = async (id: string, onDashboard: boolean) => {
    setError(null);
    setTicks((t) => ({ ...t, [id]: onDashboard }));
    const r = await api(`/api/uploads/${id}`, { method: "PATCH", body: { onDashboard } });
    if (!r.ok) setError(r.message);
    // The month being read stays on screen while it is still there; `load` falls back to the
    // newest month only when it is not. Ticking an older file used to jump the board to the
    // newest month every time (ADR 0091). A reader on the newest month follows a newer one that
    // the tick brings back, because that is the month they were reading: the latest.
    if (current === payload.periods[0]) setPeriod(null);
    await load();
    setTicks((t) => {
      const { [id]: _settled, ...rest } = t;
      return rest;
    });
  };

  const propose = async (ops: Operation[]) => {
    setError(null);
    const all = [...(pending?.ops ?? []), ...ops];
    const r = await api<{ spec: DashboardSpec }>(
      `/api/companies/${companyId}/dashboard`,
      {
        body: {
          action: "preview",
          baseVersion: dashboard.blueprintVersion,
          operations: all,
        },
      },
    );
    if (r.ok) setPending({ ops: all, spec: r.data.spec });
    else setError(r.message);
  };

  const commit = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const r = await api(`/api/companies/${companyId}/dashboard`, {
      body: { ...body, baseVersion: dashboard.blueprintVersion },
      idempotencyKey: newIdempotencyKey(),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setPending(null);
    await load();
  };

  return (
    <div className="flex flex-col gap-4">
      {live &&
      payload.latestPeriod !== null &&
      (dashboard.dataThrough === null || payload.latestPeriod > dashboard.dataThrough) ? (
        <Panel title="A newer month is available" icon="refresh">
          <p className="mb-3 text-sm text-neutral-600">
            {dashboard.dataThrough === null
              ? `Refresh the dashboard to include ${format.period(payload.latestPeriod)}.`
              : `The dashboard shows months up to ${format.period(dashboard.dataThrough)}. Refresh it to include ${format.period(payload.latestPeriod)}.`}
          </p>
          <PaidJobButton
            companyId={companyId}
            type="dashboard_refresh"
            label="Refresh the dashboard"
            icon="refresh"
            onHeld={async (jobId) => {
              const r = await api(`/api/jobs/${jobId}/deliver-dashboard`, {
                body: {},
                idempotencyKey: newIdempotencyKey(),
              });
              if (!r.ok) setError(r.message);
              setPeriod(null);
              await load();
            }}
          />
        </Panel>
      ) : null}
      <p
        className="hidden text-[0.8125rem] text-neutral-600"
        data-print="show"
        aria-hidden="true"
      >
        {noMonths ? "" : format.period(current)} · {format.units}
      </p>
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-surface px-4 py-3 shadow-sm"
        data-print="hide"
      >
        {/* Wraps rather than running out of the toolbar beside the rail and the chat (ADR 0091). */}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[0.8125rem] font-medium text-neutral-600">
            <span>Month</span>
            <select
              className={SELECT}
              value={current}
              onChange={(e) => {
                setPeriod(e.target.value as PeriodId);
              }}
              title="The month every box is anchored to."
              data-testid="period-filter"
            >
              {payload.periods.map((p) => (
                <option key={p} value={p}>
                  {format.period(p)}
                </option>
              ))}
            </select>
          </label>
          {/*
           * Reading the board differently is not changing it (ADR 0064). Range retargets every
           * box that shows several months; Compare sets what they are measured against. Both
           * are free — no message, no AI call — because they only re-read figures the engine
           * has already computed, and neither is written to the saved dashboard.
           */}
          <label className="flex items-center gap-2 text-[0.8125rem] font-medium text-neutral-600">
            <span>Range</span>
            <select
              className={SELECT}
              value={range}
              onChange={(e) => {
                setRange(e.target.value as RangeChoice);
              }}
              title="The window for boxes that show several months: trends and tables. Cards, comparisons, splits and the waterfall keep the one month chosen under Month."
              data-testid="range-filter"
            >
              {RANGES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[0.8125rem] font-medium text-neutral-600">
            <span>Compare</span>
            <select
              className={SELECT}
              value={compare}
              onChange={(e) => {
                setCompare(e.target.value as CompareChoice);
              }}
              title="What boxes are measured against, where a box can hold a comparison: comparison boxes, and line and bar charts against last year."
              data-testid="compare-filter"
            >
              {COMPARISONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {/* ADR 0034: the reader never has to work out the currency or the scale. */}
          <span
            className="hidden rounded-full bg-neutral-100 px-2.5 py-1 text-[0.75rem] font-medium text-neutral-600 sm:inline"
            data-testid="dashboard-units"
          >
            {format.units}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {live ? (
            <Button
              variant="secondary"
              icon="file"
              onClick={() => {
                setFilesOpen(true);
              }}
              data-testid="dashboard-files"
            >
              {/* Not "Files": that is Files and settings, in the header beside it. */}
              Files shown
              <span className="num ml-1 rounded-full bg-neutral-100 px-1.5 text-[0.6875rem] text-neutral-600">
                {usedFiles.filter((x) => x.onDashboard).length.toString()} of{" "}
                {usedFiles.length.toString()}
              </span>
            </Button>
          ) : null}
          {live && dashboard.canUndo && pending === null ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void commit({ action: "undo" })}
            >
              Undo last change
            </Button>
          ) : null}
          {live ? (
            <Button
              variant="secondary"
              onClick={() => {
                setEditing((e) => !e);
              }}
            >
              {editing ? "Done editing" : "Edit layout"}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            icon="play"
            onClick={present}
            disabled={pending !== null || noMonths}
            title={
              pending !== null
                ? "Apply or discard the layout changes first"
                : "Show the dashboard full screen"
            }
            data-testid="present"
          >
            Present
          </Button>
          {/* A read-only copy for someone without an account (ADR 0090). */}
          {live ? (
            <Button
              variant="secondary"
              icon="external"
              onClick={() => {
                setShareOpen(true);
              }}
              disabled={pending !== null || noMonths}
              data-testid="share"
            >
              Share
            </Button>
          ) : null}
          {/*
           * A board member's first question is not "what happened" but "what do we do", so the
           * button that answers it sits on the board rather than behind the assistant's month
           * picker (ADR 0063). It runs on the month the board is showing.
           *
           * It is the last thing in the row, the only filled one and a size up, and Present
           * stepped down to secondary to make room: a header with two primaries has no hierarchy
           * at all. The weight is the design system's own — the accent, a size, a font step and
           * the existing lift — and never a gradient or a glow (ADR 0036).
           */}
          {live ? (
            <Button
              size="lg"
              icon="target"
              className="lift font-semibold"
              onClick={() => {
                onWhereToAct(current);
              }}
              disabled={pending !== null || noMonths}
              title={
                pending !== null
                  ? "Apply or discard the layout changes first"
                  : "Suggestions the board can act on, for this month"
              }
              data-testid="where-to-act"
            >
              Where to act
            </Button>
          ) : null}
        </div>
      </div>
      {noMonths || (range === "saved" && compare === "saved") ? null : (
        <LensNote
          widgets={spec.widgets}
          values={payload.values}
          period={current}
          fyStartMonth={payload.company.fyStartMonth}
          money={payload.company.money}
          currencySymbol={payload.company.currencySymbol}
          label={label}
          lens={lens}
          onReset={() => {
            setRange("saved");
            setCompare("saved");
          }}
        />
      )}

      {(() => {
        // The owner's alerts that the month on screen trips (ADR 0087): said in words here,
        // where the figures are; the email about them says only how many.
        const fired = noMonths
          ? []
          : firedAlerts(payload.alerts ?? [], payload.values, current).map(
              (f) => f.rule as BoardAlert,
            );
        return fired.length === 0 ? null : (
          <p
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-warning/30 bg-warning-subtle px-4 py-2.5 text-[0.8125rem] text-neutral-800"
            data-testid="board-alerts"
          >
            <Icon name="alert" size={14} className="text-warning" />
            <span className="font-medium">
              {fired.length === 1 ? "An alert" : `${fired.length.toString()} alerts`} for{" "}
              {format.period(current)}:
            </span>
            {fired
              .map((a) =>
                alertWords(a, payload.company.money, payload.company.currencySymbol),
              )
              .join(" · ")}
            {live ? (
              <a
                href={`/app/companies/${companyId}/manage#alerts`}
                className="ml-auto font-medium text-accent-700 underline underline-offset-2"
              >
                Change alerts
              </a>
            ) : null}
          </p>
        );
      })()}
      {!live || payload.hiddenPeriods.length === 0 ? null : (
        <p
          className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-neutral-600"
          data-testid="hidden-months"
        >
          <Icon name="file" size={14} className="text-neutral-400" />
          {/* Named, not counted: "4 months are left out" left the reader to find which. */}
          {monthList(payload.hiddenPeriods.map((p) => format.period(p)))}{" "}
          {payload.hiddenPeriods.length === 1 ? "is" : "are"} left out, because the files
          they came from are unticked.
          <button
            type="button"
            className="font-medium text-accent-700 underline underline-offset-2"
            onClick={() => {
              setFilesOpen(true);
            }}
          >
            Choose files
          </button>
        </p>
      )}
      {/* Only with a month to share: with every file unticked there is none, and no label. */}
      {live && !noMonths ? (
        <ShareBoard
          companyId={companyId}
          month={current}
          monthLabel={format.period(current)}
          lensSet={range !== "saved" || compare !== "saved"}
          open={shareOpen}
          onClose={() => {
            setShareOpen(false);
          }}
        />
      ) : null}
      <Drawer
        open={filesOpen}
        label="Files on this dashboard"
        onClose={() => {
          setFilesOpen(false);
        }}
      >
        <div className="flex flex-col gap-4" data-testid="files-drawer">
          <div>
            <h2 className="text-[1.0625rem] font-semibold text-neutral-900">
              Files on this dashboard
            </h2>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-neutral-600">
              The dashboard shows the months of the files you tick. Untick one and its
              months, and every figure worked out from them, leave the board. Nothing is
              recomputed, deleted or charged; tick it again and they are back.
            </p>
          </div>
          {usedFiles.length === 0 ? (
            <p className="text-[0.8125rem] text-neutral-500">
              No file has been processed for this company yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100 rounded-xl border border-neutral-200/80 bg-surface">
              {usedFiles.map((x) => (
                <li key={x.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3.5 py-3 hover:bg-neutral-25">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-accent-600"
                      checked={x.onDashboard}
                      disabled={x.id in ticks}
                      onChange={(e) => void tickFile(x.id, e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[0.8125rem] font-medium text-neutral-900">
                        {x.fileName}
                        {x.deleted ? (
                          <span className="ml-1.5 font-normal text-neutral-500">
                            (deleted; its months stay hidden until ticked)
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-[0.75rem] text-neutral-500">
                        {monthsLabel(x.periods)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/app/companies/${companyId}/run`} icon="upload" size="sm">
              Add a file
            </ButtonLink>
            <ButtonLink
              href={`/app/companies/${companyId}/manage`}
              variant="secondary"
              size="sm"
            >
              All files and settings
            </ButtonLink>
          </div>
        </div>
      </Drawer>

      {pending === null ? null : (
        <Alert tone="warning" title="Unsaved layout changes">
          <div className="flex flex-wrap items-center gap-3">
            <span data-testid="patch-preview">
              Previewing {pending.ops.length} change{pending.ops.length === 1 ? "" : "s"}.
              Nothing is saved until you apply.
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void commit({ action: "apply", operations: pending.ops })}
              >
                Apply
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setPending(null);
                }}
              >
                Discard
              </Button>
            </span>
          </div>
        </Alert>
      )}
      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {/* The stage holds the grid and the lineage drawer, so a figure can still be traced to its
          source while presenting: only what is inside the full-screen element is visible. */}
      <div
        ref={stage}
        className={
          presenting
            ? "canvas-grid fixed inset-0 z-50 overflow-y-auto bg-canvas px-10 py-8"
            : undefined
        }
        data-presenting={presenting ? "true" : "false"}
        data-testid="stage"
        {...(presenting
          ? {
              role: "dialog",
              "aria-modal": true,
              "aria-label": `${payload.company.name}, presented`,
              tabIndex: -1,
              // A modal keeps Tab inside it (ADR 0091); an open working keeps it inside itself.
              onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
                if (!drawerOpen.current && stage.current !== null)
                  keepTabInside(stage.current, event);
              },
            }
          : {})}
      >
        {presenting ? (
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">{format.units}</p>
              {/* The client's own mark beside its name: the room is looking at their business. */}
              <div className="mt-1 flex items-center gap-4">
                {logoUrl === null ? null : (
                  <CompanyLogo src={logoUrl} name={payload.company.name} size={56} />
                )}
                <h2 className="display text-[2rem] leading-tight font-semibold tracking-tight text-neutral-900">
                  {payload.company.name}
                </h2>
              </div>
              <p
                className="mt-0.5 text-[1.0625rem] text-neutral-600"
                data-testid="present-period"
              >
                {noMonths ? "" : format.period(current)}
              </p>
              {/* A room shown twelve months against last year is told so, not only the month. */}
              {lensWords === "" ? null : (
                <p
                  className="mt-0.5 text-[0.875rem] text-neutral-600"
                  data-testid="present-lens"
                >
                  {lensWords}
                </p>
              )}
              {preparer === null ? null : (
                <p
                  className="mt-2 flex items-center gap-2 text-[0.8125rem] text-neutral-500"
                  data-testid="present-preparer"
                >
                  {preparer.logoUrl === null ? null : (
                    <CompanyLogo src={preparer.logoUrl} name={preparer.name} size={24} />
                  )}
                  Prepared by {preparer.name}
                </p>
              )}
            </div>
            {/* Quieter than the board, but never below a readable contrast: at 60% the
                labels fell under 4:1 until hovered (ADR 0091). */}
            <div className="flex items-center gap-1.5 opacity-80 transition-opacity focus-within:opacity-100 hover:opacity-100">
              {/* The commentary and where to act, on the presenter's own screen (ADR 0087). */}
              {live ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="document"
                  title="Open the month's commentary and suggestions in a window of their own"
                  onClick={openNotes}
                  data-testid="present-notes"
                >
                  Notes
                </Button>
              ) : null}
              {wholeScreen ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="play"
                  title="Give the board the whole screen again"
                  onClick={() => {
                    const el = stage.current;
                    if (el !== null && typeof el.requestFullscreen === "function")
                      void el.requestFullscreen().catch(() => undefined);
                  }}
                  data-testid="present-full-screen"
                >
                  Full screen
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon="arrow-left"
                aria-label="Earlier month"
                title="Earlier month (Left arrow)"
                disabled={payload.periods.indexOf(current) >= payload.periods.length - 1}
                onClick={() => {
                  step(-1);
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                icon="arrow-right"
                aria-label="Later month"
                title="Later month (Right arrow)"
                disabled={payload.periods.indexOf(current) <= 0}
                onClick={() => {
                  step(1);
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                icon="close"
                onClick={stopPresenting}
                data-testid="present-exit"
              >
                Exit
              </Button>
            </div>
          </header>
        ) : null}
        {noMonths ? (
          <section
            className="rounded-2xl border border-neutral-200/80 bg-surface p-8 shadow-sm"
            data-testid="dashboard-all-hidden"
          >
            <h2 className="text-[1.125rem] font-semibold text-neutral-900">
              No file is ticked, so there is nothing on the board
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-neutral-600">
              The dashboard shows the months of the files you tick. Every figure is still
              stored; tick a file and its months are back.
            </p>
            <div className="mt-4">
              <Button
                icon="file"
                onClick={() => {
                  setFilesOpen(true);
                }}
              >
                Choose files
              </Button>
            </div>
          </section>
        ) : null}
        <div
          className="@container grid grid-cols-12 gap-4"
          data-testid="dashboard-grid"
          hidden={noMonths}
        >
          {(noMonths ? [] : spec.widgets).map((w, i) => (
            <WidgetCard
              key={w.id}
              widget={w}
              index={i}
              count={spec.widgets.length}
              values={payload.values}
              period={current}
              payload={payload}
              editing={editing && !presenting}
              presenting={presenting}
              label={label}
              onOpen={setSelected}
              onEdit={(ops) => void propose(ops)}
              onInvestigate={onInvestigate}
              onChangeBox={onChangeBox}
              lens={lens}
              explore={live}
              stored={stored}
            />
          ))}
        </div>
        {presenting || noMonths ? null : (
          <ChecksLine
            checks={payload.checks?.[current] ?? []}
            month={format.period(current)}
            ledgerMap={live ? `/app/companies/${companyId}/ledgers` : null}
            onFiles={
              live
                ? () => {
                    setFilesOpen(true);
                  }
                : null
            }
          />
        )}
        {/* Not while presenting: there the accountant is the reviewer, speaking to their client. */}
        {presenting ? null : (
          <MistakesNote className="mt-3">
            Open any figure to see the ledgers behind it.
          </MistakesNote>
        )}
        <Drawer
          open={selected !== null}
          label="Lineage"
          onClose={() => {
            setSelected(null);
          }}
          closeButton={false}
        >
          {selected === null ? null : (
            <LineagePanel
              selected={selected}
              values={payload.values}
              label={label}
              display={display}
              onSelect={setSelected}
              onClose={() => {
                setSelected(null);
              }}
            />
          )}
        </Drawer>
      </div>
    </div>
  );
}
