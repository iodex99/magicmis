import { gridFromText, profileSheet, type SheetGrid } from "@magicmis/ingest";
import { describe, expect, it } from "vitest";

import { assignRoles } from "../src/columns";
import { detectReport } from "../src/detect";
import { inferBalanceReport } from "../src/infer-balance";

/** Profile a sheet the way the pipeline does, returning its detected type and the report. */
async function read(sheet: SheetGrid) {
  const profile = await profileSheet(sheet, (s, h, c) => detectReport(s, h, c).type);
  const header = profile.header;
  const inferred =
    header === null ? null : inferBalanceReport(sheet, header, profile.columns);
  return { type: profile.reportType, inferred, header };
}

const closings = (r: Awaited<ReturnType<typeof read>>) =>
  Object.fromEntries(
    (r.inferred?.report.ledgers ?? []).map((l) => [
      l.name,
      (l.amounts.closing ?? 0n).toString(),
    ]),
  );

describe("trial balances from systems other than Tally (ADR 0031)", () => {
  it("reads account-code, account and account-type headings", async () => {
    expect(
      assignRoles(["Account Code", "Account", "Account Type", "Debit", "Credit"]),
    ).toEqual({ particulars: 1, parent_group: 2, debit: 3, credit: 4 });
    expect(assignRoles(["Name", "Net Balance"])).toEqual({ particulars: 0, closing: 1 });
    expect(assignRoles(["Employee", "Net Pay"])).toMatchObject({ net_pay: 1 });

    const r = await read(
      gridFromText("Sheet1", [
        ["Account Code", "Account", "Account Type", "Debit", "Credit"],
        ["090", "Business Bank Account", "Bank", "12,500.00", ""],
        ["200", "Sales", "Revenue", "", "20,000.00"],
        ["400", "Rent", "Expense", "7,500.00", ""],
      ]),
    );
    expect(r.type).toBe("trial_balance");
    expect(closings(r)).toEqual({
      "Business Bank Account": "1250000",
      Sales: "-2000000",
      Rent: "750000",
    });
    expect(r.inferred?.report.ledgers[1]?.path).toEqual(["Revenue", "Sales"]);
  });

  it("reads a signed single balance column", async () => {
    const r = await read(
      gridFromText("TB", [
        ["Account", "Balance"],
        ["Cash", "1000"],
        ["Capital", "-1000"],
      ]),
    );
    expect(r.type).toBe("trial_balance");
    expect(closings(r)).toEqual({ Cash: "100000", Capital: "-100000" });
  });

  it("finds debit and credit from content when the headings name neither", async () => {
    const r = await read(
      gridFromText("Export", [
        ["Ledger", "Column A", "Column B"],
        ["Cash", "400", ""],
        ["Debtors", "600", ""],
        ["Capital", "", "1000"],
      ]),
    );
    expect(r.type).toBe("trial_balance");
    expect(closings(r)).toEqual({ Cash: "40000", Debtors: "60000", Capital: "-100000" });
  });

  it("does not take a sheet whose numbers do not net to zero", async () => {
    const r = await read(
      gridFromText("Notes", [
        ["Item", "Amount"],
        ["Office move", "25000"],
        ["New laptops", "180000"],
      ]),
    );
    expect(r.type).toBe("generic");
    expect(r.inferred?.balanced).toBe(false);
  });

  it("folds a separate Dr/Cr column into its amounts", async () => {
    const r = await read(
      gridFromText("TB", [
        ["Ledger", "Amount", "Dr/Cr"],
        ["Cash", "1000", "Dr"],
        ["Capital", "1000", "Cr"],
      ]),
    );
    expect(r.type).toBe("trial_balance");
    expect(closings(r)).toEqual({ Cash: "100000", Capital: "-100000" });
  });

  it("marks a one-column list with no sides as unsigned rather than guessing", async () => {
    const r = await read(
      gridFromText("PL", [
        ["Particulars", "Amount"],
        ["Sales", "5000"],
        ["Rent", "2000"],
      ]),
    );
    expect(r.inferred?.unsigned).toBe(true);
    expect(r.inferred?.balanced).toBe(false);
  });
});
