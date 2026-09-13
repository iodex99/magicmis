/**
 * Backup codes (SPEC §8): issued at TOTP enrolment, stored hashed, single use,
 * regenerable after re-authentication.
 *
 * Codes are 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L), shown as
 * `XXXX-XXXX`. That is ~39.6 bits per code -- not enough on its own against an online
 * attacker, which is why redemption is throttled per account and per IP.
 *
 * Hashing is scrypt with a per-code random salt, with the parameters stored alongside the
 * hash so they can be raised later without invalidating issued codes.
 */

import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const WELL_FORMED = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/u;

/** scrypt cost. N=2^14, r=8 needs 16 MiB, inside Node's default 32 MiB maxmem. */
const SCRYPT = { N: 16_384, r: 8, p: 1, keyLength: 32, saltLength: 16 } as const;

/** A fresh code, formatted for display. Uses `randomInt`, which is unbiased. */
export function generateBackupCode(): string {
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    raw += ALPHABET[randomInt(ALPHABET.length)] ?? "";
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function generateBackupCodes(count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new RangeError(`generateBackupCodes: count ${String(count)} out of range`);
  }
  const codes = new Set<string>();
  // A Set, because a duplicate code within one batch would silently halve its value.
  while (codes.size < count) codes.add(generateBackupCode());
  return [...codes];
}

/**
 * Canonicalise user input: upper-case, strip spaces and hyphens.
 *
 * No look-alike folding. The alphabet already excludes 0, O, 1, I and L, so there is no
 * in-alphabet character to fold a mistyped one onto; folding would only convert a typo
 * into a different wrong character.
 */
export function normaliseBackupCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/gu, "");
}

export const isWellFormedBackupCode = (normalised: string): boolean =>
  WELL_FORMED.test(normalised);

interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keyLength: number;
}

function scryptAsync(
  password: string,
  salt: Buffer,
  params: ScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      params.keyLength,
      { N: params.N, r: params.r, p: params.p },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function hashBackupCode(code: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltLength);
  const key = await scryptAsync(normaliseBackupCode(code), salt, SCRYPT);
  return [
    "scrypt",
    String(SCRYPT.N),
    String(SCRYPT.r),
    String(SCRYPT.p),
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/** Constant-time comparison against a stored hash. Malformed hashes never match. */
export async function verifyBackupCode(code: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const params: ScryptParams = {
    keyLength: SCRYPT.keyLength,
    N: Number.parseInt(n ?? "", 10),
    r: Number.parseInt(r ?? "", 10),
    p: Number.parseInt(p ?? "", 10),
  };
  if (![params.N, params.r, params.p].every((v) => Number.isInteger(v) && v > 0))
    return false;
  // Refuse parameters we would never issue: a tampered row must not be able to make
  // verification burn unbounded memory or CPU.
  if (params.N > 65_536 || params.r > 16 || params.p > 4) return false;

  const expected = Buffer.from(hashB64 ?? "", "base64");
  if (expected.length !== SCRYPT.keyLength) return false;

  const actual = await scryptAsync(
    normaliseBackupCode(code),
    Buffer.from(saltB64 ?? "", "base64"),
    params,
  );
  return timingSafeEqual(actual, expected);
}
