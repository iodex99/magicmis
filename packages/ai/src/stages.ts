/**
 * Purpose-named AI stages (SPEC §14, §15). These are the only AI entry points: each fixes its
 * prompt, its input and output schemas and its payload cap. None accepts a prompt, a model, an
 * effort or a token limit — those come from `tier_routing` on the server.
 *
 * Inputs are redacted structural profiles (SPEC §17); party names and identifiers arrive as
 * opaque tokens. Payload caps follow SPEC §14 (15 sample rows per sheet, 500 distinct values per
 * column) and are enforced again here in bytes.
 */

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
