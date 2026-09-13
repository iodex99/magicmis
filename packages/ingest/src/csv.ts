/**
 * CSV encoding and delimiter detection, and a bounded RFC 4180 reader for the rows header
 * detection needs (SPEC §15). Full CSV bodies are loaded by DuckDB from the registered file,
 * never materialised as JS objects.
 */

import { gridFromText, type SheetGrid } from "./grid";

export type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export function detectEncoding(bytes: Uint8Array): {
  encoding: TextEncodingName;
  bomLength: number;
} {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { encoding: "utf-8", bomLength: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { encoding: "utf-16le", bomLength: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { encoding: "utf-16be", bomLength: 2 };
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, Math.min(bytes.length, 1 << 20)),
    );
    return { encoding: "utf-8", bomLength: 0 };
  } catch {
    // A truncated multi-byte sequence at the 1 MB cut is not evidence of another encoding.
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, Math.max(0, Math.min(bytes.length, (1 << 20) - 4))),
      );
      if (bytes.length > 1 << 20) return { encoding: "utf-8", bomLength: 0 };
    } catch {
      /* fall through */
    }
    return { encoding: "windows-1252", bomLength: 0 };
  }
}

export function decodeText(
  bytes: Uint8Array,
  maxBytes = Number.POSITIVE_INFINITY,
): { text: string; encoding: TextEncodingName } {
  const { encoding, bomLength } = detectEncoding(bytes);
  const slice = bytes.subarray(bomLength, Math.min(bytes.length, bomLength + maxBytes));
  return { text: new TextDecoder(encoding).decode(slice), encoding };
}

const CANDIDATES = [",", ";", "\t", "|"] as const;
export type Delimiter = (typeof CANDIDATES)[number];

/** Split one logical line into fields, honouring quotes. */
function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else quoted = false;
      } else current += ch;
    } else if (ch === '"' && current === "") quoted = true;
    else if (ch === delimiter) {
      fields.push(current);
      current = "";
    } else current += ch;
  }
  fields.push(current);
  return fields;
}

/** Logical lines (quoted newlines kept inside a field), up to `maxLines`. */
export function logicalLines(text: string, maxLines: number): string[] {
  const lines: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length && lines.length < maxLines; i += 1) {
    const ch = text.charAt(i);
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) {
      lines.push(text.slice(start, i));
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      start = i + 1;
    }
  }
  if (lines.length < maxLines && start < text.length) lines.push(text.slice(start));
  return lines;
}

/**
 * Choose the delimiter whose field counts are most consistent across non-blank lines and
 * that actually splits them. Ties prefer comma.
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = logicalLines(text, 200).filter((l) => l.trim() !== "");
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const multi = counts.filter((n) => n > 1);
    if (multi.length === 0) continue;
    const freq = new Map<number, number>();
    for (const n of multi) freq.set(n, (freq.get(n) ?? 0) + 1);
    const modeShare = Math.max(...freq.values()) / lines.length;
    const width = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
    const score = modeShare * 10 + Math.min(width, 50) / 50;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export interface CsvPreview {
  readonly encoding: TextEncodingName;
  readonly delimiter: Delimiter;
  readonly grid: SheetGrid;
}

/** The first `maxRows` rows as a grid, for header detection and type inference. */
export function previewCsv(bytes: Uint8Array, name: string, maxRows = 500): CsvPreview {
  const { text, encoding } = decodeText(bytes, 8 * 1024 * 1024);
  const delimiter = detectDelimiter(text);
  const rows = logicalLines(text, maxRows).map((l) => splitLine(l, delimiter));
  return { encoding, delimiter, grid: gridFromText(name, rows) };
}

/** Every row, for small files and tests. Large files go to DuckDB instead. */
export function readCsvGrid(bytes: Uint8Array, name: string): CsvPreview {
  return previewCsv(bytes, name, Number.MAX_SAFE_INTEGER);
}
