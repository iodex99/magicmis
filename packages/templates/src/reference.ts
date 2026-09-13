/**
 * Reference MIS, Recreate mode (SPEC §22). The browser extracts the layout of the user's current
 * MIS workbook (sheet order, row labels, section headers, column headers and period patterns,
 * bold and indent, formulas as text, number formats), without values, and redacts it. Rows are
 * bound deterministically first; only rows left unbound go to `extractReferenceLayout`. The user
 * reviews every binding, and the template is built from the reviewed result. Rows that cannot be
 * bound are kept and marked "Not available from supplied data"; they never receive numbers.
 */

import { z } from "zod";

import { catalogMetric, METRIC_CATALOG, normaliseLabel } from "./catalog";
import {
  COLUMN_KINDS,
  templateSpecSchema,
  type ColumnKind,
  type TemplateRow,
  type TemplateSpec,
} from "./spec";

export const COLUMN_PATTERNS = [
  "month",
  "current",
  "previous",
  "same_month_ly",
  "mom_abs",
  "mom_pct",
  "yoy_abs",
  "yoy_pct",
  "ytd",
  "ly_ytd",
  "variance",
  "other",
] as const;
export type ColumnPattern = (typeof COLUMN_PATTERNS)[number];

const layoutRef = z.string().regex(/^s\d{1,3}(r\d{1,5}|c\d{1,3})?$/u);
const text = z.string().max(200);

export const referenceLayoutSchema = z.object({
  sheets: z
    .array(
      z.object({
        ref: layoutRef,
        name: text,
        columns: z
          .array(
            z.object({ ref: layoutRef, header: text, pattern: z.enum(COLUMN_PATTERNS) }),
          )
          .max(60),
        rows: z
          .array(
            z.object({
              ref: layoutRef,
              label: text,
              bold: z.boolean(),
              indent: z.number().int().min(0).max(4),
              hasValues: z.boolean(),
              /** Formula of the first value cell, cell references rewritten as row refs; literals removed. */
              formula: z.string().max(400).nullable(),
              /** Signed rows summed by that formula, when it is a plain sum of rows in the same column. */
              sumOf: z
                .array(
                  z.object({
                    row: layoutRef,
                    sign: z.union([z.literal(1), z.literal(-1)]),
                  }),
                )
                .max(60)
                .nullable(),
              numberFormat: z.string().max(80).nullable(),
            }),
          )
          .max(400),
      }),
    )
    .min(1)
    .max(20),
});
export type ReferenceLayout = z.infer<typeof referenceLayoutSchema>;
export type LayoutRow = ReferenceLayout["sheets"][number]["rows"][number];

export type BindingSource = "rule" | "ai" | "user";

export type RowBinding =
  | { readonly ref: string; readonly kind: "heading" }
  | { readonly ref: string; readonly kind: "blank" }
  | {
      readonly ref: string;
      readonly kind: "metric";
      readonly metric: string;
      readonly source: BindingSource;
      readonly confidence: "high" | "medium" | "low";
    }
  | {
      readonly ref: string;
      readonly kind: "subtotal";
      readonly terms: readonly { readonly row: string; readonly sign: 1 | -1 }[];
      readonly source: BindingSource;
      readonly confidence: "high" | "medium" | "low";
    }
  | { readonly ref: string; readonly kind: "unavailable"; readonly source: BindingSource }
  | { readonly ref: string; readonly kind: "unbound" };

const SYNONYMS = new Map<string, string>(
  METRIC_CATALOG.flatMap((m) =>
    m.synonyms.map((s) => [normaliseLabel(s), m.id] as const),
  ),
);

/** Strips "Total" and "Less:" style prefixes that do not change what a row measures. */
function candidates(label: string): string[] {
  const n = normaliseLabel(label);
  const out = [n];
  for (const prefix of ["total ", "less ", "add ", "net "]) {
    if (n.startsWith(prefix)) out.push(n.slice(prefix.length));
  }
  return out;
}

export function bindByLabel(label: string): string | null {
  for (const c of candidates(label)) {
    const id = SYNONYMS.get(c);
    if (id !== undefined) return id;
  }
  return null;
}

const isMoneyBinding = (b: RowBinding | undefined): boolean =>
  b !== undefined &&
  (b.kind === "subtotal" ||
    (b.kind === "metric" && catalogMetric(b.metric)?.unit === "money"));

/**
 * Resolves formula subtotals over rows that are bound to money, in row order. Run after every
 * change to the bindings (AI results, user edits), since a subtotal's terms may be bound later.
 */
export function resolveSubtotals(
  layout: ReferenceLayout,
  bindings: readonly RowBinding[],
): RowBinding[] {
  const byRef = new Map(bindings.map((b) => [b.ref, b]));
  for (const sheet of layout.sheets) {
    for (const row of sheet.rows) {
      const current = byRef.get(row.ref);
      if (current?.kind !== "unbound" || row.sumOf === null || row.sumOf.length === 0)
        continue;
      if (row.sumOf.every((t) => isMoneyBinding(byRef.get(t.row)))) {
        byRef.set(row.ref, {
          ref: row.ref,
          kind: "subtotal",
          terms: row.sumOf,
          source: "rule",
          confidence: "high",
        });
      }
    }
  }
  return bindings.map((b) => byRef.get(b.ref) ?? b);
}

/** Deterministic bindings: library labels, then formula subtotals, then headings. */
export function bindReferenceLayout(layout: ReferenceLayout): RowBinding[] {
  const bindings: RowBinding[] = [];
  for (const sheet of layout.sheets) {
    for (const row of sheet.rows) {
      if (normaliseLabel(row.label) === "") {
        bindings.push({ ref: row.ref, kind: "blank" });
        continue;
      }
      const metric = bindByLabel(row.label);
      if (metric !== null && row.hasValues) {
        bindings.push({
          ref: row.ref,
          kind: "metric",
          metric,
          source: "rule",
          confidence: "high",
        });
      } else if (!row.hasValues) {
        bindings.push({ ref: row.ref, kind: "heading" });
      } else {
        bindings.push({ ref: row.ref, kind: "unbound" });
      }
    }
  }
  return resolveSubtotals(layout, bindings);
}

export interface AiRowBinding {
  readonly ref: string;
  readonly kind: "metric" | "subtotal" | "unavailable";
  readonly metric: string | null;
  readonly terms: readonly { readonly row: string; readonly sign: 1 | -1 }[] | null;
  readonly confidence: "high" | "medium" | "low";
}

/** Merges AI proposals for unbound rows; anything that does not check out stays unbound. */
export function applyAiBindings(
  layout: ReferenceLayout,
  bindings: readonly RowBinding[],
  proposals: readonly AiRowBinding[],
): RowBinding[] {
  const proposed = new Map(proposals.map((p) => [p.ref, p]));
  const merged = bindings.map((b): RowBinding => {
    if (b.kind !== "unbound") return b;
    const p = proposed.get(b.ref);
    if (p === undefined) return b;
    if (p.kind === "unavailable")
      return { ref: b.ref, kind: "unavailable", source: "ai" };
    if (p.kind === "metric" && p.metric !== null && catalogMetric(p.metric) !== undefined)
      return {
        ref: b.ref,
        kind: "metric",
        metric: p.metric,
        source: "ai",
        confidence: p.confidence,
      };
    if (p.kind === "subtotal" && p.terms !== null && p.terms.length > 0)
      return {
        ref: b.ref,
        kind: "subtotal",
        terms: p.terms,
        source: "ai",
        confidence: p.confidence,
      };
    return b;
  });
  return validateSubtotals(layout, resolveSubtotals(layout, merged));
}

/** Subtotal terms must be money rows above in the same sheet; otherwise the row is unbound. */
export function validateSubtotals(
  layout: ReferenceLayout,
  bindings: readonly RowBinding[],
): RowBinding[] {
  const byRef = new Map(bindings.map((b) => [b.ref, b]));
  const out = new Map<string, RowBinding>();
  for (const sheet of layout.sheets) {
    const above = new Set<string>();
    for (const row of sheet.rows) {
      const b = out.get(row.ref) ?? byRef.get(row.ref);
      if (b?.kind === "subtotal") {
        const ok = b.terms.every(
          (t) => above.has(t.row) && isMoneyBinding(out.get(t.row) ?? byRef.get(t.row)),
        );
        out.set(row.ref, ok ? b : { ref: row.ref, kind: "unbound" });
      } else if (b !== undefined) {
        out.set(row.ref, b);
      }
      above.add(row.ref);
    }
  }
  return bindings.map((b) => out.get(b.ref) ?? b);
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const RESERVED_SHEETS = new Set(["cover", "index", "checks", "data", "lineage"]);

function columnKinds(patterns: readonly ColumnPattern[]): ColumnKind[] {
  const PREREQUISITES: Partial<Record<ColumnKind, ColumnKind[]>> = {
    mom_abs: ["current", "previous"],
    mom_pct: ["current", "previous"],
    variance: ["current", "previous"],
    yoy_abs: ["current", "same_month_ly"],
    yoy_pct: ["current", "same_month_ly"],
  };
  const wanted: ColumnKind[] = [];
  for (const p of patterns) {
    const k: ColumnKind | null = p === "month" ? "fy_months" : p === "other" ? null : p;
    if (k !== null && COLUMN_KINDS.includes(k) && !wanted.includes(k)) wanted.push(k);
  }
  // The reference order is kept; a comparison whose columns come later (or are missing) pulls them
  // in just before it, because a comparison reads the columns it compares.
  const kinds: ColumnKind[] = [];
  for (const k of wanted) {
    if (kinds.includes(k)) continue;
    for (const pre of PREREQUISITES[k] ?? []) if (!kinds.includes(pre)) kinds.push(pre);
    kinds.push(k);
  }
  return kinds.length === 0 ? ["current"] : kinds;
}

function numberFormatOf(layout: ReferenceLayout): TemplateSpec["numberFormat"] {
  const fmt = layout.sheets
    .flatMap((s) => s.rows)
    .find((r) => r.numberFormat !== null && /0/u.test(r.numberFormat))?.numberFormat;
  if (fmt === undefined || fmt === null)
    return { style: "lakhs_crores", decimals: 2, negativesInBrackets: true };
  const style = /#,##,##0|##,##,###/u.test(fmt)
    ? "lakhs_crores"
    : /0,,(?![0#])/u.test(fmt)
      ? "millions"
      : "absolute";
  const decimals = Math.min(2, /\.(0+)/u.exec(fmt)?.[1]?.length ?? 0);
  return { style, decimals, negativesInBrackets: fmt.includes("(") };
}

const slug = (label: string): string =>
  normaliseLabel(label)
    .replace(/%/gu, "pct")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 36) || "row";

/**
 * The recreated template: one section per reference sheet in the original order, rows in their
 * original order with bold as emphasis and indent kept. Unbound rows become unavailable rows.
 */
export function buildRecreatedTemplate(
  layout: ReferenceLayout,
  bindings: readonly RowBinding[],
  options: { name: string },
): TemplateSpec {
  // A subtotal whose terms are no longer money rows above it (after user edits) is kept as unavailable.
  const byRef = new Map(validateSubtotals(layout, bindings).map((b) => [b.ref, b]));
  const usedSheets = new Set<string>();
  const sections = layout.sheets.flatMap((sheet, si) => {
    const ids = new Map<string, string>();
    const taken = new Set<string>();
    const idFor = (ref: string, label: string) => {
      const existing = ids.get(ref);
      if (existing !== undefined) return existing;
      const base = slug(label);
      let id = base;
      for (let n = 2; taken.has(id); n += 1) id = `${base.slice(0, 36)}_${n.toString()}`;
      taken.add(id);
      ids.set(ref, id);
      return id;
    };
    const rows: TemplateRow[] = [];
    for (const row of sheet.rows) {
      const b = byRef.get(row.ref) ?? { ref: row.ref, kind: "unbound" as const };
      const label = row.label.trim().slice(0, 120);
      const id = () => idFor(row.ref, label);
      switch (b.kind) {
        case "blank":
          break;
        case "heading":
          rows.push({ kind: "heading", id: id(), label });
          break;
        case "metric":
          rows.push({
            kind: "metric",
            id: id(),
            label,
            metric: b.metric,
            indent: row.indent,
            emphasis: row.bold,
            showIfNonZero: false,
          });
          break;
        case "subtotal":
          rows.push({
            kind: "subtotal",
            id: id(),
            label,
            terms: b.terms.map((t) => ({
              row: ids.get(t.row) ?? "missing",
              sign: t.sign,
            })),
            indent: row.indent,
            emphasis: row.bold,
          });
          break;
        case "unavailable":
        case "unbound":
          rows.push({
            kind: "unavailable",
            id: id(),
            label,
            reason: "Not available from supplied data",
          });
          break;
      }
    }
    if (rows.length === 0) return [];
    let sheetName =
      sheet.name
        .replace(/[[\]:*?/\\]/gu, " ")
        .trim()
        .slice(0, 31) || `Sheet ${(si + 1).toString()}`;
    if (RESERVED_SHEETS.has(sheetName.toLowerCase()))
      sheetName = `${sheetName.slice(0, 25)} (MIS)`;
    for (let n = 2; usedSheets.has(sheetName.toLowerCase()); n += 1)
      sheetName = `${sheetName.slice(0, 27)} ${n.toString()}`;
    usedSheets.add(sheetName.toLowerCase());
    return [
      {
        id: `s${(si + 1).toString()}`,
        title: sheet.name.slice(0, 80) || sheetName,
        sheet: sheetName,
        requires: ["balances" as const],
        columns: columnKinds(sheet.columns.map((c) => c.pattern)),
        rows,
      },
    ];
  });
  return templateSpecSchema.parse({
    schemaVersion: 1,
    id: "recreated_reference_mis",
    name: options.name,
    version: 1,
    numberFormat: numberFormatOf(layout),
    sections,
    notes: [
      "Recreated from the reference MIS supplied by the user. Rows marked as not available have no matching data in the files.",
      "Prepared from data provided by the user; requires professional review.",
    ],
    defaultDashboard: null,
    defaultCommentarySections: ["Performance", "Margins", "Working capital"],
    materiality: { pct: "0.05", absPaise: "0" },
  });
}

/** Row refs still unbound: what `extractReferenceLayout` is asked about. */
export const unboundRefs = (bindings: readonly RowBinding[]): string[] =>
  bindings.filter((b) => b.kind === "unbound").map((b) => b.ref);

/**
 * The `extractReferenceLayout` input for a redacted layout and its rule bindings: the catalogue as
 * the allowed metrics, and every row with what rules decided, so unbound rows are read in context.
 */
export function referenceLayoutAiInput(layout: ReferenceLayout, bindings: readonly RowBinding[]) {
  const byRef = new Map(bindings.map((b) => [b.ref, b]));
  const bound = (b: RowBinding | undefined): string | null => {
    if (b === undefined || b.kind === "unbound") return null;
    return b.kind === "metric" ? `metric:${b.metric}` : b.kind;
  };
  return {
    metrics: METRIC_CATALOG.map((m) => ({ id: m.id, label: m.label, unit: m.unit })),
    sheets: layout.sheets.map((s) => ({
      ref: s.ref,
      name: s.name,
      columns: s.columns.map((c) => c.header),
      rows: s.rows
        .filter((r) => byRef.get(r.ref)?.kind !== "blank")
        .map((r) => ({
          ref: r.ref,
          label: r.label,
          bold: r.bold,
          indent: r.indent,
          formula: r.formula,
          bound: bound(byRef.get(r.ref)),
        })),
    })),
  };
}
