/**
 * PDF → grid, in the browser (ADR 0031).
 *
 * Accounting systems print trial balances to PDF as often as they export them, and a customer
 * who has only the PDF should not be turned away. A text PDF carries every string with its
 * position, so a table can be rebuilt without OCR: strings on the same baseline form a row, and
 * strings that line up vertically across rows form a column. Scanned PDFs carry no text and
 * yield an empty grid, which the caller reports as unreadable.
 *
 * pdf.js 6.3 (Mozilla, `pdfjs-dist`), legacy build so it also runs under Node for tests. Its
 * worker module is imported first: that registers `globalThis.pdfjsWorker`, and pdf.js then
 * runs its parser in the current thread (`PDFWorker#initialize` checks for it) — which is
 * already our ingestion Web Worker — instead of spawning a worker from a URL. The PDF never
 * leaves the tab. pdf.js no longer compiles fonts with `eval`, so our CSP needs no exception;
 * nothing is rendered, so fonts are not needed at all.
 */

import type { Cell, SheetGrid } from "./grid";

export interface PositionedText {
  readonly str: string;
  /** Left edge, in PDF user space. */
  readonly x: number;
  /** Baseline; larger is higher on the page. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly page: number;
}

const NUMERIC = /^[(-]?[\d,.\s]+\)?\s*(?:dr|cr)?\.?$/iu;
const NOISE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|continued\.*|\(?contd\.?\)?)$/iu;

interface Fragment {
  text: string;
  x: number;
  right: number;
}

/**
 * Rows and columns from positioned strings.
 *
 * Text is anchored on its left edge and numbers on their right edge, because that is how
 * accounting reports align them; anchors within a few points of each other are one column.
 */
export function gridFromPositionedText(
  name: string,
  items: readonly PositionedText[],
): SheetGrid {
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  const lines: Fragment[][] = [];

  for (const page of pages) {
    const onPage = items
      .filter((i) => i.page === page && i.str.trim() !== "")
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const pageLines: PositionedText[][] = [];
    for (const item of onPage) {
      const tolerance = Math.max(2, item.height * 0.5);
      const line = pageLines.find((l) => Math.abs((l[0]?.y ?? 0) - item.y) <= tolerance);
      if (line) line.push(item);
      else pageLines.push([item]);
    }
    for (const [index, line] of pageLines.entries()) {
      line.sort((a, b) => a.x - b.x);
      // Strings closer than about a character apart are one cell ("Sundry" "Debtors").
      const fragments: Fragment[] = [];
      for (const item of line) {
        const last = fragments.at(-1);
        const gap = last === undefined ? Infinity : item.x - last.right;
        const charWidth = item.str.length > 0 ? item.width / item.str.length : 4;
        if (last !== undefined && gap < Math.max(1.5, charWidth * 1.2)) {
          last.text = `${last.text}${gap > charWidth * 0.2 ? " " : ""}${item.str}`;
          last.right = item.x + item.width;
        } else {
          fragments.push({ text: item.str, x: item.x, right: item.x + item.width });
        }
      }
      const joined = fragments
        .map((f) => f.text.trim())
        .join(" ")
        .trim();
      if (NOISE.test(joined)) continue;
      // Reports repeat their title and column headings on every page; keep the first.
      if (index < 6 && page !== pages[0]) {
        const seenAtTop = lines.slice(0, 8).some(
          (l) =>
            l
              .map((f) => f.text.trim())
              .join(" ")
              .trim() === joined,
        );
        if (seenAtTop) continue;
      }
      lines.push(fragments);
    }
  }

  // Numbers are right-aligned: their right edges, clustered, are the amount columns. A
  // heading over an amount column ("Debit") is text, but it spans that column's right edge,
  // so it joins the column rather than starting one of its own.
  const cluster = (values: readonly number[]) => {
    const out: { from: number; to: number }[] = [];
    for (const v of [...values].sort((a, b) => a - b)) {
      const last = out.at(-1);
      if (last !== undefined && v - last.to <= 6) last.to = v;
      else out.push({ from: v, to: v });
    }
    return out;
  };
  const isNumber = (f: Fragment) => NUMERIC.test(f.text.trim());
  const all = lines.flat();
  const numeric = cluster(all.filter(isNumber).map((f) => f.right));
  const overNumeric = (f: Fragment) =>
    numeric.findIndex((c) => f.x - 6 <= c.to && f.right + 6 >= c.from);
  const text = cluster(
    all.filter((f) => !isNumber(f) && overNumeric(f) < 0).map((f) => f.x),
  );
  const columns = [
    ...text.map((c) => ({ kind: "text" as const, c, at: c.from })),
    ...numeric.map((c) => ({ kind: "number" as const, c, at: c.to })),
  ].sort((a, b) => a.at - b.at);
  const columnOf = (f: Fragment): number => {
    const inRange = (c: { from: number; to: number }, v: number) =>
      v >= c.from - 0.01 && v <= c.to + 0.01;
    if (isNumber(f)) {
      const i = columns.findIndex(
        (col) => col.kind === "number" && inRange(col.c, f.right),
      );
      if (i >= 0) return i;
    }
    const n = overNumeric(f);
    if (n >= 0) return columns.findIndex((col) => col.c === numeric[n]);
    const i = columns.findIndex((col) => col.kind === "text" && inRange(col.c, f.x));
    return i < 0 ? 0 : i;
  };

  const rows = lines.map((line) => {
    const row: (Cell | undefined)[] = [];
    for (const f of line) {
      const col = columnOf(f);
      const text = f.text.trim();
      const existing = row[col];
      row[col] =
        existing === undefined
          ? { value: text, text }
          : { value: `${existing.text} ${text}`, text: `${existing.text} ${text}` };
    }
    return row;
  });

  return { name, hidden: false, rows, hiddenRows: [], merges: [] };
}

interface PdfTextItem {
  readonly str?: string;
  readonly transform?: readonly number[];
  readonly width?: number;
  readonly height?: number;
}

/** Every text string in a PDF with its position. Empty for a scanned (image-only) PDF. */
export async function pdfText(bytes: Uint8Array): Promise<PositionedText[]> {
  // @ts-expect-error -- the worker module ships no type declarations; it is imported only for
  // its side effect of registering `globalThis.pdfjsWorker`.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    // pdf.js takes ownership of the buffer it is given; hand it a copy.
    data: bytes.slice(),
    useWorkerFetch: false,
    disableFontFace: true,
    stopAtErrors: false,
    // Nothing is rendered, so missing font data is not worth a console warning.
    verbosity: 0,
  });
  const doc = await task.promise;
  const out: PositionedText[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const raw of content.items as readonly PdfTextItem[]) {
        if (typeof raw.str !== "string" || raw.transform === undefined) continue;
        out.push({
          str: raw.str,
          x: raw.transform[4] ?? 0,
          y: raw.transform[5] ?? 0,
          width: raw.width ?? 0,
          height: raw.height ?? 0,
          page: p,
        });
      }
    }
  } finally {
    await task.destroy();
  }
  return out;
}

export async function readPdf(bytes: Uint8Array, name: string): Promise<SheetGrid[]> {
  const items = await pdfText(bytes);
  if (items.every((i) => i.str.trim() === "")) return [];
  return [gridFromPositionedText(name, items)];
}
