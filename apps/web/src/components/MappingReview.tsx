"use client";

/**
 * Mapping review (SPEC §19). Rendered only inside a paid setup or refresh job in
 * `awaiting_review` (SPEC §2.3); the job pages wire it in (Phase 6). All rules — filters,
 * grouping, bulk reassign, confirmation gating — live in `@magicmis/semantic`'s review model;
 * this component only draws it.
 */

import { formatPaise } from "@magicmis/core/format";
import { paise } from "@magicmis/core/money";
import {
  acceptAllAsProposed,
  canConfirm,
  confirm,
  currentHead,
  filterRows,
  groupByHead,
  initialReview,
  MAPPABLE_HEADS,
  reassign,
  rowNeedsReview,
  setApplyToAll,
  type MappingSource,
  type ReviewFilter,
  type ReviewRow,
} from "@magicmis/semantic";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Alert, Button } from "./ui";

const SOURCE_LABELS: Record<MappingSource, string> = {
  company_rule: "Your rule",
  account_rule: "Your account rule",
  global_exact: "Library",
  global_alias: "Library",
  global_fuzzy: "Close match",
  group_default: "Tally group",
  ai: "Suggested",
  none: "Not mapped",
};

export function MappingReview({
  rows,
  onConfirm,
}: {
  rows: readonly ReviewRow[];
  onConfirm: (confirmed: ReturnType<typeof confirm>) => void;
}) {
  const [state, setState] = useState(() => initialReview(rows));
  const [filter, setFilter] = useState<ReviewFilter>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkHead, setBulkHead] = useState("");
  const tableRef = useRef<HTMLTableElement>(null);

  const visible = useMemo(() => filterRows(state, filter), [state, filter]);
  const groups = useMemo(() => groupByHead(state, visible), [state, visible]);
  const gate = canConfirm(state);

  const toggle = (key: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Full keyboard navigation: arrow keys move between row checkboxes; space toggles.
  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const boxes = [
      ...(tableRef.current?.querySelectorAll<HTMLInputElement>("input[data-row]") ?? []),
    ];
    const i = boxes.findIndex((b) => b === document.activeElement);
    const next =
      boxes[
        Math.min(boxes.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))
      ];
    next?.focus();
    e.preventDefault();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 text-sm" role="search">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filter.needsReviewOnly === true}
            onChange={(e) => {
              setFilter({ ...filter, needsReviewOnly: e.target.checked });
            }}
          />
          Needs review only
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filter.unmappedOnly === true}
            onChange={(e) => {
              setFilter({ ...filter, unmappedOnly: e.target.checked });
            }}
          />
          Unmapped only
        </label>
        <label className="flex flex-col">
          Head
          <select
            className="rounded border px-2 py-1"
            value={filter.head ?? ""}
            onChange={(e) => {
              setFilter({
                ...filter,
                head: e.target.value === "" ? undefined : e.target.value,
              });
            }}
          >
            <option value="">All heads</option>
            {MAPPABLE_HEADS.map((h) => (
              <option key={h.code} value={h.code}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Source
          <select
            className="rounded border px-2 py-1"
            value={filter.source ?? ""}
            onChange={(e) => {
              setFilter({
                ...filter,
                source:
                  e.target.value === "" ? undefined : (e.target.value as MappingSource),
              });
            }}
          >
            <option value="">All sources</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Search
          <input
            className="rounded border px-2 py-1"
            type="search"
            value={filter.search ?? ""}
            onChange={(e) => {
              setFilter({ ...filter, search: e.target.value });
            }}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col">
          Reassign selected to
          <select
            className="rounded border px-2 py-1"
            value={bulkHead}
            onChange={(e) => {
              setBulkHead(e.target.value);
            }}
          >
            <option value="">Choose a head</option>
            {MAPPABLE_HEADS.map((h) => (
              <option key={h.code} value={h.code}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={bulkHead === "" || selected.size === 0}
          onClick={() => {
            setState((s) => reassign(s, [...selected], bulkHead));
            setSelected(new Set());
          }}
        >
          Reassign {selected.size} selected
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table ref={tableRef} className="w-full text-sm" onKeyDown={onKeyDown}>
          <thead>
            <tr className="text-left text-xs text-neutral-600">
              <th className="px-2 py-1">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-2 py-1">Ledger or column</th>
              <th className="px-2 py-1">Parent group</th>
              <th className="px-2 py-1">File and sheet</th>
              <th className="px-2 py-1 text-right">Period amount (₹)</th>
              <th className="px-2 py-1">Head</th>
              <th className="px-2 py-1">Source</th>
              <th className="px-2 py-1">Confidence</th>
              <th className="px-2 py-1">All my companies</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.head}>
              <tr>
                <th colSpan={9} className="bg-neutral-50 px-2 py-1 text-left font-medium">
                  {g.name} ({g.rows.length})
                </th>
              </tr>
              {g.rows.map((r) => (
                <tr
                  key={r.ledgerKey}
                  className={rowNeedsReview(state, r) ? "bg-amber-50" : ""}
                >
                  <td className="px-2 py-1">
                    <input
                      data-row
                      type="checkbox"
                      aria-label={`Select ${r.displayName}`}
                      checked={selected.has(r.ledgerKey)}
                      onChange={() => {
                        toggle(r.ledgerKey);
                      }}
                    />
                  </td>
                  <td className="px-2 py-1">
                    {r.displayName}
                    {rowNeedsReview(state, r) && r.proposed.reason !== null ? (
                      <span className="block text-xs text-amber-800">
                        {r.proposed.reason}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1">{r.parentGroup}</td>
                  <td className="px-2 py-1">
                    {r.sourceFile} · {r.sourceSheet}
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">
                    {formatPaise(paise(BigInt(r.amountPaise)), {
                      decimals: 2,
                      style: "lakhs_crores",
                    })}
                  </td>
                  <td className="px-2 py-1">
                    <select
                      aria-label={`Head for ${r.displayName}`}
                      className="rounded border px-1 py-0.5"
                      value={currentHead(state, r)}
                      onChange={(e) => {
                        setState((s) => reassign(s, [r.ledgerKey], e.target.value));
                      }}
                    >
                      {MAPPABLE_HEADS.map((h) => (
                        <option key={h.code} value={h.code}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">{SOURCE_LABELS[r.proposed.source]}</td>
                  <td className="px-2 py-1">{r.proposed.confidence}</td>
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      aria-label={`Apply ${r.displayName} to all my companies`}
                      checked={state.applyToAll[r.ledgerKey] === true}
                      onChange={(e) => {
                        setState((s) => setApplyToAll(s, r.ledgerKey, e.target.checked));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {gate.ok ? null : (
        <Alert tone="warning">
          {gate.pending} {gate.pending === 1 ? "mapping needs" : "mappings need"} review
          before the MIS is computed
          {gate.unmapped > 0 ? `, including ${gate.unmapped.toString()} unmapped` : ""}.
        </Alert>
      )}
      <div className="flex gap-3">
        {gate.ok ? null : (
          <Button
            type="button"
            onClick={() => {
              setState((s) => acceptAllAsProposed(s));
            }}
          >
            Accept remaining as proposed
          </Button>
        )}
        <Button
          type="button"
          disabled={!gate.ok}
          onClick={() => {
            onConfirm(confirm(state));
          }}
        >
          Confirm mappings
        </Button>
      </div>
    </div>
  );
}
