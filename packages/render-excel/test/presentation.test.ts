/**
 * The workbook is a deliverable, so how it is typeset is part of what is being tested (ADR 0034):
 * a title band on the cover, a dark header band over every table, no gridlines, frozen panes, a
 * printed footer, ruled subtotals and totals, and check statuses that carry a fill as well as a
 * word. Values and formulas are covered by `workbook.test.ts`; nothing here touches them.
 */

import type { PeriodId } from "@magicmis/core/time";
import type { CheckResult, HeadCube } from "@magicmis/engine";
import { MONTHLY_FINANCIAL_MIS, resolveSections } from "@magicmis/templates";
import { describe, expect, it } from "vitest";

import { PALETTE } from "../src/theme";
import { renderWorkbook } from "../src/workbook";

/** A cell's text, however ExcelJS chose to store it (a string, a rich value, a formula). */
const textOf = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const v = value as { result?: unknown; text?: unknown };
    if ("text" in v) return String(v.text);
    if ("result" in v) return String(v.result);
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
};

const PERIOD = "2026-05" as PeriodId;

/**
 * An empty cube: this is a test of how the sheets are laid out, not of what is in them, and the
 * figures themselves are covered to the paisa by `workbook.test.ts`.
 */
const cube: HeadCube = {
  fyStartMonth: 4,
  periods: [PERIOD],
  get: () => null,
  coverage: [],
  dimensions: [],
  ledgerRows: [],
};

const checks: CheckResult[] = [
  {
    id: "V1",
    status: "pass",
    severity: "blocking",
    failureClass: "data_fault",
    message: "Trial balance nets to zero.",
    fix: "",
    amounts: {},
    details: [],
  },
  {
    id: "V4",
    status: "fail",
    severity: "warning",
    failureClass: "data_fault",
    message: "A subtotal does not equal the sum of its children.",
    fix: "Check the export.",
    amounts: {},
    details: [],
  },
];

const render = (currencySymbol: string) =>
  renderWorkbook({
    companyName: "Northwind Traders Pvt Ltd",
    currencySymbol,
    template: MONTHLY_FINANCIAL_MIS,
    sections: resolveSections(MONTHLY_FINANCIAL_MIS, new Set(["balances"])),
    period: PERIOD,
    tierLabel: "Professional",
    generatedAt: new Date("2026-06-05T06:30:00Z"),
    snapshotVersion: 1,
    cube,
    displayName: (k) => k,
    validation: checks,
  }).workbook;

describe("the workbook is typeset, not dumped (ADR 0034)", () => {
  const wb = render("₹");
  const sheets = wb.worksheets.map((w) => w.name);
  /** A sheet that must exist: a missing one is a failure here, not an optional chain. */
  const sheet = (name: string) => {
    const ws = wb.getWorksheet(name);
    if (ws === undefined) throw new Error(`no sheet ${name}`);
    return ws;
  };

  it("opens on a cover with a title band and the facts that identify it", () => {
    const cover = wb.getWorksheet("Cover");
    expect(cover).toBeDefined();
    const title = cover?.getCell(1, 1);
    expect(title?.fill).toEqual({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.ink },
    });
    expect(textOf(title?.value)).toContain("Northwind Traders Pvt Ltd");
    const labels = [5, 6, 7, 8, 9, 10, 11].map((r) => cover?.getCell(r, 1).value);
    expect(labels).toContain("Amounts in");
    expect(labels).toContain("Generated");
  });

  it("shows no gridlines and freezes the headings on every sheet", () => {
    for (const name of sheets) {
      const ws = wb.getWorksheet(name);
      const view = ws?.views[0];
      expect(view?.showGridLines, name).toBe(false);
    }
    const pl = wb.getWorksheet("P&L");
    expect(pl?.views[0]).toMatchObject({ state: "frozen", xSplit: 1 });
  });

  it("prints with the company, the report and a page number in the footer", () => {
    const pl = wb.getWorksheet("P&L");
    expect(pl?.headerFooter.oddFooter).toContain("Northwind Traders Pvt Ltd");
    expect(pl?.headerFooter.oddFooter).toContain("Page &P of &N");
    expect(pl?.pageSetup.orientation).toBe("landscape");
  });

  it("writes the column headings into a dark band", () => {
    const header = sheet("P&L").getCell(5, 1);
    expect(header.value).toBe("Particulars");
    expect(header.fill).toMatchObject({ fgColor: { argb: PALETTE.ink } });
    expect(header.font.bold).toBe(true);
    expect(header.font.color?.argb).toBe(PALETTE.white);
  });

  it("rules a total off from the lines above it", () => {
    const rows = MONTHLY_FINANCIAL_MIS.sections
      .find((s) => s.sheet === "P&L")
      ?.rows.map((r, i) => ({ r, row: 6 + i }));
    const total = rows?.find(({ r }) => "emphasis" in r && r.emphasis);
    expect(total).toBeDefined();
    expect(sheet("P&L").getCell(total?.row ?? 0, 1).border.bottom?.style).toBe("double");
  });

  it("marks a failed check with a fill as well as the word", () => {
    const row = wb.getWorksheet("Checks")?.getCell(3, 2);
    expect(row?.value).toBe("fail");
    expect(row?.fill).toMatchObject({ fgColor: { argb: PALETTE.negativeFill } });
  });

  it("says the currency it was given, on the cover and on every sheet", () => {
    const dollars = render("$");
    const cover = dollars.getWorksheet("Cover");
    expect(cover?.getCell(7, 2).value).toBe("$");
    const subtitle = textOf(dollars.getWorksheet("P&L")?.getCell(2, 1).value);
    expect(subtitle).toContain("Amounts in $");
    expect(subtitle).not.toContain("₹");
    // The disclaimer prints on every page rather than repeating in the subtitle.
    expect(subtitle).not.toContain("professional review");
    expect(dollars.getWorksheet("P&L")?.headerFooter.oddFooter).toContain(
      "professional review",
    );
  });
});
