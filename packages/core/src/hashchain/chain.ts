/**
 * Append-only hash chain.
 *
 * SPEC §4 requires `prev_hash`/`hash` on the audit log and the credit ledger, and SPEC §9
 * puts it on blueprints too. SPEC §30 runs a nightly verification job that alerts on
 * mismatch.
 *
 * The chain's value is entirely in the canonicalisation: if two callers serialise the
 * same entry differently -- a reordered key, a number rendered as `1` vs `1.0` -- the
 * chain breaks for a reason that has nothing to do with tampering, and the alert gets
 * ignored. So serialisation here is total and explicit, and rejects anything it cannot
 * represent unambiguously.
 */

import { createHash } from "node:crypto";

/** A value that can appear in a chained entry. Deliberately narrow. */
export type ChainValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | readonly ChainValue[]
  | { readonly [key: string]: ChainValue };

export interface ChainedEntry {
  readonly prevHash: string;
  readonly hash: string;
}

/** The hash a chain starts from. 64 zeros: same shape as a real hash, obviously not one. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * Canonical JSON: object keys sorted, no insignificant whitespace, bigint as a decimal
 * string, and every value form pinned.
 *
 * Rejects `undefined`, non-integer numbers and non-finite numbers. A float in a chained
 * entry would hash differently across platforms that render it differently, and money is
 * never a float here anyway -- it arrives as a bigint or a decimal string.
 */
export function canonicalise(value: ChainValue): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return `"${value.toString()}"`;
    case "number": {
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalise: ${String(value)} is not finite`);
      }
      if (!Number.isInteger(value)) {
        throw new TypeError(
          `canonicalise: ${String(value)} is not an integer; use a bigint or a decimal string`,
        );
      }
      return value.toString();
    }
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => canonicalise(v as ChainValue)).join(",")}]`;
      }
      const record = value as { readonly [key: string]: ChainValue };
      const keys = Object.keys(record).sort();
      const parts = keys.map((k) => {
        const v = record[k];
        if (v === undefined) {
          throw new TypeError(`canonicalise: key ${JSON.stringify(k)} is undefined`);
        }
        return `${JSON.stringify(k)}:${canonicalise(v)}`;
      });
      return `{${parts.join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalise: unsupported type ${typeof value}`);
  }
}

/** SHA-256 of the canonical form of `prevHash` linked to `payload`. */
export function computeHash(prevHash: string, payload: ChainValue): string {
  const canonical = canonicalise({ prev: prevHash, payload });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Link a payload onto a chain, returning both hashes to persist. */
export function linkEntry(prevHash: string, payload: ChainValue): ChainedEntry {
  return { prevHash, hash: computeHash(prevHash, payload) };
}

export interface VerificationFailure {
  /** Zero-based position in the supplied sequence. */
  readonly index: number;
  readonly reason: "broken_link" | "bad_hash";
  readonly expected: string;
  readonly actual: string;
}

/**
 * Verify a contiguous run of entries.
 *
 * Returns every failure rather than the first, so an operator sees whether one row was
 * edited or the chain was rebuilt from some point onward -- those call for different
 * responses.
 */
export function verifyChain(
  entries: readonly { prevHash: string; hash: string; payload: ChainValue }[],
  startHash: string = GENESIS_HASH,
): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  let expectedPrev = startHash;

  for (const [index, entry] of entries.entries()) {
    if (entry.prevHash !== expectedPrev) {
      failures.push({
        index,
        reason: "broken_link",
        expected: expectedPrev,
        actual: entry.prevHash,
      });
    }
    const recomputed = computeHash(entry.prevHash, entry.payload);
    if (recomputed !== entry.hash) {
      failures.push({ index, reason: "bad_hash", expected: recomputed, actual: entry.hash });
    }
    // Continue from the stored hash, so one bad row does not cascade into
    // every subsequent row reporting a broken link.
    expectedPrev = entry.hash;
  }

  return failures;
}
