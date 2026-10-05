/**
 * What a company logo may be, decided from its bytes (no I/O, so the browser and the server run
 * the same check).
 *
 * The browser's own idea of a file's type is a hint at best: the extension is whatever the file
 * was called, and the MIME type is derived from it. So the type here is read from the signature
 * at the start of the file, and the width and height from the header of that format, because a
 * small file can still declare a canvas a browser has to allocate to draw. SVG is not offered: it
 * is a document that can carry script, and a logo is shown inside a signed-in page.
 */

export type LogoType = "image/png" | "image/jpeg" | "image/webp";

/** What the file picker offers; the server still reads the bytes. */
export const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";

export interface LogoLimits {
  readonly maxBytes: number;
  readonly maxSidePx: number;
}

export type LogoCheck =
  | { ok: true; type: LogoType; width: number; height: number }
  | {
      ok: false;
      code: "logo_empty" | "logo_too_large" | "logo_type" | "logo_dimensions";
      message: string;
    };

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number) => u16le(b, i) | ((b[i + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, i: number) =>
  (((b[i] ?? 0) << 24) >>> 0) +
  (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
const ascii = (b: Uint8Array, i: number, n: number) =>
  String.fromCharCode(...b.subarray(i, i + n));

function png(b: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => b[i] === v)) return null;
  // The first chunk is always IHDR: width and height, four bytes each.
  if (ascii(b, 12, 4) !== "IHDR") return { width: 0, height: 0 };
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  // Walk the markers to the first start-of-frame, which holds the dimensions.
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Markers without a length: start of image, end of image, restarts and TEM.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const length = u16be(b, i + 2);
    const sof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (sof) return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    if (length < 2) break;
    i += 2 + length;
  }
  return { width: 0, height: 0 };
}

function webp(b: Uint8Array): { width: number; height: number } | null {
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (chunk === "VP8L" && b[20] === 0x2f) {
    const bits =
      (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  // Lossy: a keyframe's start code, then 14-bit width and height.
  if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  return { width: 0, height: 0 };
}

export function checkLogo(bytes: Uint8Array, limits: LogoLimits): LogoCheck {
  if (bytes.byteLength === 0)
    return { ok: false, code: "logo_empty", message: "That file is empty." };
  if (bytes.byteLength > limits.maxBytes)
    return {
      ok: false,
      code: "logo_too_large",
      message: `A logo can be at most ${megabytes(limits.maxBytes)}. Save it smaller and try again.`,
    };
  const found: [LogoType, { width: number; height: number } | null][] = [
    ["image/png", png(bytes)],
    ["image/jpeg", jpeg(bytes)],
    ["image/webp", webp(bytes)],
  ];
  const hit = found.find(([, d]) => d !== null);
  if (hit === undefined)
    return {
      ok: false,
      code: "logo_type",
      message: "A logo must be a JPG, PNG or WebP image.",
    };
  const [type, dims] = hit;
  if (dims === null || dims.width < 1 || dims.height < 1)
    return {
      ok: false,
      code: "logo_type",
      message: "That image could not be read. Save it again as a JPG, PNG or WebP.",
    };
  if (Math.max(dims.width, dims.height) > limits.maxSidePx)
    return {
      ok: false,
      code: "logo_dimensions",
      message: `That image is ${dims.width.toString()} × ${dims.height.toString()} pixels. A logo can be at most ${limits.maxSidePx.toString()} pixels on its longer side.`,
    };
  return { ok: true, type, width: dims.width, height: dims.height };
}

/** "1 MB", or "512 KB" below a megabyte. */
export function megabytes(n: number): string {
  return n >= 1_048_576 && n % 1_048_576 === 0
    ? `${(n / 1_048_576).toString()} MB`
    : n >= 1_048_576
      ? `${(n / 1_048_576).toFixed(1)} MB`
      : `${Math.floor(n / 1024).toString()} KB`;
}

/** The URL a company's logo is served from; the version makes it cacheable for good. */
export function logoUrl(companyId: string, version: string | null): string | null {
  return version === null ? null : `/api/companies/${companyId}/logo?v=${version}`;
}
