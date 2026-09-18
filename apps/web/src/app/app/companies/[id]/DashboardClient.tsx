"use client";

/**
 * Dashboard (SPEC §24.2): widgets from the stored spec over the company's stored metric values.
 * It is the main surface of the company workspace (ADR 0033). Every number opens its lineage in
 * a drawer, and Investigate hands a question to the assistant beside it. Edits are JSON Patch operations: previewed, applied on
 * confirmation as a new blueprint version, and undoable.
 */

import type { NumberFormatOptions } from "@magicmis/core/format";
import type { PeriodId } from "@magicmis/core/time";
import type { MetricValue } from "@magicmis/engine";
import {
  buildWidgetView,
  companyFormat,
  formatValue,
  type DashboardSpec,
  type ValueRef,
  type Widget,
} from "@magicmis/render-dashboard";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import { Sparkline } from "@/components/Charts";
import { Drawer } from "@/components/Drawer";
import { EChart } from "@/components/EChart";
import { LineagePanel } from "@/components/LineagePanel";
import { PaidJobButton } from "@/components/PaidJobButton";
import { RollingNumber } from "@/components/RollingNumber";
import { Icon } from "@/components/Icon";
import { Alert, Button, Panel } from "@/components/ui";
import { api, newIdempotencyKey } from "@/lib/client-api";

interface Payload {
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
}

type Operation = Record<string, unknown>;

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

function ValueButton({
  value,
  onOpen,
  rolling = false,
}: {
  value: ValueRef;
  onOpen: (key: string) => void;
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
      data-metric-key={value.metricKey}
    >
      {rolling ? <RollingNumber value={value.display} /> : value.display}
    </button>
  );
}

/**
 * The last twelve months of a metric, for the sparkline beside its headline (ADR 0036). Chart
 * values only, never a displayed figure: the number on the card is the one that is read.
 */
function trendOf(values: readonly MetricValue[], metricId: string): number[] {
  return values
    .filter(
      (v) =>
        v.metricId === metricId && v.value !== null && Object.keys(v.dims).length === 0,
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
  onOpen,
  onEdit,
  onInvestigate,
}: {
  widget: Widget;
  index: number;
  count: number;
  values: MetricValue[];
  period: PeriodId;
  payload: Payload;
  editing: boolean;
  onOpen: (key: string) => void;
  onEdit: (ops: Operation[]) => void;
  onInvestigate: (metric: string, period: PeriodId) => void;
}) {
  const format = useMemo(
    () => companyFormat(payload.company.money, payload.company.currencySymbol),
    [payload.company.money],
  );
  const view = useMemo(
    () =>
      buildWidgetView(widget, values, {
        period,
        fyStartMonth: payload.company.fyStartMonth,
        format,
        dimensionFilter: null,
      }),
    [widget, values, period, payload.company.fyStartMonth, format],
  );
  const path = `/widgets/${index.toString()}`;
  const trend =
    widget.kind === "kpi_card" ? trendOf(values, widget.metrics[0] ?? "") : [];
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
        <h3 className="eyebrow">{widget.title}</h3>
        {!editing && trend.length >= 3 ? (
          <span className="-mt-1.5 shrink-0 opacity-90" title="Last twelve months">
            <Sparkline values={trend} width={88} height={26} />
          </span>
        ) : null}
        {editing ? (
          <div className="-mt-1 -mr-1 flex gap-0.5">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-300 disabled:hover:bg-transparent"
              onClick={() => {
                const title = window.prompt("Widget title", widget.title);
                if (title !== null && title.trim() !== "")
                  onEdit([{ op: "replace", path: `${path}/title`, value: title.trim() }]);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-300 disabled:hover:bg-transparent"
              disabled={index === 0}
              onClick={() => {
                onEdit([
                  { op: "move", from: path, path: `/widgets/${(index - 1).toString()}` },
                ]);
              }}
            >
              Earlier
            </button>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-300 disabled:hover:bg-transparent"
              disabled={index === count - 1}
              onClick={() => {
                onEdit([
                  { op: "move", from: path, path: `/widgets/${(index + 1).toString()}` },
                ]);
              }}
            >
              Later
            </button>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-300 disabled:hover:bg-transparent"
              onClick={() => {
                onEdit([
                  { op: "test", path: `${path}/id`, value: widget.id },
                  { op: "remove", path },
                ]);
              }}
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
      {view.kind === "empty" ? (
        <p className="text-[0.8125rem] text-neutral-500">{view.reason}</p>
      ) : view.kind === "kpi" ? (
        <div className="flex flex-1 flex-col">
          <div className="num text-[1.75rem] leading-none font-semibold tracking-tight whitespace-nowrap text-neutral-900">
            {view.values[0] === undefined ? (
              "—"
            ) : (
              <ValueButton value={view.values[0]} onOpen={onOpen} rolling />
            )}
          </div>
          {view.values.length < 2 ? null : (
            <dl className="mt-3 flex flex-wrap gap-1.5 text-[0.75rem]">
              {view.values.slice(1).map((v) => {
                const down = v.display.startsWith("-") || v.display.startsWith("(");
                return (
                  <div
                    key={v.metricKey}
                    className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pr-2 pl-1.5"
                  >
                    <dt className="sr-only">{movementLabel(v.metricKey, format)}</dt>
                    <Icon
                      name={down ? "arrow-down" : "arrow-up"}
                      size={11}
                      className={down ? "text-negative" : "text-positive"}
                    />
                    <dd className="num font-medium text-neutral-700">
                      <ValueButton value={v} onOpen={onOpen} />
                    </dd>
                    <span className="text-neutral-400">
                      {movementLabel(v.metricKey, format)}
                    </span>
                  </div>
                );
              })}
            </dl>
          )}
          {/* SPEC §27: Investigate sends a Deep question about this metric's movement. */}
          <button
            type="button"
            className="mt-auto -mb-1 -ml-2 inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 pt-1 text-[0.75rem] font-medium text-accent-700 hover:bg-accent-50"
            onClick={() => {
              onInvestigate(widget.metrics[0] ?? "", period);
            }}
          >
            <Icon name="search" size={12} />
            Investigate
          </button>
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
                      <ValueButton value={c} onOpen={onOpen} />
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
          <details className="mt-3 border-t border-neutral-100 pt-2 text-[0.75rem] text-neutral-500">
            <summary className="cursor-pointer select-none hover:text-neutral-900">
              Values
            </summary>
            <ul className="mt-1 flex flex-col gap-1">
              {view.points
                .flat()
                .filter((p) => p.metricKey !== "")
                .map((p) => (
                  <li key={p.metricKey} className="flex items-baseline gap-2">
                    <span className="truncate">
                      {format.label(p.metricKey.split("@")[0] ?? "")}
                      {", "}
                      {format.period(p.metricKey.split("@")[1] ?? "")}
                    </span>
                    <span className="num ml-auto">
                      <ValueButton value={p} onOpen={onOpen} />
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}

export function DashboardClient({
  companyId,
  onInvestigate,
  reloadKey,
}: {
  companyId: string;
  onInvestigate: (metric: string, period: PeriodId) => void;
  /** Changes when the layout was changed elsewhere (the assistant), to load it again. */
  reloadKey: number;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodId | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<{
    ops: Operation[];
    spec: DashboardSpec;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<Payload>(`/api/companies/${companyId}/dashboard`);
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
  }, [companyId]);

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
      <Alert tone="error">{error}</Alert>
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
  const display = (v: MetricValue) =>
    v.value === null
      ? "—"
      : formatValue(
          v.value,
          v.unit,
          payload.company.money,
          payload.company.currencySymbol,
        );

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
      {payload.latestPeriod !== null &&
      (dashboard.dataThrough === null || payload.latestPeriod > dashboard.dataThrough) ? (
        <Panel title="A newer month is available" icon="refresh">
          <p className="mb-3 text-sm text-neutral-600">
            The dashboard shows months up to{" "}
            {dashboard.dataThrough === null ? "—" : format.period(dashboard.dataThrough)}.
            Refresh it to include {format.period(payload.latestPeriod)}.
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
        {format.period(current)} · {format.units}
      </p>
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-surface px-4 py-3 shadow-sm"
        data-print="hide"
      >
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[0.8125rem] font-medium text-neutral-600">
            <span>Month</span>
            <select
              className="h-9 rounded-md border border-neutral-200 bg-surface px-2.5 text-[0.8125rem] font-medium text-neutral-900 hover:border-neutral-300"
              value={current}
              onChange={(e) => {
                setPeriod(e.target.value as PeriodId);
              }}
              data-testid="period-filter"
            >
              {payload.periods.map((p) => (
                <option key={p} value={p}>
                  {format.period(p)}
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
        <div className="flex gap-2">
          {dashboard.canUndo && pending === null ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void commit({ action: "undo" })}
            >
              Undo last change
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => {
              setEditing((e) => !e);
            }}
          >
            {editing ? "Done editing" : "Edit layout"}
          </Button>
        </div>
      </div>

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

      <div className="@container grid grid-cols-12 gap-4" data-testid="dashboard-grid">
        {spec.widgets.map((w, i) => (
          <WidgetCard
            key={w.id}
            widget={w}
            index={i}
            count={spec.widgets.length}
            values={payload.values}
            period={current}
            payload={payload}
            editing={editing}
            onOpen={setSelected}
            onEdit={(ops) => void propose(ops)}
            onInvestigate={onInvestigate}
          />
        ))}
      </div>
      <Drawer
        open={selected !== null}
        label="Lineage"
        onClose={() => {
          setSelected(null);
        }}
      >
        {selected === null ? null : (
          <LineagePanel
            selected={selected}
            values={payload.values}
            label={
              companyFormat(payload.company.money, payload.company.currencySymbol).label
            }
            display={display}
            onSelect={setSelected}
            onClose={() => {
              setSelected(null);
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
