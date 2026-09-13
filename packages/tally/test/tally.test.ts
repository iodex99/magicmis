import { detectHeader, gridFromText } from "@magicmis/ingest";
import { describe, expect, it } from "vitest";

import { assignRoles } from "../src/columns";
import { parseBalanceReport } from "../src/balances";
import { detectReport } from "../src/detect";
import { groupKey, PREDEFINED_GROUPS, predefinedGroup, primaryOf } from "../src/groups";
import { parseVoucherReport } from "../src/registers";

function header(rows: string[][]) {
  const grid = gridFromText("Sheet1", rows);
  const h = detectHeader(grid);
  if (h === null) throw new Error("no header");
  return { grid, h };
}

describe("predefined groups (R-08)", () => {
  it("has 15 primary groups (9 Balance Sheet, 6 P&L) and 13 sub-groups with parents", () => {
    const primary = PREDEFINED_GROUPS.filter((g) => g.parent === null);
    expect(primary).toHaveLength(15);
    expect(primary.filter((g) => g.statement === "balance_sheet")).toHaveLength(9);
    expect(PREDEFINED_GROUPS.filter((g) => g.parent !== null)).toHaveLength(13);
    for (const g of PREDEFINED_GROUPS)
      if (g.parent) expect(predefinedGroup(g.parent), g.name).not.toBeNull();
  });

  it("matches names regardless of case, spacing and ampersands", () => {
    expect(groupKey("Cash-in-Hand")).toBe(groupKey("cash in hand"));
    expect(predefinedGroup("DUTIES AND TAXES")?.name).toBe("Duties & Taxes");
    expect(primaryOf("Sundry Debtors")?.name).toBe("Current Assets");
    expect(primaryOf("Bank OD A/c")?.name).toBe("Loans (Liability)");
    expect(predefinedGroup("Administrative Expenses")).toBeNull();
  });
});

describe("column roles (header-based, never positional)", () => {
  it("assigns balance and voucher roles from header text in any order", () => {
    expect(
      assignRoles(["Closing Balance Credit", "Particulars", "Closing Balance Debit"]),
    ).toEqual({ closing_cr: 0, particulars: 1, closing_dr: 2 });
    expect(
      assignRoles([
        "Vch No.",
        "Date",
        "Vch Type",
        "Particulars",
        "Credit Amount",
        "Debit Amount",
      ]),
    ).toMatchObject({
      vch_no: 0,
      date: 1,
      vch_type: 2,
      particulars: 3,
      credit: 4,
      debit: 5,
    });
  });
});

describe("report detection", () => {
  it("prefers title rows and falls back to header vocabulary", () => {
    const tb = header([
      ["X Ltd"],
      ["Trial Balance"],
      ["1-Apr-25 to 30-Apr-25"],
      ["Particulars", "Debit", "Credit"],
      ["Cash", "100.00", ""],
    ]);
    expect(detectReport(tb.grid, tb.h)).toMatchObject({
      type: "trial_balance",
      evidence: "title",
    });
    const noTitle = header([
      ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"],
      ["1-Apr-25", "Cash", "Receipt", "1", "10.00", ""],
    ]);
    expect(detectReport(noTitle.grid, noTitle.h).type).toBe("day_book");
    const unknown = header([
      ["Colour", "Shape"],
      ["Red", "Round"],
      ["Blue", "Square"],
    ]);
    expect(detectReport(unknown.grid, unknown.h).type).toBe("generic");
  });
});

describe("balance reports (SPEC §16 quirks)", () => {
  it("rebuilds an indented hierarchy, never counts group rows as ledgers, and flags a subtotal mismatch", () => {
    const { grid, h } = header([
      ["Particulars", "Debit", "Credit"],
      ["Current Assets", "300.00", ""],
      ["  Cash-in-hand", "100.00", ""],
      ["    Cash", "100.00", ""],
      ["  Sundry Debtors", "250.00", ""],
      ["    Party A", "200.00", ""],
      ["Capital Account", "", "300.00"],
      ["  Capital", "", "300.00"],
      ["Grand Total", "300.00", "300.00"],
    ]);
    const r = parseBalanceReport(grid, h);
    expect(r.hierarchy).toBe("indentation");
    expect(r.ledgers.map((l) => [l.path.join(" > "), l.amounts.closing])).toEqual([
      ["Current Assets > Cash-in-hand > Cash", 10_000n],
      ["Current Assets > Sundry Debtors > Party A", 20_000n],
      ["Capital Account > Capital", -30_000n],
    ]);
    const failed = r.checks.filter((c) => !c.ok && c.field === "closing");
    expect(failed.map((c) => [c.path.join(" > "), c.reported, c.computed])).toEqual([
      ["Current Assets > Sundry Debtors", 25_000n, 20_000n],
      ["Current Assets", 30_000n, 35_000n],
    ]);
    expect(r.grandTotal).toMatchObject({ closing: 0n });
  });

  it("keeps the same ledger name under two groups distinct by path", () => {
    const { grid, h } = header([
      ["Particulars", "Debit", "Credit"],
      ["Current Assets", "50.00", ""],
      ["  Security Deposit", "50.00", ""],
      ["Current Liabilities", "", "50.00"],
      ["  Security Deposit", "", "50.00"],
    ]);
    const r = parseBalanceReport(grid, h);
    expect(r.ledgers.map((l) => l.path.join(" > "))).toEqual([
      "Current Assets > Security Deposit",
      "Current Liabilities > Security Deposit",
    ]);
  });

  it("records a single-column amount with no Dr/Cr as unsigned instead of guessing", () => {
    const { grid, h } = header([
      ["Particulars", "Closing Balance"],
      ["Cash", "100.00 Dr"],
      ["Capital", "100.00"],
    ]);
    const r = parseBalanceReport(grid, h);
    expect(r.findings).toContainEqual({
      kind: "unsigned_amount",
      sourceRow: 3,
      field: "closing",
    });
  });

  it("closes groups on interleaved subtotal rows and reports unclosed groups", () => {
    const { grid, h } = header([
      ["Particulars", "Debit", "Credit"],
      ["Current Assets"],
      ["Cash", "10.00", ""],
      ["Bank", "15.00", ""],
      ["Total", "25.00", ""],
      ["Fixed Assets"],
      ["Plant", "5.00", ""],
    ]);
    const r = parseBalanceReport(grid, h);
    expect(r.hierarchy).toBe("subtotal_rows");
    expect(r.checks.filter((c) => c.field === "closing")).toEqual([
      expect.objectContaining({ ok: true, reported: 2_500n, computed: 2_500n }),
    ]);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.findings).toContainEqual({
      kind: "unclosed_group",
      sourceRow: 6,
      name: "Fixed Assets",
    });
  });
});

describe("voucher reports", () => {
  it("carries date, type and number forward across a voucher's lines and skips total rows", () => {
    const { grid, h } = header([
      ["Date", "Particulars", "Vch Type", "Vch No.", "Debit Amount", "Credit Amount"],
      ["1-Apr-25", "Party A", "Sales", "S/1", "118.00", ""],
      ["", "Sales", "", "", "", "100.00"],
      ["", "Output IGST", "", "", "", "18.00"],
      ["", "Grand Total", "", "", "118.00", "118.00"],
    ]);
    const r = parseVoucherReport(grid, h);
    expect(r.lines.map((l) => [l.date, l.vchNo, l.amount])).toEqual([
      ["2025-04-01", "S/1", 11_800n],
      ["2025-04-01", "S/1", -10_000n],
      ["2025-04-01", "S/1", -1_800n],
    ]);
    expect(r.totals).toHaveLength(1);
  });
});
