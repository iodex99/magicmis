"use client";

/**
 * Dashboard (SPEC §24.2): widgets from the stored spec over the company's stored metric values.
 * Every number opens its lineage. Edits are JSON Patch operations: previewed, applied on
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
import { useCallback, useEffect, useMemo, useState } from "react";

import { EChart } from "@/components/EChart";
import { LineagePanel } from "@/components/LineagePanel";
import { PaidJobButton } from "@/components/PaidJobButton";
import { Alert, Button, Panel } from "@/components/ui";
import { api, newIdempotencyKey } from "@/lib/client-api";

interface Payload {
  company: { id: string; name: string; fyStartMonth: number; money: NumberFormatOptions };
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

function ValueButton({
  value,
  onOpen,
}: {
  value: ValueRef;
  onOpen: (key: string) => void;
}) {
  return (
    <button
      type="button"
      className="tabular-nums underline decoration-neutral-300 underline-offset-4 hover:decoration-accent-600"
      onClick={() => {
        onOpen(value.metricKey);
      }}
      data-metric-key={value.metricKey}
    >
      {value.display}
    </button>
  );
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
}) {
  const format = useMemo(
    () => companyFormat(payload.company.money),
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
  return (
    <section
      className="flex flex-col rounded-xl border border-neutral-200/80 bg-white p-4 shadow-sm"
      style={{
        gridColumn: `span ${widget.layout.w.toString()} / span ${widget.layout.w.toString()}`,
        minHeight: `${(widget.layout.h * 4).toString()}rem`,
      }}
      data-testid={`widget-${widget.id}`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="eyebrow">{widget.title}</h3>
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
        <div className="flex flex-col gap-1">
          {view.values.map((v, i) => (
            <div
              key={v.metricKey}
              className={
                i === 0
                  ? "text-[1.75rem] leading-none font-semibold tracking-tight text-neutral-900"
                  : "text-[0.8125rem] text-neutral-500"
              }
            >
              <ValueButton value={v} onOpen={onOpen} />
            </div>
          ))}
          {/* SPEC §27: Investigate sends a Deep question about this metric's movement. */}
          <a
            className="mt-3 inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 text-[0.75rem] font-medium text-accent-700 hover:bg-accent-50"
            href={`/app/companies/${payload.company.id}/chat?investigate=${encodeURIComponent(widget.metrics[0] ?? "")}&period=${period}`}
          >
            Investigate
          </a>
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
        <div className="flex-1">
          <EChart
            option={view.option}
            label={widget.title}
            onPoint={(s, d) => {
              const key = view.points[s]?.[d]?.metricKey;
              if (key !== undefined && key !== "") onOpen(key);
            }}
          />
          {/* The same values as text: every charted number is reachable without a pointer. */}
          <details className="mt-3 text-[0.75rem] text-neutral-600">
            <summary className="cursor-pointer select-none hover:text-neutral-900">
              Values
            </summary>
            <ul className="mt-1 flex flex-col gap-1">
              {view.points
                .flat()
                .filter((p) => p.metricKey !== "")
                .map((p) => (
                  <li key={p.metricKey}>
                    {p.metricKey.split("@")[0]} {p.metricKey.split("@")[1]}:{" "}
                    <ValueButton value={p} onOpen={onOpen} />
                  </li>
                ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}

export function DashboardClient({ companyId }: { companyId: string }) {
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
  }, [load]);

  if (payload === null)
    return error === null ? (
      <p className="text-sm text-neutral-500">Loading…</p>
    ) : (
      <Alert tone="error">{error}</Alert>
    );

  if (payload.dashboard === null) {
    return (
      <Panel
        title="Add a dashboard"
        icon="chart"
        description="Charts and KPIs over the months this company already has."
      >
        {payload.latestPeriod === null ? (
          <p className="text-sm text-neutral-600">
            Run the company setup first; the dashboard shows its figures.
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-neutral-600">
              The dashboard charts this company's MIS figures, month by month. It is kept
              with the company; after a monthly refresh, a dashboard refresh brings in the
              new month.
            </p>
            <PaidJobButton
              companyId={companyId}
              type="dashboard_addon"
              label="Get price"
              deliveries={["standard"]}
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
      </Panel>
    );
  }

  const dashboard = payload.dashboard;
  const spec = pending?.spec ?? dashboard.spec;
  const current = period ?? ((payload.periods[0] ?? "") as PeriodId);
  const display = (v: MetricValue) =>
    v.value === null ? "—" : formatValue(v.value, v.unit, payload.company.money);

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
            {dashboard.dataThrough === null
              ? "—"
              : companyFormat(payload.company.money).period(dashboard.dataThrough)}
            . Refresh it to include{" "}
            {companyFormat(payload.company.money).period(payload.latestPeriod)}.
          </p>
          <PaidJobButton
            companyId={companyId}
            type="dashboard_refresh"
            label="Get refresh price"
            deliveries={["standard"]}
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
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
        <label className="flex flex-col gap-1 text-[0.75rem] font-medium text-neutral-500">
          <span>Month</span>
          <select
            className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[0.8125rem] text-neutral-900 hover:border-neutral-300"
            value={current}
            onChange={(e) => {
              setPeriod(e.target.value as PeriodId);
            }}
            data-testid="period-filter"
          >
            {payload.periods.map((p) => (
              <option key={p} value={p}>
                {companyFormat(payload.company.money).period(p)}
              </option>
            ))}
          </select>
        </label>
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

      <div className="flex gap-4">
        <div className="grid flex-1 grid-cols-12 gap-4" data-testid="dashboard-grid">
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
            />
          ))}
        </div>
        {selected === null ? null : (
          <div className="w-80 shrink-0">
            <LineagePanel
              selected={selected}
              values={payload.values}
              label={companyFormat(payload.company.money).label}
              display={display}
              onSelect={setSelected}
              onClose={() => {
                setSelected(null);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
