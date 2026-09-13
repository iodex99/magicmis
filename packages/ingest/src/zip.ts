/**
 * Zip-bomb guard for xlsx/xlsm (SPEC §15): read the ZIP central directory — entry count and
 * declared uncompressed sizes — and refuse before any decompression happens.
 *
 * Format per PKWARE APPNOTE.TXT §4.3.16 (end of central directory, signature 0x06054b50),
 * §4.3.12 (central directory header, 0x02014b50) and §4.3.14/4.5.3 (ZIP64).
 * https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 *
 * Declared sizes can lie. The guard bounds what a well-formed archive claims; the reader
 * additionally runs in a Web Worker the UI can terminate, and SheetJS is given the byte
 * limit, so a lying archive still cannot hang the tab.
 */

export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxUncompressedBytes: number;
  /** Maximum ratio of total declared uncompressed size to compressed file size. */
  readonly maxRatio: number;
}

export type ZipVerdict =
  | { readonly ok: true; readonly entries: number; readonly uncompressedBytes: number }
  | {
      readonly ok: false;
      readonly reason:
        | "not_zip"
        | "too_many_entries"
        | "too_large_uncompressed"
        | "ratio_exceeded"
        | "zip64_unsupported";
    };

const EOCD = 0x06054b50;
const CDH = 0x02014b50;

export function inspectZip(bytes: Uint8Array, limits: ZipLimits): ZipVerdict {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD is 22 bytes plus a comment of up to 65535 bytes at the very end.
  const minStart = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minStart; i -= 1) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, reason: "not_zip" };

  const totalEntries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (totalEntries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    // ZIP64 archives are refused: no spreadsheet this product accepts needs one.
    return { ok: false, reason: "zip64_unsupported" };
  }
  if (totalEntries > limits.maxEntries) return { ok: false, reason: "too_many_entries" };
  if (cdOffset + cdSize > bytes.length) return { ok: false, reason: "not_zip" };

  let pos = cdOffset;
  let uncompressed = 0;
  for (let n = 0; n < totalEntries; n += 1) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== CDH)
      return { ok: false, reason: "not_zip" };
    const size = view.getUint32(pos + 24, true);
    if (size === 0xffffffff) return { ok: false, reason: "zip64_unsupported" };
    uncompressed += size;
    if (uncompressed > limits.maxUncompressedBytes)
      return { ok: false, reason: "too_large_uncompressed" };
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  if (bytes.length > 0 && uncompressed / bytes.length > limits.maxRatio)
    return { ok: false, reason: "ratio_exceeded" };
  return { ok: true, entries: totalEntries, uncompressedBytes: uncompressed };
}
