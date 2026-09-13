/**
 * Template spec (SPEC §22): data, not code. Sections of rows bound to library metrics or to other
 * rows, column sets for period comparisons, number format, notes, default commentary sections and
 * materiality defaults. Stored (encrypted) in the company blueprint.
 */

import { z } from "zod";

export const COLUMN_KINDS = [
  "fy_months",
  "current",
  "previous",
  "mom_abs",
  "mom_pct",
  "same_month_ly",
  "yoy_abs",
  "yoy_pct",
  "ytd",
  "ly_ytd",
  "variance",
] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

export const DATA_REQUIREMENTS = [
  "balances",
  "bills_receivable",
  "bills_payable",
  "pay_sheet",
] as const;
export type DataRequirement = (typeof DATA_REQUIREMENTS)[number];

const rowId = z.string().regex(/^[a-z0-9_]{1,40}$/u);

export const templateRowSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("metric"),
    id: rowId,
    label: z.string().min(1).max(120),
    metric: z.string().min(1).max(60),
    indent: z.number().int().min(0).max(4).default(0),
    emphasis: z.boolean().default(false),
    showIfNonZero: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("heading"),
    id: rowId,
    label: z.string().min(1).max(120),
  }),
  z.object({
    kind: z.literal("subtotal"),
    id: rowId,
    label: z.string().min(1).max(120),
    /**
     * SPEC §22 subtotal rule: signed sum of other money rows in the same section (metric or
     * subtotal rows above it, by row id). Written as cell arithmetic so a reviewer can trace it.
     */
    terms: z
      .array(z.object({ row: rowId, sign: z.union([z.literal(1), z.literal(-1)]) }))
      .min(1)
      .max(40),
    indent: z.number().int().min(0).max(4).default(0),
    emphasis: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("unavailable"),
    id: rowId,
    label: z.string().min(1).max(120),
    /** SPEC §22: rows that cannot be bound are kept and never filled with invented numbers. */
    reason: z.string().min(1).max(200),
  }),
]);
export type TemplateRow = z.infer<typeof templateRowSchema>;

export const templateSectionSchema = z
  .object({
    id: rowId,
    title: z.string().min(1).max(80),
    /** Sheet name in the workbook (Excel limit 31 characters). */
    sheet: z.string().min(1).max(31),
    requires: z.array(z.enum(DATA_REQUIREMENTS)),
    columns: z.array(z.enum(COLUMN_KINDS)).min(1),
    rows: z.array(templateRowSchema).min(1),
  })
  .superRefine((section, ctx) => {
    const seen = new Set<string>();
    for (const r of section.rows) {
      if (seen.has(r.id))
        ctx.addIssue({ code: "custom", message: `duplicate row id ${r.id}` });
      if (r.kind === "subtotal") {
        // Terms refer to rows above, so a subtotal never depends on itself or on a later row.
        for (const t of r.terms) {
          if (!seen.has(t.row))
            ctx.addIssue({
              code: "custom",
              message: `subtotal ${r.id} refers to ${t.row}, which is not a row above it`,
            });
        }
      }
      seen.add(r.id);
    }
  });
export type TemplateSection = z.infer<typeof templateSectionSchema>;

export const templateSpecSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9_]{1,40}$/u),
  name: z.string().min(1).max(80),
  version: z.number().int().positive(),
  numberFormat: z.object({
    style: z.enum(["lakhs_crores", "absolute", "millions"]),
    decimals: z.number().int().min(0).max(2),
    negativesInBrackets: z.boolean(),
  }),
  sections: z.array(templateSectionSchema).min(1),
  notes: z.array(z.string().max(500)),
  defaultDashboard: z.unknown().nullable(),
  defaultCommentarySections: z.array(z.string().max(80)),
  materiality: z.object({
    pct: z.string().regex(/^\d+(\.\d+)?$/u),
    absPaise: z.string().regex(/^\d+$/u),
  }),
  /** Blueprint version this template was edited from (chat edits, SPEC §27); undo restores it. */
  editedFrom: z.number().int().positive().nullable().optional(),
});
export type TemplateSpec = z.infer<typeof templateSpecSchema>;

export interface ResolvedSection {
  readonly section: TemplateSection;
  readonly included: boolean;
  /** Plain reason recorded on the Checks sheet when a section is omitted. */
  readonly omittedReason: string | null;
}

const REQUIREMENT_TEXT: Record<DataRequirement, string> = {
  balances: "a trial balance",
  bills_receivable: "a bills receivable report",
  bills_payable: "a bills payable report",
  pay_sheet: "a pay sheet",
};

/** SPEC §22: sections without data are omitted, with a note in Checks. */
export function resolveSections(
  spec: TemplateSpec,
  available: ReadonlySet<DataRequirement>,
): ResolvedSection[] {
  return spec.sections.map((section) => {
    const missing = section.requires.filter((r) => !available.has(r));
    return missing.length === 0
      ? { section, included: true, omittedReason: null }
      : {
          section,
          included: false,
          omittedReason: `${section.title} omitted: the files did not include ${missing.map((m) => REQUIREMENT_TEXT[m]).join(" or ")}.`,
        };
  });
}
