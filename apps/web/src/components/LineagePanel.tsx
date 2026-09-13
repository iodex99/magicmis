"use client";

/**
 * Lineage for one displayed number (SPEC §24.2): its label, exact value, formula, and inputs. A
 * metric input opens that metric's lineage; a source input names the file, sheet and filter.
 */

import type { MetricValue } from "@magicmis/engine";
import { metricKey } from "@magicmis/render-dashboard";

import { Button } from "@/components/ui";

export function LineagePanel({
  selected,
  values,
  label,
  display,
  onSelect,
  onClose,
}: {
  selected: string;
  values: readonly MetricValue[];
  label: (metricId: string) => string;
  display: (v: MetricValue) => string;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const value = values.find((v) => metricKey(v.metricId, v.period, v.dims) === selected);
  return (
    <aside
      className="rounded-lg border border-neutral-200 bg-white p-4 text-sm"
      data-testid="lineage-panel"
      aria-label="Lineage"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="font-semibold text-neutral-900">
          {value === undefined ? "Not available" : label(value.metricId)}
        </h2>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
      {value === undefined ? (
        <p className="text-neutral-700">
          This value is not in the stored data for the company.
        </p>
      ) : (
        <dl className="flex flex-col gap-2">
          <div>
            <dt className="text-neutral-600">Month</dt>
            <dd>{value.period}</dd>
          </div>
          {Object.keys(value.dims).length > 0 ? (
            <div>
              <dt className="text-neutral-600">Split</dt>
              <dd>
                {Object.entries(value.dims)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ")}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-neutral-600">Value</dt>
            <dd className="tabular-nums" data-testid="lineage-value">
              {value.value === null
                ? `Not available (${value.nullReason?.replace(/_/gu, " ") ?? ""})`
                : display(value)}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-600">Metric ID</dt>
            <dd className="font-mono text-xs">{value.metricId}</dd>
          </div>
          <div>
            <dt className="text-neutral-600">Formula</dt>
            <dd className="font-mono text-xs">{value.formula}</dd>
          </div>
          {value.inputs.length > 0 ? (
            <div>
              <dt className="text-neutral-600">Inputs</dt>
              <dd>
                <ul className="flex flex-col gap-1">
                  {value.inputs.map((input, i) => (
                    <li key={i}>
                      {input.kind === "metric" ? (
                        <button
                          type="button"
                          className="text-accent-700 underline"
                          onClick={() => {
                            onSelect(metricKey(input.metricId, input.period));
                          }}
                        >
                          {label(input.metricId)} ({input.period})
                        </button>
                      ) : input.kind === "source" ? (
                        <span>
                          {input.description} — sheet {input.sheet}, column {input.column}
                          , {input.rows} rows
                        </span>
                      ) : (
                        <span>
                          MIS head {input.head}, {input.field} for {input.period}, from{" "}
                          {input.ledgers} ledgers
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
      )}
    </aside>
  );
}
