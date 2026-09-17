/**
 * Sheet and row counts of an .xlsx without a spreadsheet library (ADR 0032).
 *
 * Before payment the customer sees only counts. On a 50 MB workbook SheetJS takes most of a
 * minute inside the web server to build a workbook we then throw away, which broke the SPEC §33
 * budget. An .xlsx is a zip of XML parts: each worksheet is one part, and each non-empty row is a
 * `<row>` element holding at least one cell with a value. So the worksheet parts are inflated
 * with Node's native zlib and their rows counted by scanning the text — no cells are built.
 *
 * Structure per ECMA-376 Part 1 §18.3.1.73 (row) and §18.3.1.4 (c); zip layout per PKWARE
 * APPNOTE §4.3.7 (local file header, 0x04034b50) and §4.3.12 (central directory header).
 * Returns null whenever the archive is anything but a plain workbook this can read with
 * certainty (ZIP64, an unknown compression method, a malformed part), and the caller falls back
 * to the full reader.
 */

const EOCD = 0x06054b50;
const CDH = 0x02014b50;
const LFH = 0x04034b50;
const WORKSHEET = /^xl\/worksheets\/sheet[^/]*\.xml$/u;

interface ZlibLike {
  inflateRawSync(data: Uint8Array): Uint8Array;
}

const zlib = (): ZlibLike | null => {
  if (typeof process === "undefined" || typeof process.getBuiltinModule !== "function")
    return null;
  try {
    return process.getBuiltinModule("node:zlib");
  } catch {
    return null;
  }
};

/** Rows with at least one cell carrying a value (`<v>` or inline `<is>`) in one worksheet part. */
export function countWorksheetRows(xml: string): number {
  let rows = 0;
  // The next value and inline-string markers are found once and only moved forward, so the scan
  // stays linear however many rows lack one (a search per row would be quadratic).
  let nextV = xml.indexOf("<v");
  let nextIs = xml.indexOf("<is>");
  let at = xml.indexOf("<row");
  while (at >= 0) {
    const open = xml.indexOf(">", at);
    if (open < 0) break;
    // A self-closing `<row .../>` holds no cells.
    if (xml.charCodeAt(open - 1) === 47 /* / */) {
      at = xml.indexOf("<row", open);
      continue;
    }
    const close = xml.indexOf("</row>", open);
    if (close < 0) break;
    if (nextV >= 0 && nextV < open) nextV = xml.indexOf("<v", open);
    if (nextIs >= 0 && nextIs < open) nextIs = xml.indexOf("<is>", open);
    if ((nextV >= 0 && nextV < close) || (nextIs >= 0 && nextIs < close)) rows += 1;
    at = xml.indexOf("<row", close);
  }
  return rows;
}

export function countXlsx(bytes: Uint8Array): { sheets: number; rows: number } | null {
  const z = zlib();
  if (z === null) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minStart = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minStart; i -= 1) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdOffset === 0xffffffff) return null;

  const decoder = new TextDecoder("utf-8");
  let pos = cdOffset;
  let sheets = 0;
  let rows = 0;
  for (let n = 0; n < entries; n += 1) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== CDH) return null;
    const method = view.getUint16(pos + 10, true);
    const compressed = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const local = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;
    if (!WORKSHEET.test(name)) continue;
    if (compressed === 0xffffffff || local === 0xffffffff) return null;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LFH) return null;
    const start =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    let part: Uint8Array;
    if (method === 8) {
      try {
        part = z.inflateRawSync(data);
      } catch {
        return null;
      }
    } else if (method === 0) {
      part = data;
    } else {
      return null;
    }
    sheets += 1;
    rows += countWorksheetRows(decoder.decode(part));
  }
  return sheets === 0 ? null : { sheets, rows };
}
