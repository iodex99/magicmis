/**
 * Explicit integer rounding.
 *
 * Every rounding in this product is a decision someone can be asked to justify, so
 * there is no default mode — callers name one. SPEC §20 requires totals to be computed
 * from unrounded values and rounded only at presentation, so these are used at the edge,
 * not in the middle of an aggregation.
 */

export type RoundingMode =
  /** Ties away from zero. The everyday commercial default. */
  | "half_up"
  /** Ties to the nearest even. Banker's rounding; avoids drift over many roundings. */
  | "half_even"
  /** Toward +∞. */
  | "ceil"
  /** Toward −∞. */
  | "floor"
  /** Toward zero. */
  | "trunc"
  /** Away from zero. */
  | "expand";

/**
 * Divide `numerator` by `denominator`, returning an integer under the named mode.
 *
 * Works entirely in bigint: the quotient and remainder are exact, and the mode only
 * decides what to do with a non-zero remainder. There is no float step to lose a paisa in.
 */
export function divideRounded(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint {
  if (denominator === 0n) {
    throw new RangeError("divideRounded: denominator is zero");
  }

  // Normalise sign onto the numerator so the remainder's sign is predictable.
  const negativeDenominator = denominator < 0n;
  const n = negativeDenominator ? -numerator : numerator;
  const d = negativeDenominator ? -denominator : denominator;

  const quotient = n / d; // bigint division truncates toward zero
  const remainder = n % d; // same sign as n, or zero

  if (remainder === 0n) return quotient;

  const negative = n < 0n;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;

  switch (mode) {
    case "trunc":
      return quotient;
    case "expand":
      return negative ? quotient - 1n : quotient + 1n;
    case "ceil":
      return negative ? quotient : quotient + 1n;
    case "floor":
      return negative ? quotient - 1n : quotient;
    case "half_up": {
      if (twiceRemainder < d) return quotient;
      return negative ? quotient - 1n : quotient + 1n;
    }
    case "half_even": {
      if (twiceRemainder < d) return quotient;
      if (twiceRemainder > d) return negative ? quotient - 1n : quotient + 1n;
      // Exactly half: move only if the quotient is odd.
      if (quotient % 2n === 0n) return quotient;
      return negative ? quotient - 1n : quotient + 1n;
    }
  }
}

/**
 * Round a whole number up to the next value ending in one of `endings`.
 *
 * SPEC §12 prices quotes with `round_up_to_49_or_99`. The endings live in config, so
 * this takes them rather than hardcoding 49 and 99 (SPEC §0.5).
 *
 * Returns `value` unchanged when it already ends in one of the endings.
 */
export function roundUpToEnding(value: bigint, endings: readonly number[]): bigint {
  if (endings.length === 0) {
    throw new RangeError("roundUpToEnding: endings is empty");
  }
  for (const e of endings) {
    if (!Number.isInteger(e) || e < 0) {
      throw new RangeError(
        `roundUpToEnding: ending ${String(e)} is not a non-negative integer`,
      );
    }
  }

  // Search forward from `value` for the first number ending in an allowed suffix.
  // Suffix length varies (9, 49, 99, 499...), so compare against each ending's modulus.
  let candidate = value;
  const limit = value + 1000n; // bounded: endings under 1000 always resolve inside this
  while (candidate < limit) {
    for (const e of endings) {
      const ending = BigInt(e);
      const modulus = 10n ** BigInt(String(e).length);
      if (candidate >= ending && candidate % modulus === ending) return candidate;
    }
    candidate += 1n;
  }
  throw new RangeError(
    `roundUpToEnding: no value ending in [${endings.join(", ")}] within 1000 of ${value.toString()}`,
  );
}
