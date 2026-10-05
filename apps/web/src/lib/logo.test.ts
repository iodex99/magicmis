import { describe, expect, it } from "vitest";

import { checkLogo, logoUrl, megabytes } from "./logo";

/**
 * A logo is judged by its bytes, never its name. Each fixture is the smallest real header of its
 * format, carrying the width and height the way that format writes them.
 */
const LIMITS = { maxBytes: 1_048_576, maxSidePx: 4096 };
/** ASCII text as bytes. */
const ascii = (s: string): number[] =>
  Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  b.set(ascii("IHDR"), 12);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment to walk past, then SOF0 with height before width.
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array<number>(14).fill(0)];
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...new Array<number>(12).fill(0)]);
}

function riff(chunk: string, payload: number[]): Uint8Array {
  return new Uint8Array([
    ...ascii("RIFF"),
    0,
    0,
    0,
    0,
    ...ascii("WEBP"),
    ...ascii(chunk),
    0,
    0,
    0,
    0,
    ...payload,
  ]);
}
const webpLossy = (w: number, h: number) =>
  riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8]);
const webpLossless = (w: number, h: number) => {
  const bits = (w - 1) | ((h - 1) << 14);
  return riff("VP8L", [
    0x2f,
    bits & 255,
    (bits >> 8) & 255,
    (bits >> 16) & 255,
    (bits >>> 24) & 255,
  ]);
};
const webpExtended = (w: number, h: number) =>
  riff("VP8X", [
    0,
    0,
    0,
    0,
    (w - 1) & 255,
    ((w - 1) >> 8) & 255,
    ((w - 1) >> 16) & 255,
    (h - 1) & 255,
    ((h - 1) >> 8) & 255,
    ((h - 1) >> 16) & 255,
  ]);

describe("a company logo", () => {
  it("is read as what its bytes are, with the size its header declares", () => {
    expect(checkLogo(png(400, 120), LIMITS)).toEqual({
      ok: true,
      type: "image/png",
      width: 400,
      height: 120,
    });
    expect(checkLogo(jpeg(800, 300), LIMITS)).toMatchObject({
      type: "image/jpeg",
      width: 800,
      height: 300,
    });
    expect(checkLogo(webpLossy(320, 100), LIMITS)).toMatchObject({
      type: "image/webp",
      width: 320,
      height: 100,
    });
    expect(checkLogo(webpLossless(512, 256), LIMITS)).toMatchObject({
      width: 512,
      height: 256,
    });
    expect(checkLogo(webpExtended(1024, 400), LIMITS)).toMatchObject({
      width: 1024,
      height: 400,
    });
  });

  it("is refused when it is not a JPG, PNG or WebP, whatever it is called", () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
    );
    const gif = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");
    for (const bytes of [svg, gif, new Uint8Array([1, 2, 3, 4])])
      expect(checkLogo(bytes, LIMITS)).toMatchObject({ ok: false, code: "logo_type" });
    expect(checkLogo(new Uint8Array(0), LIMITS)).toMatchObject({ code: "logo_empty" });
  });

  it("is refused over the size limit, and over the pixel limit however small the file", () => {
    const big = new Uint8Array(LIMITS.maxBytes + 1);
    big.set(png(10, 10));
    expect(checkLogo(big, LIMITS)).toMatchObject({ code: "logo_too_large" });
    // Thirty-three bytes that ask a browser for a 30,000-pixel canvas.
    expect(checkLogo(png(30_000, 200), LIMITS)).toMatchObject({
      code: "logo_dimensions",
    });
    expect(checkLogo(png(0, 10), LIMITS)).toMatchObject({ code: "logo_type" });
  });

  it("is served from a URL that changes when it does", () => {
    expect(logoUrl("c1", null)).toBeNull();
    expect(logoUrl("c1", "v2")).toBe("/api/companies/c1/logo?v=v2");
    expect(megabytes(1_048_576)).toBe("1 MB");
    expect(megabytes(524_288)).toBe("512 KB");
  });
});
