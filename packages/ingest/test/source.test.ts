import { describe, expect, it } from "vitest";

import {
  gridFromPositionedText,
  readSourceFile,
  sniffFormat,
  type PositionedText,
} from "../src";

const LIMITS = { maxEntries: 1000, maxUncompressedBytes: 50_000_000, maxRatio: 200 };
const enc = (s: string) => new TextEncoder().encode(s);
const texts = (rows: readonly (readonly ({ text: string } | undefined)[])[]) =>
  rows.map((r) => Array.from(r, (c) => c?.text ?? ""));

/** A minimal, valid single-page PDF with Helvetica text at the given positions. */
function buildPdf(lines: readonly [string, number, number][]): Uint8Array {
  const content = lines
    .map(([t, x, y]) => `BT /F1 10 Tf ${x.toString()} ${y.toString()} Td (${t}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length.toString()} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${(i + 1).toString()} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${(objects.length + 1).toString()}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${o.toString().padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${(objects.length + 1).toString()} /Root 1 0 R >>\nstartxref\n${xref.toString()}\n%%EOF`;
  return enc(out);
}

describe("what a file is comes from its bytes, not its name", () => {
  it("recognises formats by signature", () => {
    expect(sniffFormat("x.xlsx", enc("%PDF-1.7"))).toBe("pdf");
    expect(sniffFormat("scan.pdf", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
      "image",
    );
    expect(sniffFormat("tb.csv", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(
      "workbook",
    );
    expect(sniffFormat("tb", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(
      "legacy_workbook",
    );
    expect(sniffFormat("tb.xls", enc("<html><table><tr><td>a</td></tr></table>"))).toBe(
      "markup",
    );
    expect(sniffFormat("tb.txt", enc('[{"a":1}]'))).toBe("json");
    expect(sniffFormat("tb.dat", enc("Particulars\tDebit\n"))).toBe("text");
    expect(sniffFormat("notes.docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(
      "document",
    );
  });

  it("reads a tab-separated export saved as .txt", async () => {
    const r = await readSourceFile(
      "TB March.txt",
      enc("Particulars\tDebit\tCredit\nCash\t100\t\nCapital\t\t100\n"),
      LIMITS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(texts(r.sheets[0]?.rows ?? [])).toEqual([
      ["Particulars", "Debit", "Credit"],
      ["Cash", "100", ""],
      ["Capital", "", "100"],
    ]);
  });

  it("reads an HTML table saved with an .xls extension", async () => {
    const r = await readSourceFile(
      "tb.xls",
      enc(
        "<html><body><table><tr><td>Account</td><td>Balance</td></tr><tr><td>Cash</td><td>250</td></tr></table></body></html>",
      ),
      LIMITS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.format).toBe("markup");
    expect(texts(r.sheets[0]?.rows ?? []).flat()).toContain("Cash");
  });

  it("reads a JSON array of records as one sheet", async () => {
    const r = await readSourceFile(
      "tb.json",
      enc(
        JSON.stringify({
          rows: [{ account: "Cash", balance: 10 }, { account: "Sales" }],
        }),
      ),
      LIMITS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(texts(r.sheets[0]?.rows ?? [])).toEqual([
      ["account", "balance"],
      ["Cash", "10"],
      ["Sales", ""],
    ]);
  });

  it("refuses photos and documents with a reason, and empty files as empty", async () => {
    expect(
      await readSourceFile("tb.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0x00]), LIMITS),
    ).toEqual({ ok: false, reason: "image" });
    expect(await readSourceFile("tb.docx", enc("x"), LIMITS)).toEqual({
      ok: false,
      reason: "document",
    });
    expect(await readSourceFile("tb.csv", enc("\n\n , \n"), LIMITS)).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("reads the table out of a text PDF", async () => {
    const pdf = buildPdf([
      ["Trial Balance as at 31-Mar-2026", 40, 760],
      ["Particulars", 40, 720],
      ["Debit", 300, 720],
      ["Credit", 400, 720],
      ["Cash", 40, 700],
      ["1,000.00", 290, 700],
      ["Capital", 40, 680],
      ["1,000.00", 390, 680],
    ]);
    const r = await readSourceFile("tb.pdf", pdf, LIMITS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = texts(r.sheets[0]?.rows ?? []);
    expect(rows[0]?.join(" ").trim()).toContain("Trial Balance");
    const cash = rows.find((row) => row[0] === "Cash");
    const capital = rows.find((row) => row[0] === "Capital");
    const header = rows.find((row) => row[0] === "Particulars");
    // Each amount sits under its own heading, whatever the exact column indices.
    expect(cash?.indexOf("1,000.00")).toBe(header?.indexOf("Debit"));
    expect(capital?.indexOf("1,000.00")).toBe(header?.indexOf("Credit"));
  });
});

describe("rebuilding a table from positioned text", () => {
  const at = (
    str: string,
    x: number,
    y: number,
    width: number,
    page = 1,
  ): PositionedText => ({ str, x, y, width, height: 10, page });

  it("puts right-aligned amounts under their headings and drops page furniture", () => {
    const grid = gridFromPositionedText("tb", [
      at("Particulars", 40, 700, 60),
      at("Debit", 300, 700, 30),
      at("Credit", 400, 700, 35),
      at("Sundry", 40, 680, 35),
      at("Debtors", 78, 680, 40),
      at("1,000.00", 290, 680, 40),
      at("Page 1 of 2", 250, 40, 60),
      // Page two repeats the headings, then continues.
      at("Particulars", 40, 700, 60, 2),
      at("Debit", 300, 700, 30, 2),
      at("Credit", 400, 700, 35, 2),
      at("Capital", 40, 680, 40, 2),
      at("1,000.00", 395, 680, 40, 2),
    ]);
    expect(texts(grid.rows)).toEqual([
      ["Particulars", "Debit", "Credit"],
      ["Sundry Debtors", "1,000.00"],
      ["Capital", "", "1,000.00"],
    ]);
  });
});
