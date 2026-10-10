/**
 * Zip-bomb guard for xlsx/xlsm (SPEC §15): read the ZIP central directory — entry count and
 * declared uncompressed sizes — and refuse before any decompression happens.
 *
 * Format per PKWARE APPNOTE.TXT §4.3.16 (end of central directory, signature 0x06054b50),
 * §4.3.12 (central directory header, 0x02014b50) and §4.3.14/4.5.3 (ZIP64).
 * https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 *
 * Declared sizes can lie, and since ADR 0032 the reader runs inside the web server, where a
 * lying archive would take the whole instance down rather than one tab. So `inspectZip` bounds
 * what the archive claims, and `entriesKeepTheirWord` then inflates every entry with zlib's
 * output capped one byte past its declared size: an entry that grows beyond what it declared is
 * refused before SheetJS — which inflates each entry to its end with no cap — ever sees it
 * (ADR 0091).
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

const LFH = 0x04034b50;

interface InflateStream {
  on(event: "data", listener: (chunk: Uint8Array) => void): unknown;
  on(event: "end" | "error", listener: () => void): unknown;
  end(data: Uint8Array): unknown;
  destroy(): unknown;
}

interface ZlibLike {
  createInflateRaw(): InflateStream;
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

/** Whether a raw deflate stream inflates to no more than `limit` bytes, holding none of them. */
function inflatesWithin(z: ZlibLike, data: Uint8Array, limit: number): Promise<boolean> {
  return new Promise((resolve) => {
    const stream = z.createInflateRaw();
    let total = 0;
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      resolve(ok);
    };
    stream.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) settle(false);
    });
    stream.on("end", () => {
      settle(true);
    });
    // Corrupt or cut short: no danger, and the reader refuses it with its own reason.
    stream.on("error", () => {
      settle(true);
    });
    stream.end(data);
  });
}

/**
 * Whether no deflated entry inflates to more than the central directory declared for it. Run
 * only after `inspectZip` has passed, so the declared sizes it trusts are already bounded, and
 * with them the work done here. The output is counted as it streams and dropped, so checking an
 * entry never holds it in memory.
 *
 * Each entry is inflated from its data offset to the end of its deflate stream, as SheetJS reads
 * it — not over the compressed length the directory states, which a crafted archive could set
 * short of a longer stream. A stream that is merely corrupt, or shorter than declared, is no
 * danger and is left for the reader to refuse; only growth past the declared size is.
 */
export async function entriesKeepTheirWord(bytes: Uint8Array): Promise<boolean> {
  const z = zlib();
  // Every caller is on the server; refusing where there is no zlib is the safe answer.
  if (z === null) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minStart = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minStart; i -= 1) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return false;
  const entries = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  for (let n = 0; n < entries; n += 1) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== CDH) return false;
    const method = view.getUint16(pos + 10, true);
    const declared = view.getUint32(pos + 24, true);
    const local = view.getUint32(pos + 42, true);
    pos +=
      46 +
      view.getUint16(pos + 28, true) +
      view.getUint16(pos + 30, true) +
      view.getUint16(pos + 32, true);
    if (method !== 8) continue;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LFH) return false;
    const start =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (!(await inflatesWithin(z, bytes.subarray(start), declared))) return false;
  }
  return true;
}
