"use client";

/**
 * Binding review for a recreated reference MIS (SPEC §22), in the same pattern as mapping review:
 * every row of the user's MIS in its original order, what it will show, and how that was decided.
 * Rows bound to nothing are kept and marked "Not available from supplied data".
 */

import { METRIC_CATALOG, type RowBinding } from "@magicmis/templates";
import { useState } from "react";

import { Button } from "@/components/ui";
import type { ReferenceReviewRow } from "@/lib/pipeline/types";

const UNAVAILABLE = "unavailable";
const HEADING = "heading";
const SUBTOTAL = "subtotal";

const valueOf = (b: RowBinding): string =>
  b.kind === "metric" ? `metric:${b.metric}` : b.kind === "unbound" ? UNAVAILABLE : b.kind;

const SOURCE: Record<string, string> = {
  rule: "Matched by label",
  ai: "Suggested by analysis",
  user: "Your choice",
};

export function ReferenceBindingReview({
  rows,
  onConfirm,
}: {
  rows: readonly ReferenceReviewRow[];
  onConfirm: (bindings: RowBinding[]) => void;
}) {
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.ref, valueOf(r.binding)])),
  );
  const [submitting, setSubmitting] = useState(false);

  const bindingFor = (r: ReferenceReviewRow): RowBinding => {
    const v = choice[r.ref] ?? valueOf(r.binding);
    if (v === valueOf(r.binding)) return r.binding.kind === "unbound" ? { ref: r.ref, kind: "unavailable", source: "user" } : r.binding;
    if (v === HEADING) return { ref: r.ref, kind: "heading" };
    if (v === UNAVAILABLE) return { ref: r.ref, kind: "unavailable", source: "user" };
    if (v === SUBTOTAL && r.binding.kind === "subtotal") return r.binding;
    return { ref: r.ref, kind: "metric", metric: v.slice("metric:".length), source: "user", confidence: "high" };
  };

  const available = rows.filter((r) => (choice[r.ref] ?? "") === UNAVAILABLE).length;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-700">
        Your MIS is recreated row by row. Check what each row will show. Rows marked not available stay in the workbook
        with that note; they never get numbers.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="binding-review">
          <thead>
            <tr className="text-left text-xs text-neutral-600">
              <th className="py-1">Sheet</th>
              <th className="py-1">Row in your MIS</th>
              <th className="py-1">Shows</th>
              <th className="py-1">How</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ref} className="border-t border-neutral-100 align-top" data-ref={r.ref}>
                <td className="py-1 text-neutral-600">{r.sheet}</td>
                <td className={`py-1 ${r.bold ? "font-semibold" : ""}`} style={{ paddingLeft: `${(r.indent * 1).toString()}rem` }}>
                  {r.label}
                </td>
                <td className="py-1">
                  <select
                    aria-label={`What ${r.label} shows`}
                    className="h-8 max-w-72 rounded-md border border-neutral-300 px-1"
                    value={choice[r.ref] ?? valueOf(r.binding)}
                    onChange={(e) => {
                      setChoice((c) => ({ ...c, [r.ref]: e.target.value }));
                    }}
                  >
                    {r.hasValues ? null : <option value={HEADING}>Heading</option>}
                    {r.binding.kind === "subtotal" ? (
                      <option value={SUBTOTAL}>Subtotal: {r.termLabels.join(" ")}</option>
                    ) : null}
                    {r.hasValues
                      ? METRIC_CATALOG.map((m) => (
                          <option key={m.id} value={`metric:${m.id}`}>
                            {m.label}
                          </option>
                        ))
                      : null}
                    <option value={UNAVAILABLE}>Not available from supplied data</option>
                  </select>
                </td>
                <td className="py-1 text-xs text-neutral-600">
                  {r.binding.kind === "metric" || r.binding.kind === "subtotal" || r.binding.kind === "unavailable"
                    ? SOURCE[choice[r.ref] === valueOf(r.binding) ? r.binding.source : "user"]
                    : r.binding.kind === "unbound"
                      ? "No match"
                      : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-neutral-700">{available} rows not available from supplied data</span>
        <Button
          disabled={submitting}
          onClick={() => {
            setSubmitting(true);
            onConfirm(rows.map(bindingFor));
          }}
        >
          Confirm rows
        </Button>
      </div>
    </div>
  );
}
