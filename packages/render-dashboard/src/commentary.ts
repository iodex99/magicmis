/**
 * Commentary rendering in the browser (SPEC §25): run the V12 post-check again, then turn text
 * into segments where every placeholder becomes a formatted value with its lineage key. Party and
 * employee tokens are rehydrated from the current session; a token not in the loaded files shows
 * as the token with a hint.
 */

import {
  checkCommentary,
  PLACEHOLDER,
  type CommentaryOutput,
  type FactsPack,
  type MetricValue,
} from "@magicmis/engine";

import { metricKey } from "./views";

export type Segment =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "value";
      readonly display: string;
      readonly metricKey: string | null;
      readonly hint: string | null;
    };

export interface RenderedCommentary {
  readonly sections: readonly {
    readonly heading: readonly Segment[];
    readonly paragraphs: readonly (readonly Segment[])[];
  }[];
}

export interface CommentaryFormat {
  readonly money: (paise: string) => string;
  readonly decimal: (value: string, unit: MetricValue["unit"]) => string;
  readonly period: (period: string) => string;
  readonly name: (token: string) => string | null;
}

export type CommentaryRenderResult =
  | { readonly ok: true; readonly commentary: RenderedCommentary }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * One line of model prose, with every placeholder replaced by the figure the engine computed and
 * carrying the lineage key that figure came from.
 *
 * Exported because commentary is not the only thing that writes prose over a facts pack
 * (ADR 0062). It does no checking of its own — the caller runs the post-check first, which is
 * what stops an unchecked figure reaching a reader.
 */
export function placeholderSegments(
  text: string,
  store: readonly MetricValue[],
  format: CommentaryFormat,
): Segment[] {
  const byKey = new Map(store.map((v) => [metricKey(v.metricId, v.period, v.dims), v]));
  return substitute(text, byKey, format);
}

function substitute(
  text: string,
  byKey: ReadonlyMap<string, MetricValue>,
  format: CommentaryFormat,
): Segment[] {
  {
    const out: Segment[] = [];
    let cursor = 0;
    for (const m of text.matchAll(PLACEHOLDER)) {
      if (m.index > cursor) out.push({ kind: "text", text: text.slice(cursor, m.index) });
      cursor = m.index + m[0].length;
      const kind = m[1] ?? "";
      const body = m[2] ?? "";
      if (kind === "p") {
        out.push({
          kind: "value",
          display: format.period(body),
          metricKey: null,
          hint: null,
        });
      } else if (kind === "d") {
        const name = format.name(body);
        out.push({
          kind: "value",
          display: name ?? body,
          metricKey: null,
          hint: name === null ? "name not in loaded files" : null,
        });
      } else {
        // m:metric@period  |  mv:metric.kind@period:abs|pct  →  store key metric[.kind_abs|pct]@period
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
        out.push({
          kind: "value",
          display,
          metricKey: key,
          hint: v === undefined ? "value not available" : null,
        });
      }
    }
    if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
    return out;
  }
}

export function renderCommentary(
  output: CommentaryOutput,
  pack: Pick<FactsPack, "facts" | "dimensions" | "periods">,
  store: readonly MetricValue[],
  allowlist: readonly string[],
  format: CommentaryFormat,
): CommentaryRenderResult {
  const problems = checkCommentary(output, pack, allowlist);
  if (problems.length > 0) return { ok: false, problems };
  const segments = (text: string): Segment[] => placeholderSegments(text, store, format);

  return {
    ok: true,
    commentary: {
      sections: output.sections.map((s) => ({
        heading: segments(s.heading),
        paragraphs: s.paragraphs.map((p) => segments(p.text)),
      })),
    },
  };
}
