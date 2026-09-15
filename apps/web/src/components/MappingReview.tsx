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
      <div
        className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-neutral-25 p-3"
        role="search"
      >
        <label className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[0.8125rem] font-medium text-neutral-700">
          <input
            type="checkbox"
            checked={filter.needsReviewOnly === true}
            onChange={(e) => {
              setFilter({ ...filter, needsReviewOnly: e.target.checked });
            }}
          />
          Needs review only
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[0.8125rem] font-medium text-neutral-700">
          <input
            type="checkbox"
            checked={filter.unmappedOnly === true}
            onChange={(e) => {
              setFilter({ ...filter, unmappedOnly: e.target.checked });
            }}
          />
          Unmapped only
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-medium text-neutral-500">
          Head
          <select
            className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[0.8125rem] text-neutral-900 hover:border-neutral-300"
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
        <label className="flex flex-col gap-1 text-[0.75rem] font-medium text-neutral-500">
          Source
          <select
            className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[0.8125rem] text-neutral-900 hover:border-neutral-300"
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
        <label className="flex flex-col gap-1 text-[0.75rem] font-medium text-neutral-500">
          Search
          <input
            className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[0.8125rem] text-neutral-900 hover:border-neutral-300"
            type="search"
            value={filter.search ?? ""}
            onChange={(e) => {
              setFilter({ ...filter, search: e.target.value });
            }}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[0.75rem] font-medium text-neutral-500">
          Reassign selected to
          <select
            className="h-9 rounded-md border border-neutral-200 bg-white px-2.5 text-[0.8125rem] text-neutral-900 hover:border-neutral-300"
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

      <div className="scroll-slim max-h-[34rem] overflow-auto rounded-xl border border-neutral-200">
        <table
          ref={tableRef}
          className="w-full border-collapse text-sm"
          onKeyDown={onKeyDown}
        >
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-neutral-200 text-left text-[0.6875rem] font-semibold tracking-[0.06em] text-neutral-500 uppercase">
              <th className="px-3 py-2">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-3 py-2">Ledger or column</th>
              <th className="px-3 py-2">Parent group</th>
              <th className="px-3 py-2">File and sheet</th>
              <th className="px-3 py-2 text-right">Period amount (₹)</th>
              <th className="px-3 py-2">Head</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">All my companies</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.head}>
              <tr>
                <th
                  colSpan={9}
                  className="sticky top-9 bg-neutral-50 px-3 py-1.5 text-left text-[0.75rem] font-semibold text-neutral-700"
                >
                  {g.name} ({g.rows.length})
                </th>
              </tr>
              {g.rows.map((r) => (
                <tr
                  key={r.ledgerKey}
                  className={`border-b border-neutral-100 last:border-0 ${
                    rowNeedsReview(state, r) ? "bg-warning-subtle" : "hover:bg-neutral-25"
                  }`}
                >
                  <td className="px-3 py-2">
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
                  <td className="px-3 py-2">
                    {r.displayName}
                    {rowNeedsReview(state, r) && r.proposed.reason !== null ? (
                      <span className="block text-[0.75rem] text-warning">
                        {r.proposed.reason}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{r.parentGroup}</td>
                  <td className="px-3 py-2">
                    {r.sourceFile} · {r.sourceSheet}
                  </td>
                  <td className="num px-3 py-2 font-mono">
                    {formatPaise(paise(BigInt(r.amountPaise)), {
                      decimals: 2,
                      style: "lakhs_crores",
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`Head for ${r.displayName}`}
                      className="h-8 w-full max-w-52 rounded-md border border-neutral-200 bg-white px-2 text-[0.8125rem] text-neutral-900 hover:border-neutral-300"
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
                  <td className="px-3 py-2">{SOURCE_LABELS[r.proposed.source]}</td>
                  <td className="px-3 py-2">{r.proposed.confidence}</td>
                  <td className="px-3 py-2">
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
