import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { decimalStringToPaise, numberToDecimalString, parseAmount } from "../src/amounts";
import { detectDelimiter, detectEncoding, previewCsv } from "../src/csv";
import { readExcel } from "../src/excel";
import { canonicalSignature, sha256Hex } from "../src/fingerprint";
import { gridFromText } from "../src/grid";
import { detectHeader, parsePeriodText } from "../src/header";
import { cellAsDate, classifyCell, inferColumn } from "../src/infer";
import { loadSheet, sanitiseIdentifier } from "../src/loader";
import { checkFiles, profileSheet } from "../src/profile";
import { inspectZip } from "../src/zip";

import { openTestDuck } from "./duck";

const t = (text: string, value: string | number = text, format?: string) =>
  format === undefined ? { value, text } : { value, text, format };

describe("amounts (SPEC §15)", () => {
  it.each([
    ["1,00,000.00", 10_000_000n, "indian"],
    ["12,34,56,789.50", 123_456_789_50n, "indian"],
    ["100,000.00", 10_000_000n, "international"],
    ["1,234,567.89", 123_456_789n, "international"],
    ["1234.5", 123_450n, "none"],
    ["₹ 2,360.00", 236_000n, "international"],
    ["Rs. 500", 50_000n, "none"],
  ] as const)("%s → %s paise", (text, paise, grouping) => {
    expect(parseAmount(text)).toMatchObject({ paise, grouping, side: null });
  });

  it("treats parentheses and minus as negative, and records Dr/Cr without applying it", () => {
    expect(parseAmount("(1,234.50)")).toMatchObject({
      paise: -123_450n,
      parenthesised: true,
    });
    expect(parseAmount("-500")?.paise).toBe(-50_000n);
    expect(parseAmount("500-")?.paise).toBe(-50_000n);
    expect(parseAmount("1,00,000.00 Dr")).toMatchObject({
      paise: 10_000_000n,
      side: "dr",
    });
    expect(parseAmount("25,000.00 Cr")).toMatchObject({ paise: 2_500_000n, side: "cr" });
    expect(parseAmount("1,20,000.00 Cr.")).toMatchObject({
      paise: 12_000_000n,
      side: "cr",
    });
  });

  it("refuses things that are not amounts", () => {
    for (const s of [
      "",
      "abc",
      "1,2,3",
      "12,34",
      "INV/2026/0001",
      "(-5)",
      "1.2.3",
      "10%",
    ]) {
      expect(parseAmount(s), s).toBeNull();
    }
  });

  it("converts Excel doubles through their shortest decimal, rounding once to the paisa", () => {
    expect(parseAmount(1234.5)?.paise).toBe(123_450n);
    expect(parseAmount(0.1 + 0.2)?.paise).toBe(30n); // 0.30000000000000004
    expect(parseAmount(2.675)?.paise).toBe(268n); // shortest repr "2.675", half-up
    expect(numberToDecimalString(1e21)).toBe("1000000000000000000000");
    expect(numberToDecimalString(1.5e-7)).toBe("0.00000015");
    expect(decimalStringToPaise("-0.005")).toBe(-1n);
  });

  it("property: formatted integers in paise round-trip through Indian and international grouping", () => {
    const indian = (d: string) =>
      d.length <= 3
        ? d
        : `${d.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/gu, ",")},${d.slice(-3)}`;
    const intl = (d: string) => d.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 13n }), (p) => {
        const rupees = (p / 100n).toString();
        const frac = (p % 100n).toString().padStart(2, "0");
        return (
          parseAmount(`${indian(rupees)}.${frac}`)?.paise === p &&
          parseAmount(`${intl(rupees)}.${frac}`)?.paise === p
        );
      }),
    );
  });
});

describe("type inference (SPEC §15)", () => {
  it("reads dates day-first only, including Excel serials in date-formatted cells", () => {
    expect(cellAsDate(t("01/04/2025"))).toBe("2025-04-01");
    expect(cellAsDate(t("05/04/2025"))).toBe("2025-04-05");
    expect(cellAsDate(t("1-Apr-25"))).toBe("2025-04-01");
    expect(cellAsDate(t("01-04-2025"))).toBe("2025-04-01");
    expect(cellAsDate(t("04/13/2025"))).toBeNull(); // month-first is not a date here
    expect(cellAsDate(t("1-Apr-25", 45748, "d-mmm-yy"))).toBe("2025-04-01");
    expect(cellAsDate(t("45748", 45748, "0"))).toBeNull(); // a number is not a date without a date format
  });

  it("classifies identifiers, percentages and amounts", () => {
    expect(classifyCell(t("27AAPFU0939F1ZV"))).toBe("gstin");
    expect(classifyCell(t("AAPFU0939F"))).toBe("pan");
    expect(classifyCell(t("HDFC0001234"))).toBe("ifsc");
    expect(classifyCell(t("accounts@example.test"))).toBe("email");
    expect(classifyCell(t("+91 98765 43210"))).toBe("mobile");
    expect(classifyCell(t("18%"))).toBe("percent");
    expect(classifyCell(t("1,00,000.00 Dr"))).toBe("amount");
    expect(classifyCell(t("Sundry Debtors"))).toBe("text");
    expect(classifyCell(t("INV-0042"))).toBe("text");
  });

  it("types a column by majority and records the Dr/Cr convention seen", () => {
    const col = inferColumn([
      t("1,000.00 Dr"),
      t("2,500.00 Cr"),
      t("300"),
      undefined,
      t("(40.00)"),
    ]);
    expect(col.type).toBe("amount");
    expect(col.drCrSuffixes).toEqual(["cr", "dr"]);
    expect(col.parenthesesNegative).toBe(true);
    expect(inferColumn([t("a"), t("1"), t("b"), t("c")]).type).toBe("text");
    expect(inferColumn([undefined]).type).toBe("empty");
  });
});

describe("header detection (SPEC §15)", () => {
  const tallyTb = gridFromText("Trial Balance", [
    ["Synthetic Traders Pvt Ltd"],
    ["12, Example Road, Pune"],
    ["Trial Balance"],
    ["1-Apr-25 to 31-Mar-26"],
    [],
    ["Particulars", "Closing Balance", ""],
    ["", "Debit", "Credit"],
    ["Capital Account", "", "5,00,000.00"],
    ["Current Assets", "7,25,000.00", ""],
    ["Sundry Debtors", "2,25,000.00", ""],
    ["Grand Total", "7,25,000.00", "7,25,000.00"],
  ]);

  it("finds a two-level Tally header, title rows and the period", () => {
    const h = detectHeader(tallyTb);
    expect(h).not.toBeNull();
    expect(h?.headerStart).toBe(5);
    expect(h?.headerEnd).toBe(6);
    expect(h?.bodyStart).toBe(7);
    expect(h?.headers).toEqual([
      "Particulars",
      "Closing Balance Debit",
      "Closing Balance Credit",
    ]);
    expect(h?.companyName).toBe("Synthetic Traders Pvt Ltd");
    expect(h?.period).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });

  it("uses merges to carry a parent label across columns", () => {
    const g = {
      ...gridFromText("TB", [
        ["Particulars", "Opening Balance", "", "Closing Balance", ""],
        ["", "Debit", "Credit", "Debit", "Credit"],
        ["Cash-in-hand", "100.00", "", "250.00", ""],
      ]),
      merges: [
        { startRow: 0, startCol: 1, endRow: 0, endCol: 2 },
        { startRow: 0, startCol: 3, endRow: 0, endCol: 4 },
      ],
    };
    expect(detectHeader(g)?.headers).toEqual([
      "Particulars",
      "Opening Balance Debit",
      "Opening Balance Credit",
      "Closing Balance Debit",
      "Closing Balance Credit",
    ]);
  });

  it("finds a single-row header below title rows in a register", () => {
    const g = gridFromText("Sales Register", [
      ["Synthetic Services LLP"],
      ["Sales Register"],
      ["1-Apr-25 to 30-Apr-25"],
      ["Date", "Particulars", "Voucher Type", "Voucher No.", "GSTIN/UIN", "Value"],
      ["2-Apr-25", "PARTY A", "Sales", "S/001", "27AAPFU0939F1ZV", "1,18,000.00"],
      ["5-Apr-25", "PARTY B", "Sales", "S/002", "", "59,000.00"],
    ]);
    const h = detectHeader(g);
    expect(h?.headerStart).toBe(3);
    expect(h?.headerEnd).toBe(3);
    expect(h?.headers[4]).toBe("GSTIN/UIN");
    expect(h?.period).toEqual({ from: "2025-04-01", to: "2025-04-30" });
  });

  it("parses period text variants", () => {
    expect(parsePeriodText("1-Apr-2025 to 31-Mar-2026")).toEqual({
      from: "2025-04-01",
      to: "2026-03-31",
    });
    expect(parsePeriodText("For 01/04/2025 - 30/06/2025")).toEqual({
      from: "2025-04-01",
      to: "2025-06-30",
    });
    expect(parsePeriodText("Trial Balance")).toBeNull();
  });
});

describe("CSV sniffing", () => {
  it("detects delimiters and encodings", () => {
    expect(detectDelimiter("a;b;c\n1;2;3\n4;5;6")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter('name,amount\n"Rao, K","1,000.00"\nX,5')).toBe(",");
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({
      encoding: "utf-8",
      bomLength: 3,
    });
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0x00])).encoding).toBe(
      "utf-16le",
    );
    expect(detectEncoding(new Uint8Array([0x52, 0xe9, 0x73])).encoding).toBe(
      "windows-1252",
    );
  });

  it("previews quoted fields with embedded delimiters and newlines", () => {
    const bytes = new TextEncoder().encode(
      'Particulars,Debit\r\n"Rao, K ""Senior""",1000\r\n"Two\nlines",5\r\n',
    );
    const p = previewCsv(bytes, "x.csv");
    expect(p.grid.rows[1]?.[0]?.text).toBe('Rao, K "Senior"');
    expect(p.grid.rows[2]?.[0]?.text).toBe("Two\nlines");
  });
});

describe("limits and zip-bomb guard", () => {
  const limits = { maxEntries: 1000, maxUncompressedBytes: 50_000_000, maxRatio: 200 };

  it("accepts a real xlsx and refuses archives that claim too much", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", 1]]), "S");
    const bytes = new Uint8Array(
      XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
    );
    const ok = inspectZip(bytes, limits);
    expect(ok.ok).toBe(true);
    expect(inspectZip(bytes, { ...limits, maxEntries: 2 })).toEqual({
      ok: false,
      reason: "too_many_entries",
    });
    expect(inspectZip(bytes, { ...limits, maxUncompressedBytes: 100 })).toEqual({
      ok: false,
      reason: "too_large_uncompressed",
    });
    expect(inspectZip(bytes, { ...limits, maxRatio: 0.5 })).toEqual({
      ok: false,
      reason: "ratio_exceeded",
    });
    expect(inspectZip(new TextEncoder().encode("not a zip at all"), limits)).toEqual({
      ok: false,
      reason: "not_zip",
    });
  });

  it("refuses by size and count before reading content, never by extension", () => {
    const l = {
      max_file_bytes: 100,
      max_session_bytes: 150,
      max_files_per_job: 2,
      zip_max_entries: 1,
      zip_max_uncompressed_bytes: 1,
      zip_max_ratio: 1,
    };
    expect(checkFiles([{ name: "a.xlsx", size: 90 }], l)).toEqual({ ok: true });
    expect(checkFiles([{ name: "a.pdf", size: 1 }], l)).toEqual({ ok: true });
    expect(checkFiles([{ name: "export.unknown", size: 1 }], l)).toEqual({ ok: true });
    expect(checkFiles([{ name: "a.xlsx", size: 101 }], l)).toMatchObject({
      reason: "file_too_large",
    });
    expect(
      checkFiles(
        [
          { name: "a.csv", size: 90 },
          { name: "b.xls", size: 90 },
        ],
        l,
      ),
    ).toMatchObject({ reason: "session_too_large" });
    expect(
      checkFiles(
        [1, 2, 3].map((i) => ({ name: `${i.toString()}.csv`, size: 1 })),
        l,
      ),
    ).toMatchObject({ reason: "too_many_files" });
  });
});

describe("Excel reading (SheetJS 0.20.3)", () => {
  it("reads cached values and formatted text, never formulas, and flags hidden sheets, rows and merges", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Particulars", "Amount"],
      ["Sales", 1000],
      ["Tax", { t: "n", v: 180, f: "B2*0.18" }],
      ["Date", { t: "n", v: 45748, z: "d-mmm-yy" }],
    ]);
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }];
    ws["!rows"] = [undefined, { hidden: true }] as XLSX.RowInfo[];
    const hiddenWs = XLSX.utils.aoa_to_sheet([["secret"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Visible");
    XLSX.utils.book_append_sheet(wb, hiddenWs, "Hidden");
    wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
    const bytes = new Uint8Array(
      XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
    );

    const grid = readExcel(bytes);
    const [visible, hidden] = grid.sheets;
    expect(hidden?.hidden).toBe(true);
    expect(visible?.hidden).toBe(false);
    expect(visible?.hiddenRows).toEqual([1]);
    expect(visible?.merges).toHaveLength(1);
    expect(visible?.rows[2]?.[1]?.value).toBe(180); // the cached value, formula not kept
    expect(JSON.stringify(visible)).not.toContain("B2*0.18");
    const dateCell = visible?.rows[3]?.[1];
    expect(dateCell && cellAsDate(dateCell)).toBe("2025-04-01");
  });
});

describe("fingerprints", () => {
  it("hashes bytes and ignores cosmetic header changes but not structural ones", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const a = canonicalSignature({
      headers: ["Particulars", "Closing Balance (Dr)"],
      types: ["text", "amount"],
      reportType: "trial_balance",
    });
    const b = canonicalSignature({
      headers: ["PARTICULARS", "closing balance dr"],
      types: ["text", "amount"],
      reportType: "trial_balance",
    });
    const c = canonicalSignature({
      headers: ["Particulars", "Closing Balance (Dr)"],
      types: ["text", "text"],
      reportType: "trial_balance",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("DuckDB loading with provenance (DuckDB-WASM 1.32.0)", () => {
  let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
  beforeAll(async () => {
    duck = await openTestDuck();
  });
  afterAll(() => {
    duck?.close();
  });

  it("loads typed columns with _file_id, _sheet and 1-based _source_row", async () => {
    if (duck === undefined) throw new Error("duck not open");
    const sheet = gridFromText("Day Book", [
      ["Synthetic Traders"],
      ["Date", "Particulars", "Vch No.", "Debit Amount"],
      ["1-Apr-25", 'Cash "petty"', "1", "1,00,000.00"],
      [],
      ["02/04/2025", "Bank, HDFC", "2", "(250.50)"],
    ]);
    const profile = await profileSheet(sheet);
    const loaded = await loadSheet(duck, {
      fileId: "f0e1d2c3-aaaa-bbbb-cccc-000000000001",
      sheet,
      profile,
      tableTaken: new Set(),
    });
    expect(loaded.rows).toBe(2);
    expect(loaded.headerMap).toMatchObject({
      date: "Date",
      particulars: "Particulars",
      debit_amount: "Debit Amount",
    });

    const rows = await duck.query(
      `select _file_id, _sheet, _source_row, strftime(date, '%Y-%m-%d') as d, particulars, debit_amount::varchar as amt from "${loaded.table}" order by _source_row`,
    );
    expect(rows).toEqual([
      {
        _file_id: "f0e1d2c3-aaaa-bbbb-cccc-000000000001",
        _sheet: "Day Book",
        _source_row: 3,
        d: "2025-04-01",
        particulars: 'Cash "petty"',
        amt: "10000000",
      },
      {
        _file_id: "f0e1d2c3-aaaa-bbbb-cccc-000000000001",
        _sheet: "Day Book",
        _source_row: 5,
        d: "2025-04-02",
        particulars: "Bank, HDFC",
        amt: "-25050",
      },
    ]);
  });

  it("sanitises identifiers uniquely without colliding with provenance columns", () => {
    const taken = new Set<string>();
    expect(sanitiseIdentifier("Closing Balance (Dr)", taken)).toBe("closing_balance_dr");
    expect(sanitiseIdentifier("Closing  Balance - Dr", taken)).toBe(
      "closing_balance_dr_2",
    );
    expect(sanitiseIdentifier("_source_row", taken)).toBe("source_row");
    expect(sanitiseIdentifier("2025", taken)).toBe("c_2025");
    expect(sanitiseIdentifier("विवरण", taken)).toBe("col");
  });
});
