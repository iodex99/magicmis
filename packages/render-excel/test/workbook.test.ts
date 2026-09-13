/**
 * SPEC §34 Phase 6 acceptance: Excel formulas verified. The Monthly Financial MIS for each synthetic
 * company is rendered from real fixture compute; HyperFormula (an independent spreadsheet engine,
 * test-only) evaluates every formula cell, which must equal the engine to the paisa. The in-browser
 * V11 evaluator must agree with HyperFormula on every cell, and must fail on a tampered formula.
 */

import type { PeriodId } from "@magicmis/core/time";
import { METRIC_DEFS, computeCube, type HeadCube } from "@magicmis/engine";
import { buildFixtureSet } from "@magicmis/fixtures";
import { detectHeader, readExcel } from "@magicmis/ingest";
import { GLOBAL_LIBRARY_SEED, indexLibrary, runCascade } from "@magicmis/semantic";
import { parseBalanceReport } from "@magicmis/tally";
import { METRIC_CATALOG, MONTHLY_FINANCIAL_MIS, resolveSections } from "@magicmis/templates";
import { HyperFormula } from "hyperformula";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTestDuck } from "../../ingest/test/duck";
import { Evaluator } from "../src/evaluate";
import { moneyFormat } from "../src/formats";
import { FORMULA_DEFS } from "../src/formulas";
import { matches, verifyWorkbook, workbookCells } from "../src/verify";
import { renderWorkbook } from "../src/workbook";
import { ledgerFactsFromReport } from "../../engine/src/facts";

let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
beforeAll(async () => {
  duck = await openTestDuck();
});
afterAll(() => {
  duck?.close();
});

const set = buildFixtureSet();
const library = indexLibrary(GLOBAL_LIBRARY_SEED);

async function cubeFor(company: string): Promise<HeadCube> {
  if (duck === undefined) throw new Error("duck not open");
  const files = set.files.filter(
    (f) => f.company === company && f.report === "trial_balance" && f.variant === "clean",
  );
  const facts = files.flatMap((f) => {
    const sheet = readExcel(f.bytes()).sheets[0];
    if (sheet === undefined) throw new Error("no sheet");
    const header = detectHeader(sheet);
    if (header === null) throw new Error("no header");
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

function hyperFormulaFor(wb: ReturnType<typeof renderWorkbook>["workbook"]) {
  const sheets: Record<string, (string | number | boolean | null)[][]> = {};
  wb.eachSheet((ws) => {
    const rows: (string | number | boolean | null)[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const out: (string | number | boolean | null)[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        const v = cell.value;
        out[c - 1] =
          v === null || v === undefined
            ? null
            : typeof v === "object" && "formula" in v
              ? `=${v.formula}`
              : typeof v === "object" && "text" in v
                ? v.text
                : (v as string | number | boolean);
      });
      rows[r - 1] = out;
    });
    sheets[ws.name] = Array.from(
      rows,
      (r: (string | number | boolean | null)[] | undefined) =>
        Array.from(r ?? [], (x) => x ?? null),
    );
  });
  return HyperFormula.buildFromSheets(sheets, { licenseKey: "gpl-v3" });
}

describe("formula definitions", () => {
  it("cover exactly the engine's metric library", () => {
    expect(Object.keys(FORMULA_DEFS).sort()).toEqual(Object.keys(METRIC_DEFS).sort());
    // The template catalogue a reference MIS binds to is the same library.
    expect(METRIC_CATALOG.map((m) => m.id).sort()).toEqual(Object.keys(METRIC_DEFS).sort());
  });

  it("lakh and crore format codes follow the digit count, with bracketed negatives", () => {
    expect(moneyFormat(1234567n, "lakhs_crores", 2, true)).toBe(
      "#,##0.00;\\(#,##0.00\\);0.00",
    );
    expect(moneyFormat(123456789n, "lakhs_crores", 2, true)).toBe(
      "##\\,##\\,##0.00;\\(##\\,##\\,##0.00\\);0.00",
    );
    expect(moneyFormat(-12345678900n, "lakhs_crores", 0, false)).toBe(
      "##\\,##\\,##\\,##0;\\-##\\,##\\,##\\,##0;0",
    );
    expect(moneyFormat(100n, "millions", 2, true)).toBe(
      "#,##0.00,,;\\(#,##0.00,,\\);0.00",
    );
  });
});

describe.each(["trading", "services", "manufacturing"])("%s workbook", (company) => {
  it("every formula evaluates to the engine value (HyperFormula and the V11 evaluator agree)", async () => {
    const cube = await cubeFor(company);
    const period = "2026-05" as PeriodId;
    const rendered = renderWorkbook({
      companyName: `Synthetic ${company}`,
      template: MONTHLY_FINANCIAL_MIS,
      sections: resolveSections(MONTHLY_FINANCIAL_MIS, new Set(["balances"])),
      period,
      tierLabel: "Professional",
      generatedAt: new Date("2026-06-05T06:30:00Z"),
      snapshotVersion: 1,
      cube,
      displayName: (k) => k,
      validation: [],
    });
    const { workbook, expectations } = rendered;
    expect(expectations.length).toBeGreaterThan(150);
    expect(rendered.fileName).toBe(
      `Synthetic_${company}_Monthly_Financial_MIS_2026-05_v1.xlsx`,
    );

    const hf = hyperFormulaFor(workbook);
    const ours = new Evaluator(workbookCells(workbook));
    let money = 0;
    for (const e of expectations) {
      const sheetId = hf.getSheetId(e.sheet);
      if (sheetId === undefined) throw new Error(`no sheet ${e.sheet}`);
      const raw = hf.getCellValue({ sheet: sheetId, row: e.row - 1, col: e.col - 1 });
      const hfValue = raw === null ? "" : typeof raw === "object" ? `#${raw.type}` : raw;
      expect(
        matches(hfValue, e),
        `${e.sheet} ${e.metricId}: HyperFormula ${String(hfValue)} vs engine ${String(e.value)}`,
      ).toBe(true);
      const mine = ours.cell(e.sheet, e.row, e.col);
      expect(
        matches(mine, e),
        `${e.sheet} ${e.metricId}: evaluator ${String(mine)}`,
      ).toBe(true);
      if (e.unit === "paise" && e.value !== null) money += 1;
    }
    expect(money).toBeGreaterThan(100);
    hf.destroy();

    expect(verifyWorkbook(workbook, expectations)).toMatchObject({
      id: "V11",
      status: "pass",
    });

    // The file writes and re-opens with cached values.
    const buffer = await workbook.xlsx.writeBuffer();
    const reread = XLSX.read(buffer, { type: "buffer" });
    expect(reread.SheetNames).toEqual([
      "Cover",
      "Index",
      "P&L",
      "Ratios",
      "Balance sheet",
      "Checks",
      "Data",
      "Lineage",
    ]);
    const pl = reread.Sheets["P&L"];
    const revenueCell = pl?.["B6"] as { f?: string; v?: number } | undefined;
    expect(revenueCell?.f).toContain("SUMIFS(Data!");
    expect(typeof revenueCell?.v).toBe("number");
  });
});

describe("V11 fails on a wrong formula", () => {
  it("detects a tampered cell", async () => {
    const cube = await cubeFor("trading");
    const rendered = renderWorkbook({
      companyName: "Tamper",
      template: MONTHLY_FINANCIAL_MIS,
      sections: resolveSections(MONTHLY_FINANCIAL_MIS, new Set(["balances"])),
      period: "2025-06" as PeriodId,
      tierLabel: "Efficient",
      generatedAt: new Date(),
      snapshotVersion: 1,
      cube,
      displayName: (k) => k,
      validation: [],
    });
    const target = rendered.expectations.find(
      (e) => e.unit === "paise" && e.value !== null && e.value !== "0",
    );
    if (target === undefined) throw new Error("no target");
    const ws = rendered.workbook.getWorksheet(target.sheet);
    const cell = ws?.getCell(target.row, target.col);
    const v = cell?.value as { formula: string; result: number };
    if (cell !== undefined)
      cell.value = { formula: `${v.formula}+0.01`, result: v.result };
    expect(verifyWorkbook(rendered.workbook, rendered.expectations)).toMatchObject({
      status: "fail",
      failureClass: "platform_fault",
    });
  });
});
