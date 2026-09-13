/**
 * SPEC §34 Phase 7 acceptance: a recreated template renders a fixture MIS layout correctly. The
 * synthetic reference MIS is extracted as a layout (no values), bound by rules, the rows rules
 * leave are bound by a scripted `extractReferenceLayout` answer, and the template is built and
 * rendered from real fixture compute. The workbook keeps the reference's sheet order, labels,
 * headings, bold and indent; every bound figure and subtotal evaluates to the engine's value in
 * HyperFormula and in V11; rows without data say so and carry no number.
 */

import type { PeriodId } from "@magicmis/core/time";
import { computeCube, type HeadCube } from "@magicmis/engine";
import {
  buildFixtureSet,
  REFERENCE_MIS_SHEETS,
  referenceMisWorkbook,
} from "@magicmis/fixtures";
import { detectHeader, extractReferenceLayout, readExcel } from "@magicmis/ingest";
import { GLOBAL_LIBRARY_SEED, indexLibrary, runCascade } from "@magicmis/semantic";
import { parseBalanceReport } from "@magicmis/tally";
import {
  applyAiBindings,
  bindReferenceLayout,
  buildRecreatedTemplate,
  resolveSections,
  unboundRefs,
  type ReferenceLayout,
} from "@magicmis/templates";
import { HyperFormula } from "hyperformula";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTestDuck } from "../../ingest/test/duck";
import { ledgerFactsFromReport } from "../../engine/src/facts";
import { matches, verifyWorkbook } from "../src/verify";
import { renderWorkbook } from "../src/workbook";

let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
beforeAll(async () => {
  duck = await openTestDuck();
});
afterAll(() => {
  duck?.close();
});

async function tradingCube(): Promise<HeadCube> {
  if (duck === undefined) throw new Error("duck not open");
  const set = buildFixtureSet();
  const library = indexLibrary(GLOBAL_LIBRARY_SEED);
  const facts = set.files
    .filter(
      (f) =>
        f.company === "trading" && f.report === "trial_balance" && f.variant === "clean",
    )
    .flatMap((f) => {
      const sheet = readExcel(f.bytes()).sheets[0];
      const header = sheet === undefined ? null : detectHeader(sheet);
      if (sheet === undefined || header === null) throw new Error("unreadable fixture");
      return ledgerFactsFromReport(parseBalanceReport(sheet, header), {
        fileId: f.name,
        sheet: sheet.name,
      });
    });
  const { mappings } = runCascade(
    facts.map((f) => ({ groupPath: f.groupPath, name: f.name })),
    { companyRules: [], accountRules: [], library, fuzzyThreshold: "0.85" },
  );
  return computeCube(duck, { facts, mappings: [...mappings], fyStartMonth: 4 });
}

const refOf = (layout: ReferenceLayout, label: string) => {
  const row = layout.sheets.flatMap((s) => s.rows).find((r) => r.label === label);
  if (row === undefined) throw new Error(`no row ${label}`);
  return row.ref;
};

describe("reference MIS recreate", () => {
  it("extracts the layout without values", async () => {
    const { layout, hiddenSheets } = await extractReferenceLayout(
      await referenceMisWorkbook(),
    );
    expect(hiddenSheets).toEqual(["Workings"]);
    expect(layout.sheets.map((s) => s.name)).toEqual(
      REFERENCE_MIS_SHEETS.map((s) => s.name),
    );
    const pl = layout.sheets[0];
    expect(pl?.rows.map((r) => r.label)).toEqual(
      REFERENCE_MIS_SHEETS[0]?.rows.map((r) => r.label),
    );
    expect(pl?.columns.map((c) => c.pattern)).toEqual([
      "month",
      "month",
      "current",
      "previous",
      "variance",
      "mom_pct",
      "ytd",
    ]);
    const sales = pl?.rows.find((r) => r.label === "Sales");
    expect(sales).toMatchObject({
      bold: false,
      indent: 1,
      hasValues: true,
      formula: null,
    });
    expect(sales?.numberFormat).toContain("#,##,##0");
    const totalIncome = pl?.rows.find((r) => r.label === "Total Income");
    expect(totalIncome).toMatchObject({ bold: true, formula: "s1r5+s1r6" });
    expect(totalIncome?.sumOf).toEqual([
      { row: "s1r5", sign: 1 },
      { row: "s1r6", sign: 1 },
    ]);
    expect(pl?.rows.find((r) => r.label === "INCOME")).toMatchObject({
      bold: true,
      hasValues: false,
    });
    // No value from the workbook appears anywhere in the layout.
    expect(JSON.stringify(layout)).not.toMatch(/\d{4,}/u);
  });

  it("recreated template renders the fixture MIS layout correctly", async () => {
    const { layout } = await extractReferenceLayout(await referenceMisWorkbook());

    // Rules first: everything except the rows the fixture marks for AI or as unavailable.
    const rules = bindReferenceLayout(layout);
    const expected = REFERENCE_MIS_SHEETS.flatMap((s) => s.rows);
    const needAi = expected
      .filter(
        (r) =>
          (r.expected.kind === "metric" && r.expected.by === "ai") ||
          r.expected.kind === "unavailable",
      )
      .map((r) => refOf(layout, r.label));
    // "Total Expenses" waits for its Staff term, which only AI can bind.
    expect(unboundRefs(rules).sort()).toEqual(
      [...needAi, refOf(layout, "Total Expenses")].sort(),
    );

    // The scripted extractReferenceLayout answer.
    const bindings = applyAiBindings(layout, rules, [
      {
        ref: refOf(layout, "Staff Salaries & Welfare"),
        kind: "metric",
        metric: "employee_cost",
        terms: null,
        confidence: "high",
      },
      {
        ref: refOf(layout, "Marketing spend vs budget"),
        kind: "unavailable",
        metric: null,
        terms: null,
        confidence: "high",
      },
      {
        ref: refOf(layout, "Order book"),
        kind: "unavailable",
        metric: null,
        terms: null,
        confidence: "high",
      },
      {
        ref: refOf(layout, "Total Expenses"),
        kind: "metric",
        metric: "not_a_metric",
        terms: null,
        confidence: "low",
      },
    ]);
    expect(unboundRefs(bindings)).toEqual([]);

    const template = buildRecreatedTemplate(layout, bindings, { name: "Client MIS" });
    expect(template.sections.map((s) => s.sheet)).toEqual([
      "P&L Summary",
      "Working Capital",
    ]);
    template.sections.forEach((section, si) => {
      const def = REFERENCE_MIS_SHEETS[si];
      const defRows = (def?.rows ?? []).filter((r) => r.label !== "");
      expect(section.rows.map((r) => r.label)).toEqual(defRows.map((r) => r.label));
      section.rows.forEach((row, ri) => {
        const want = defRows[ri]?.expected;
        expect(row.kind, row.label).toBe(want?.kind);
        if (row.kind === "metric" && want?.kind === "metric")
          expect(row.metric).toBe(want.metric);
        if (row.kind === "subtotal" && want?.kind === "subtotal") {
          const labelOf = new Map(section.rows.map((r) => [r.id, r.label]));
          expect(row.terms.map((t) => labelOf.get(t.row))).toEqual(want.of);
        }
        if (row.kind === "metric" || row.kind === "subtotal") {
          expect(row.emphasis, row.label).toBe(defRows[ri]?.bold === true);
          expect(row.indent, row.label).toBe(defRows[ri]?.indent ?? 0);
        }
      });
    });
    expect(template.sections[0]?.columns).toEqual([
      "fy_months",
      "current",
      "previous",
      "variance",
      "mom_pct",
      "ytd",
    ]);
    expect(template.numberFormat).toMatchObject({
      style: "lakhs_crores",
      decimals: 2,
      negativesInBrackets: true,
    });

    const cube = await tradingCube();
    const period = "2026-05" as PeriodId;
    const rendered = renderWorkbook({
      companyName: "Synthetic Hardware Traders",
      template,
      sections: resolveSections(template, new Set(["balances"])),
      period,
      tierLabel: "Professional",
      generatedAt: new Date("2026-06-05T06:30:00Z"),
      snapshotVersion: 1,
      cube,
      displayName: (k) => k,
      validation: [],
    });
    const { workbook, expectations } = rendered;
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      "Cover",
      "Index",
      "P&L Summary",
      "Working Capital",
      "Checks",
      "Data",
      "Lineage",
    ]);

    // Labels, headings, bold and indent in the reference's order.
    const ws = workbook.getWorksheet("P&L Summary");
    const firstRow = 6;
    REFERENCE_MIS_SHEETS[0]?.rows.forEach((r, i) => {
      const cell = ws?.getCell(firstRow + i, 1);
      expect(cell?.value).toBe(r.label);
      expect((cell?.font as { bold?: boolean } | undefined)?.bold === true, r.label).toBe(
        r.bold === true,
      );
    });
    const marketing =
      firstRow +
      (REFERENCE_MIS_SHEETS[0]?.rows.findIndex(
        (r) => r.label === "Marketing spend vs budget",
      ) ?? 0);
    expect(ws?.getCell(marketing, 2).value).toBe("Not available from supplied data");
    expect(ws?.getCell(marketing, 3).value ?? null).toBeNull();

    // Subtotals are cell arithmetic over their term rows.
    const totalIncome = expectations.find(
      (e) => e.metricId === "subtotal:total_income@Current month",
    );
    const salesRow = firstRow + 1;
    const otherIncomeRow = firstRow + 2;
    const cell = ws?.getCell(totalIncome?.row ?? 0, totalIncome?.col ?? 0).value as
      { formula: string } | undefined;
    const letter = String.fromCharCode(64 + (totalIncome?.col ?? 0));
    expect(cell?.formula).toBe(
      `${letter}${salesRow.toString()}+${letter}${otherIncomeRow.toString()}`,
    );

    // Every figure and subtotal matches the engine in HyperFormula and in V11.
    const sheets: Record<string, (string | number | boolean | null)[][]> = {};
    workbook.eachSheet((sheet) => {
      const rows: (string | number | boolean | null)[][] = [];
      sheet.eachRow({ includeEmpty: true }, (row, r) => {
        const out: (string | number | boolean | null)[] = [];
        row.eachCell({ includeEmpty: true }, (c, col) => {
          const v = c.value;
          out[col - 1] =
            v === null || v === undefined
              ? null
              : typeof v === "object" && "formula" in v
                ? `=${v.formula}`
                : typeof v === "object" && "text" in v
                  ? v.text
                  : (v as string | number | boolean);
        });
        rows[r - 1] = Array.from(out, (x) => x ?? null);
      });
      sheets[sheet.name] = Array.from(
        rows,
        (r: (string | number | boolean | null)[] | undefined) => r ?? [],
      );
    });
    const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: "gpl-v3" });
    const subtotals = expectations.filter((e) => e.metricId.startsWith("subtotal:"));
    expect(subtotals.length).toBeGreaterThan(10);
    for (const e of expectations) {
      const id = hf.getSheetId(e.sheet);
      if (id === undefined) throw new Error(`no sheet ${e.sheet}`);
      const raw = hf.getCellValue({ sheet: id, row: e.row - 1, col: e.col - 1 });
      const value = raw === null ? "" : typeof raw === "object" ? `#${raw.type}` : raw;
      expect(
        matches(value, e),
        `${e.sheet} ${e.metricId}: ${String(value)} vs ${String(e.value)}`,
      ).toBe(true);
    }
    hf.destroy();
    expect(verifyWorkbook(workbook, expectations)).toMatchObject({
      id: "V11",
      status: "pass",
    });
  });
});
