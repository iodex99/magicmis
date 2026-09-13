/**
 * Fuzzy name similarity for the mapping cascade (SPEC §18 step 4): Sørensen–Dice coefficient over
 * character trigrams of the padded normalised name. Compared against the configured threshold in
 * exact integer arithmetic, so the decision never depends on float rounding.
 */

import { parseDecimal } from "@magicmis/core/money";

function trigrams(s: string): Map<string, number> {
  const padded = `  ${s} `;
  const out = new Map<string, number>();
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    const g = padded.slice(i, i + 3);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

export interface Similarity {
  /** 2 × shared trigrams. */
  readonly numerator: number;
  /** Total trigrams of both strings. */
  readonly denominator: number;
}

export function diceSimilarity(a: string, b: string): Similarity {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  let total = 0;
  for (const [g, n] of ta) {
    total += n;
    shared += Math.min(n, tb.get(g) ?? 0);
  }
  for (const n of tb.values()) total += n;
  return { numerator: 2 * shared, denominator: total };
}

/** similarity ≥ threshold, with threshold a decimal string such as "0.85". */
export function meetsThreshold(sim: Similarity, threshold: string): boolean {
  if (sim.denominator === 0) return false;
  const t = parseDecimal(threshold);
  return (
    BigInt(sim.numerator) * 10n ** BigInt(t.scale) >= t.unscaled * BigInt(sim.denominator)
  );
}

/** Compare two similarities exactly: positive when a > b. */
export function compareSimilarity(a: Similarity, b: Similarity): number {
  const l = a.numerator * b.denominator;
  const r = b.numerator * a.denominator;
  return l === r ? 0 : l > r ? 1 : -1;
}
