/**
 * Any file a customer has, read into grids (ADR 0031, ADR 0032).
 *
 * The extension is a hint, not a gate. What a file is decided from its first bytes, because
 * accounting exports are routinely renamed, saved with the wrong extension, or downloaded as
 * `report.xls` when they are really HTML. Every spreadsheet format SheetJS reads is accepted
 * (xlsx, xlsm, xlsb, xls, ods, fods, numbers, SpreadsheetML, HTML tables, dbf, sylk), text
 * tables in any common delimiter, JSON arrays of records, and text PDFs.
 *
 * What cannot be read without sending the file somewhere — photographs, scans, Word documents
 * — is refused with the reason: there is no text in them to read without OCR. The refusal
 * names what to export instead; it never says only "unsupported".
 */

import { decodeText, readCsvGrid } from "./csv";
import { countExcel, readExcel } from "./excel";
import { gridFromText, isBlankRow, type SheetGrid } from "./grid";
import { readPdf } from "./pdf";
import { countXlsx } from "./xlsx-count";
import { inspectZip, type ZipLimits } from "./zip";

export type SourceRefusal =
  /** A photo or scan: there is no text to read without OCR. */
  | "image"
  /** A word-processor or presentation file. */
  | "document"
  /** A PDF with no text layer (a scan). */
  | "scanned_pdf"
  /** A zip-based workbook whose declared contents are too large to open safely. */
  | "unsafe_workbook"
  /** Read, but nothing in it. */
  | "empty"
  /** Not a format anything here can parse. */
  | "unreadable";

export type SourceFormat =
  "workbook" | "legacy_workbook" | "pdf" | "text" | "markup" | "json";

export type SourceRead =
  | { readonly ok: true; readonly format: SourceFormat; readonly sheets: SheetGrid[] }
  | { readonly ok: false; readonly reason: SourceRefusal };

const startsWith = (bytes: Uint8Array, ...sig: number[]) =>
  sig.every((b, i) => bytes[i] === b);

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|tiff?|webp|heic|heif|avif)$/iu;
const DOCUMENT_EXT = /\.(docx?|pptx?|odt|odp|rtf|pages|key)$/iu;

export function sniffFormat(
  name: string,
  bytes: Uint8Array,
): SourceFormat | "image" | "document" {
  if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46)) return "pdf"; // %PDF
  if (
    startsWith(bytes, 0x89, 0x50, 0x4e, 0x47) || // PNG
    startsWith(bytes, 0xff, 0xd8, 0xff) || // JPEG
    startsWith(bytes, 0x47, 0x49, 0x46, 0x38) || // GIF8
    startsWith(bytes, 0x49, 0x49, 0x2a, 0x00) || // TIFF little-endian
    startsWith(bytes, 0x4d, 0x4d, 0x00, 0x2a) || // TIFF big-endian
    IMAGE_EXT.test(name)
  )
    return "image";
  if (DOCUMENT_EXT.test(name)) return "document";
  if (startsWith(bytes, 0x50, 0x4b, 0x03, 0x04)) return "workbook"; // PK: xlsx, xlsb, ods, numbers
  if (startsWith(bytes, 0xd0, 0xcf, 0x11, 0xe0)) return "legacy_workbook"; // OLE2: xls
  const head = decodeText(bytes.subarray(0, 4096)).text.trimStart().toLowerCase();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (
    head.startsWith("<") &&
    (head.includes("<table") ||
      head.includes("<html") ||
      head.includes("<?xml") ||
      head.includes("<workbook") ||
      head.includes("<!doctype"))
  )
    return "markup";
  return "text";
}

const hasContent = (sheets: readonly SheetGrid[]) =>
  sheets.some((s) => s.rows.some((r) => !isBlankRow(r)));

/** A JSON array of flat records becomes one sheet: keys are the header, values the rows. */
function readJson(bytes: Uint8Array, name: string): SheetGrid[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeText(bytes).text);
  } catch {
    return null;
  }
  const records = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed).find(Array.isArray)
      : undefined;
  if (!Array.isArray(records)) return null;
  const rows = records.filter(
    (r): r is Record<string, unknown> =>
      typeof r === "object" && r !== null && !Array.isArray(r),
  );
  if (rows.length === 0) return null;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const text = (v: unknown): string =>
    typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "boolean"
        ? v.toString()
        : v === null || v === undefined
          ? ""
          : JSON.stringify(v);
  return [gridFromText(name, [keys, ...rows.map((r) => keys.map((k) => text(r[k])))])];
}

const baseName = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/iu, "");

export async function readSourceFile(
  name: string,
  bytes: Uint8Array,
  limits: ZipLimits,
  /** Values only, for counting sheets and rows (see `ReadExcelOptions.lite`). */
  options: { lite?: boolean } = {},
): Promise<SourceRead> {
  const excel = { lite: options.lite === true };
  const format = sniffFormat(name, bytes);
  if (format === "image" || format === "document") return { ok: false, reason: format };

  const attempt = async (): Promise<SourceRead> => {
    switch (format) {
      case "pdf": {
        const sheets = await readPdf(bytes, baseName(name));
        return sheets.length === 0
          ? { ok: false, reason: "scanned_pdf" }
          : { ok: true, format, sheets };
      }
      case "workbook": {
        const zip = inspectZip(bytes, limits);
        if (!zip.ok) return { ok: false, reason: "unsafe_workbook" };
        return { ok: true, format, sheets: [...readExcel(bytes, excel).sheets] };
      }
      case "legacy_workbook":
      case "markup":
        return { ok: true, format, sheets: [...readExcel(bytes, excel).sheets] };
      case "json": {
        const sheets = readJson(bytes, baseName(name));
        return sheets === null
          ? {
              ok: true,
              format: "text",
              sheets: [readCsvGrid(bytes, baseName(name)).grid],
            }
          : { ok: true, format, sheets };
      }
      case "text":
        return { ok: true, format, sheets: [readCsvGrid(bytes, baseName(name)).grid] };
    }
  };

  let read: SourceRead;
  try {
    read = await attempt();
  } catch {
    // A mislabelled or slightly malformed file: one more try as whatever SheetJS makes of it.
    try {
      read = {
        ok: true,
        format: "workbook",
        sheets: [...readExcel(bytes, excel).sheets],
      };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  }
  if (!read.ok) return read;
  return hasContent(read.sheets) ? read : { ok: false, reason: "empty" };
}

/** What to tell a customer about a refused file: the reason, and what to do instead. */
export const SOURCE_REFUSAL_MESSAGES: Record<SourceRefusal, string> = {
  image:
    "This is a photo or scan, which has no text that can be read. Export the report from your accounting software as Excel, CSV or PDF instead.",
  document:
    "This is a document rather than a report export. Export the report from your accounting software as Excel, CSV or PDF instead.",
  scanned_pdf:
    "This PDF is a scanned image with no text in it. Export the report from your accounting software as Excel, CSV or a regular PDF instead.",
  unsafe_workbook: "This workbook's contents are too large or malformed to open safely.",
  empty: "This file has no data in it.",
  unreadable:
    "This file couldn't be read. Check that it opens on your computer, or export it again as Excel, CSV or PDF.",
};

/**
 * What the upload step shows before payment: sheet and row counts, or a refusal (ADR 0032).
 * Workbooks are counted without building cells; everything else is small enough to read.
 */
export async function countSourceFile(
  name: string,
  bytes: Uint8Array,
  limits: ZipLimits,
): Promise<
  | { readonly ok: true; readonly sheets: number; readonly rows: number }
  | { readonly ok: false; readonly reason: SourceRefusal }
> {
  const format = sniffFormat(name, bytes);
  if (format === "workbook" || format === "legacy_workbook") {
    if (format === "workbook" && !inspectZip(bytes, limits).ok)
      return { ok: false, reason: "unsafe_workbook" };
    try {
      const counted =
        (format === "workbook" ? countXlsx(bytes) : null) ?? countExcel(bytes);
      return counted.rows === 0
        ? { ok: false, reason: "empty" }
        : { ok: true, ...counted };
    } catch {
      // Fall through to the full reader, which has its own recovery.
    }
  }
  const read = await readSourceFile(name, bytes, limits, { lite: true });
  if (!read.ok) return read;
  const rows = read.sheets.reduce(
    (n, g) => n + g.rows.filter((r) => !isBlankRow(r)).length,
    0,
  );
  return { ok: true, sheets: read.sheets.length, rows };
}
