/**
 * Admin password hashing with scrypt (node:crypto). Parameters follow OWASP's Password
 * Storage Cheat Sheet minimum for scrypt (N=2^17, r=8, p=1):
 * https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 * The parameters are stored with each hash, so they can be raised without a migration.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 131_072;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
// scrypt needs 128 × N × r bytes; leave headroom.
const MAX_MEM = 256 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: MAX_MEM },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export const MIN_ADMIN_PASSWORD_LENGTH = 14;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new RangeError(
      `admin passwords must be at least ${MIN_ADMIN_PASSWORD_LENGTH.toString()} characters`,
    );
  }
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N.toString()}$${R.toString()}$${P.toString()}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash ?? "", "base64");
  const key = await derive(
    password,
    Buffer.from(salt ?? "", "base64"),
    Number.parseInt(n ?? "", 10),
    Number.parseInt(r ?? "", 10),
    Number.parseInt(p ?? "", 10),
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Needs rehash when stored parameters are weaker than current ones. */
export function needsRehash(stored: string): boolean {
  const [, n] = stored.split("$");
  return Number.parseInt(n ?? "0", 10) < N;
}
