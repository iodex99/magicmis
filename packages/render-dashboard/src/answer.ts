/**
 * Chat answers in the browser (SPEC §27): the placeholder check runs again, then placeholders become
 * values with lineage. Metric placeholders link to the metric's lineage; query-cell placeholders
 * `{{q:<step>:<row>:<column>}}` link to the query that produced them (SQL, purpose, tables).
 */

import {
  ANSWER_PLACEHOLDER,
  checkPlaceholderTexts,
  type MetricValue,
} from "@magicmis/engine";

import type { CommentaryFormat } from "./commentary";
import { metricKey } from "./views";

export interface AnswerQuery {
  readonly ref: string;
  readonly sql: string;
  readonly purpose: string;
  readonly tables: readonly string[];
  readonly result: {
    readonly status: "ok";
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
  };
}

export type AnswerSegment =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "value";
      readonly display: string;
      readonly metricKey: string | null;
      readonly queryRef: string | null;
      readonly hint: string | null;
    };

export type AnswerRenderResult =
  | { readonly ok: true; readonly paragraphs: readonly (readonly AnswerSegment[])[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Money-looking query cells (integer paise columns) are shown as money; others as text. */
const isPaiseColumn = (column: string) =>
  /paise$|^total$|amount|balance|closing|opening|movement/iu.test(column);

export function renderAnswer(
  paragraphs: readonly { readonly text: string }[],
  values: readonly MetricValue[],
  queries: readonly AnswerQuery[],
  allowlist: readonly string[],
  format: CommentaryFormat,
): AnswerRenderResult {
  const byKey = new Map(values.map((v) => [metricKey(v.metricId, v.period, v.dims), v]));
  const known = new Set<string>();
  for (const v of values) {
    known.add(`m:${v.metricId}@${v.period}`);
    const variance = /^(.+)\.(mom|yoy)_(abs|pct)$/u.exec(v.metricId);
    if (variance !== null)
      known.add(
        `mv:${variance[1] ?? ""}.${variance[2] ?? ""}@${v.period}:${variance[3] ?? ""}`,
      );
  }
  const texts = paragraphs.map((p, i) => ({
    where: `paragraph ${(i + 1).toString()}`,
    text: p.text,
  }));
  // Periods and dimension tokens need no stored value; they are allowed by form.
  for (const { text } of texts)
    for (const m of text.matchAll(ANSWER_PLACEHOLDER)) {
      if (m[1] === "p" && /^\d{4}-\d{2}$/u.test(m[2] ?? "")) known.add(`p:${m[2] ?? ""}`);
      if (m[1] === "d" && /^[A-Z]+_[0-9a-f]{12}$/u.test(m[2] ?? ""))
        known.add(`d:${m[2] ?? ""}`);
    }
  const problems = checkPlaceholderTexts(
    texts,
    known,
    allowlist,
    queries.map((q) => ({
      stepId: q.ref,
      rowCount: q.result.rows.length,
      columns: q.result.columns,
    })),
  );
  if (problems.length > 0) return { ok: false, problems };

  const steps = new Map(queries.map((q) => [q.ref, q]));
  const segments = (text: string): AnswerSegment[] => {
    const out: AnswerSegment[] = [];
    let cursor = 0;
    for (const m of text.matchAll(ANSWER_PLACEHOLDER)) {
      if (m.index > cursor) out.push({ kind: "text", text: text.slice(cursor, m.index) });
      cursor = m.index + m[0].length;
      const kind = m[1] ?? "";
      const body = m[2] ?? "";
      if (kind === "p") {
        out.push({
          kind: "value",
          display: format.period(body),
          metricKey: null,
          queryRef: null,
          hint: null,
        });
      } else if (kind === "d") {
        const name = format.name(body);
        out.push({
          kind: "value",
          display: name ?? body,
          metricKey: null,
          queryRef: null,
          hint: name === null ? "name not in loaded files" : null,
        });
      } else if (kind === "q") {
        const [ref = "", row = "0", column = ""] = body.split(":");
        const q = steps.get(ref);
        const col = q?.result.columns.indexOf(column) ?? -1;
        const cell = q?.result.rows[Number.parseInt(row, 10)]?.[col] ?? "";
        const display =
          /^-?\d+$/u.test(cell) && isPaiseColumn(column)
            ? format.money(cell)
            : (format.name(cell) ?? cell);
        out.push({ kind: "value", display, metricKey: null, queryRef: ref, hint: null });
      } else {
        const [idPeriod = "", form] = body.split(":");
        const [id = "", period = ""] = idPeriod.split("@");
        const key = metricKey(kind === "mv" ? `${id}_${form ?? "abs"}` : id, period);
        const v = byKey.get(key);
        const display =
          v?.value == null
            ? "—"
            : v.unit === "paise"
              ? format.money(v.value)
              : format.decimal(v.value, v.unit);
        out.push({ kind: "value", display, metricKey: key, queryRef: null, hint: null });
      }
    }
    if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
    return out;
  };
  return { ok: true, paragraphs: paragraphs.map((p) => segments(p.text)) };
}
