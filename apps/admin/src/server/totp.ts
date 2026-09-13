/**
 * TOTP for admin sign-in, implemented from the RFCs with node:crypto (no dependency):
 * - RFC 4226 (HOTP): HMAC-SHA1, dynamic truncation, 6 digits. https://www.rfc-editor.org/rfc/rfc4226
 * - RFC 6238 (TOTP): T0 = 0, X = 30 s; §5.2 allows a small skew window and requires that a
 *   verifier not accept the same code twice. https://www.rfc-editor.org/rfc/rfc6238
 * - Base32 secrets per RFC 4648 §6, as authenticator apps expect.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const PERIOD_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31] ?? "";
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31] ?? "";
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/u, "").replace(/\s/gu, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new RangeError("invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, the length RFC 4226 §4 recommends for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: bigint): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

export const timeStep = (now: Date): bigint =>
  BigInt(Math.floor(now.getTime() / 1000 / PERIOD_SECONDS));

/**
 * Verify a code within ±1 step. Returns the matched step, or null. A step at or before
 * `lastAcceptedStep` is refused, so a code (or an older one) cannot be replayed.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  now: Date,
  lastAcceptedStep: bigint,
): bigint | null {
  if (!/^\d{6}$/u.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = timeStep(now);
  for (const step of [current - 1n, current, current + 1n]) {
    if (step <= lastAcceptedStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUri(input: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: DIGITS.toString(),
    period: PERIOD_SECONDS.toString(),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
