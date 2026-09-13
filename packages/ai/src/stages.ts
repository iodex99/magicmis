/**
 * Purpose-named AI stages (SPEC §14, §15). These are the only AI entry points: each fixes its
 * prompt, its input and output schemas and its payload cap. None accepts a prompt, a model, an
 * effort or a token limit — those come from `tier_routing` on the server.
 *
 * Inputs are redacted structural profiles (SPEC §17); party names and identifiers arrive as
 * opaque tokens. Payload caps follow SPEC §14 (15 sample rows per sheet, 500 distinct values per
 * column) and are enforced again here in bytes.
 */

import { checkCommentary } from "@magicmis/engine";
import { z } from "zod";

import {
  runStage,
  type AiContext,
  type StageResult,
  type StageSpec,
} from "./orchestrator";
import { proseNoDigits } from "./schema";

const confidence = z.enum(["high", "medium", "low"]);
const ref = z.string().min(1).max(40);
const cell = z.string().max(200);

// ---------------------------------------------------------------------------
// Sheet classification
// ---------------------------------------------------------------------------

export const REPORT_TYPES = [
  "trial_balance",
  "profit_and_loss",
  "balance_sheet",
  "group_summary",
  "ledger_vouchers",
  "day_book",
  "sales_register",
  "purchase_register",
  "stock_summary",
  "bills_receivable",
  "bills_payable",
  "pay_sheet",
  "other",
] as const;

export const classifySheetsInput = z.object({
  sheets: z
    .array(
      z.object({
        ref,
        name: cell,
        titleLines: z.array(cell).max(6),
        headers: z.array(cell).min(1).max(80),
        types: z.array(z.string().max(20)).max(80),
        samples: z.array(z.array(cell).max(80)).max(15),
      }),
    )
    .min(1)
    .max(60),
});
export type ClassifySheetsInput = z.infer<typeof classifySheetsInput>;

export const classifySheetsOutput = z.object({
  sheets: z.array(
    z.object({
      ref,
      report_type: z.enum(REPORT_TYPES),
      confidence,
      reason: proseNoDigits,
    }),
  ),
});
export type ClassifySheetsOutput = z.infer<typeof classifySheetsOutput>;

const everyRefOnce = (
  expected: readonly string[],
  got: readonly { ref: string }[],
): string[] => {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const g of got) {
    if (!expected.includes(g.ref)) problems.push(`unknown ref ${g.ref}`);
    if (seen.has(g.ref)) problems.push(`ref ${g.ref} appears more than once`);
    seen.add(g.ref);
  }
  for (const e of expected) if (!seen.has(e)) problems.push(`missing ref ${e}`);
  return problems;
};

const table = (rows: readonly (readonly string[])[]): string =>
  rows.map((r) => r.map((c) => c.replace(/[\t\n\r]/gu, " ")).join("\t")).join("\n");

export const classifySheetsSpec: StageSpec<ClassifySheetsInput, ClassifySheetsOutput> = {
  stage: "sheet_classification",
  promptName: "sheet_classification",
  input: classifySheetsInput,
  output: classifySheetsOutput,
  maxInputBytes: 256_000,
  stable: () => [`Allowed report types: ${REPORT_TYPES.join(", ")}.`],
  volatile: (input) =>
    input.sheets
      .map(
        (s) =>
          `<sheet ref="${s.ref}">\nname: ${s.name}\ntitle lines: ${s.titleLines.join(" | ")}\n` +
          `headers:\n${table([s.headers, s.types])}\nsamples:\n${table(s.samples)}\n</sheet>`,
      )
      .join("\n"),
  check: (input, output) =>
    everyRefOnce(
      input.sheets.map((s) => s.ref),
      output.sheets,
    ),
};

export function classifySheets(
  ctx: AiContext,
  input: ClassifySheetsInput,
): Promise<StageResult<ClassifySheetsOutput>> {
  return runStage(ctx, classifySheetsSpec, input);
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

/** Canonical column roles (mirrors `@magicmis/tally` ColumnRole). */
export const COLUMN_ROLES = [
  "particulars",
  "level",
  "parent_group",
  "opening_dr",
  "opening_cr",
  "opening",
  "debit",
  "credit",
  "closing_dr",
  "closing_cr",
  "closing",
  "date",
  "vch_type",
  "vch_no",
  "narration",
  "gstin",
  "taxable",
  "cgst",
  "sgst",
  "igst",
  "value",
  "ref_no",
  "due_on",
  "overdue_days",
  "pending",
  "quantity",
  "rate",
  "employee",
  "designation",
  "net_pay",
  "gross_pay",
  "pay_component",
] as const;

export const mapColumnsInput = z.object({
  report_type: z.enum(REPORT_TYPES),
  columns: z
    .array(
      z.object({
        ref,
        header: cell,
        type: z.string().max(20),
        samples: z.array(cell).max(15),
      }),
    )
    .min(1)
    .max(80),
});
export type MapColumnsInput = z.infer<typeof mapColumnsInput>;

export const mapColumnsOutput = z.object({
  columns: z.array(
    z.object({
      ref,
      role: z.enum(COLUMN_ROLES).nullable(),
      confidence,
    }),
  ),
});
export type MapColumnsOutput = z.infer<typeof mapColumnsOutput>;

export const mapColumnsSpec: StageSpec<MapColumnsInput, MapColumnsOutput> = {
  stage: "column_mapping",
  promptName: "column_mapping",
  input: mapColumnsInput,
  output: mapColumnsOutput,
  maxInputBytes: 64_000,
  stable: () => [`Allowed roles: ${COLUMN_ROLES.join(", ")}.`],
  volatile: (input) =>
    `report type: ${input.report_type}\n` +
    input.columns
      .map(
        (c) =>
          `<column ref="${c.ref}" type="${c.type}">\nheader: ${c.header}\nsamples: ${c.samples.join(" | ")}\n</column>`,
      )
      .join("\n"),
  check: (input, output) => {
    const problems = everyRefOnce(
      input.columns.map((c) => c.ref),
      output.columns,
    );
    const used = new Set<string>();
    for (const c of output.columns) {
      if (c.role === null) continue;
      if (used.has(c.role))
        problems.push(`role ${c.role} is used by more than one column`);
      used.add(c.role);
    }
    return problems;
  },
};

export function mapColumns(
  ctx: AiContext,
  input: MapColumnsInput,
): Promise<StageResult<MapColumnsOutput>> {
  return runStage(ctx, mapColumnsSpec, input);
}

// ---------------------------------------------------------------------------
// Ledger mapping
// ---------------------------------------------------------------------------

export const mapLedgersInput = z.object({
  /** The canonical heads the ledgers may map to; supplied by the semantic layer on the server. */
  heads: z
    .array(
      z.object({
        code: z.string().min(1).max(60),
        label: z.string().min(1).max(120),
        statement: z.enum(["profit_and_loss", "balance_sheet"]),
      }),
    )
    .min(1)
    .max(400),
  ledgers: z
    .array(
      z.object({
        ref,
        name: cell,
        group_path: z.array(cell).max(12),
      }),
    )
    .min(1)
    .max(2000),
});
export type MapLedgersInput = z.infer<typeof mapLedgersInput>;

export const mapLedgersOutput = z.object({
  mappings: z.array(
    z.object({
      ref,
      head: z.string().nullable(),
      confidence,
    }),
  ),
});
export type MapLedgersOutput = z.infer<typeof mapLedgersOutput>;

export const mapLedgersSpec: StageSpec<MapLedgersInput, MapLedgersOutput> = {
  stage: "ledger_mapping",
  promptName: "ledger_mapping",
  input: mapLedgersInput,
  output: mapLedgersOutput,
  maxInputBytes: 512_000,
  // The head list is stable for an account and template, so it sits inside the cached prefix.
  stable: (input) => [
    `Allowed heads (code, statement, label):\n${table(input.heads.map((h) => [h.code, h.statement, h.label]))}`,
  ],
  volatile: (input) =>
    table(input.ledgers.map((l) => [l.ref, l.name, l.group_path.join(" > ")])),
  check: (input, output) => {
    const problems = everyRefOnce(
      input.ledgers.map((l) => l.ref),
      output.mappings,
    );
    const codes = new Set(input.heads.map((h) => h.code));
    for (const m of output.mappings) {
      if (m.head !== null && !codes.has(m.head))
        problems.push(`head ${m.head} is not allowed`);
    }
    return problems;
  },
};

export function mapLedgers(
  ctx: AiContext,
  input: MapLedgersInput,
): Promise<StageResult<MapLedgersOutput>> {
  return runStage(ctx, mapLedgersSpec, input);
}

// ---------------------------------------------------------------------------
// Commentary (SPEC §25)
// ---------------------------------------------------------------------------

export const generateCommentaryInput = z.object({
  factsPack: z.object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
    facts: z
      .array(
        z.object({
          id: z.string().max(120),
          label: z.string().max(200),
          text: z.string().max(60),
        }),
      )
      .max(400),
    dimensions: z
      .array(z.object({ id: z.string().max(80), label: z.string().max(200) }))
      .max(100),
    periods: z.array(z.string().max(20)).max(40),
    warnings: z.array(z.string().max(300)).max(50),
  }),
  sections: z.array(z.string().min(1).max(80)).min(1).max(8),
  /** Server config `commentary.digit_allowlist`, never from the browser. */
  allowlist: z.array(z.string().max(40)).max(50),
});
export type GenerateCommentaryInput = z.infer<typeof generateCommentaryInput>;

export const generateCommentaryOutput = z.object({
  sections: z.array(
    z.object({
      heading: z.string().max(120),
      paragraphs: z.array(z.object({ text: z.string().max(1200) })).max(6),
    }),
  ),
});
export type GenerateCommentaryOutput = z.infer<typeof generateCommentaryOutput>;

export const generateCommentarySpec: StageSpec<
  GenerateCommentaryInput,
  GenerateCommentaryOutput
> = {
  stage: "commentary",
  promptName: "commentary",
  input: generateCommentaryInput,
  output: generateCommentaryOutput,
  maxInputBytes: 96_000,
  stable: (input) => [`Sections to write, in order: ${input.sections.join("; ")}.`],
  volatile: (input) =>
    [
      "facts:",
      table(input.factsPack.facts.map((f) => [f.id, f.label, f.text])),
      "dimension values:",
      table(input.factsPack.dimensions.map((d) => [d.id, d.label])),
      `periods: ${input.factsPack.periods.join(", ")}`,
      "validation warnings:",
      input.factsPack.warnings.join("\n"),
    ].join("\n"),
  // V12: placeholders must resolve and no digit may remain outside them; failures get one repair.
  check: (input, output) => checkCommentary(output, input.factsPack, input.allowlist),
};

export function generateCommentary(
  ctx: AiContext,
  input: GenerateCommentaryInput,
): Promise<StageResult<GenerateCommentaryOutput>> {
  return runStage(ctx, generateCommentarySpec, input);
}

// ---------------------------------------------------------------------------
// Reference MIS layout (SPEC §22, Recreate mode)
// ---------------------------------------------------------------------------

const layoutRef = z.string().regex(/^s\d{1,3}(r\d{1,5})?$/u);

export const extractReferenceLayoutInput = z.object({
  /** Library metrics a row may bind to; supplied by the server from the template catalogue. */
  metrics: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        label: z.string().min(1).max(120),
        unit: z.enum(["money", "percent", "ratio", "days"]),
      }),
    )
    .min(1)
    .max(100),
  sheets: z
    .array(
      z.object({
        ref: layoutRef,
        name: cell,
        columns: z.array(cell).max(60),
        rows: z
          .array(
            z.object({
              ref: layoutRef,
              label: cell,
              bold: z.boolean(),
              indent: z.number().int().min(0).max(4),
              /** Row formula with cell references as row refs and literals removed. */
              formula: z.string().max(400).nullable(),
              /** What rules already decided ("metric:revenue", "heading", "subtotal"), or null when unbound. */
              bound: z.string().max(80).nullable(),
            }),
          )
          .max(400),
      }),
    )
    .min(1)
    .max(20),
});
export type ExtractReferenceLayoutInput = z.infer<typeof extractReferenceLayoutInput>;

export const extractReferenceLayoutOutput = z.object({
  rows: z.array(
    z.object({
      ref: layoutRef,
      kind: z.enum(["metric", "subtotal", "unavailable"]),
      metric: z.string().max(60).nullable(),
      terms: z
        .array(z.object({ row: layoutRef, sign: z.union([z.literal(1), z.literal(-1)]) }))
        .max(60)
        .nullable(),
      confidence,
    }),
  ),
});
export type ExtractReferenceLayoutOutput = z.infer<typeof extractReferenceLayoutOutput>;

export const extractReferenceLayoutSpec: StageSpec<
  ExtractReferenceLayoutInput,
  ExtractReferenceLayoutOutput
> = {
  stage: "reference_layout",
  promptName: "reference_layout",
  input: extractReferenceLayoutInput,
  output: extractReferenceLayoutOutput,
  maxInputBytes: 256_000,
  stable: (input) => [
    `Allowed metrics (id, unit, label):\n${table(input.metrics.map((m) => [m.id, m.unit, m.label]))}`,
  ],
  volatile: (input) =>
    input.sheets
      .map(
        (s) =>
          `<sheet ref="${s.ref}" name="${s.name}">\ncolumns: ${s.columns.join(" | ")}\n${table(
            s.rows.map((r) => [
              r.ref,
              `${"  ".repeat(r.indent)}${r.label}`,
              r.bold ? "bold" : "",
              r.formula ?? "",
              r.bound ?? "UNBOUND",
            ]),
          )}\n</sheet>`,
      )
      .join("\n"),
  check: (input, output) => {
    const rows = input.sheets.flatMap((s) => s.rows.map((r) => ({ ...r, sheet: s.ref })));
    const problems = everyRefOnce(
      rows.filter((r) => r.bound === null).map((r) => r.ref),
      output.rows,
    );
    const metrics = new Map(input.metrics.map((m) => [m.id, m]));
    const sheetOf = new Map(rows.map((r) => [r.ref, r.sheet]));
    for (const o of output.rows) {
      if (o.kind === "metric" && (o.metric === null || !metrics.has(o.metric)))
        problems.push(`row ${o.ref}: metric ${o.metric ?? "null"} is not allowed`);
      if (o.kind === "subtotal") {
        if (o.terms === null || o.terms.length === 0)
          problems.push(`row ${o.ref}: a subtotal needs terms`);
        for (const t of o.terms ?? []) {
          if (t.row === o.ref) problems.push(`row ${o.ref}: a subtotal cannot include itself`);
          else if (sheetOf.get(t.row) !== sheetOf.get(o.ref))
            problems.push(`row ${o.ref}: term ${t.row} is not a row on the same sheet`);
        }
      }
    }
    return problems;
  },
};

export function extractReferenceLayout(
  ctx: AiContext,
  input: ExtractReferenceLayoutInput,
): Promise<StageResult<ExtractReferenceLayoutOutput>> {
  return runStage(ctx, extractReferenceLayoutSpec, input);
}
