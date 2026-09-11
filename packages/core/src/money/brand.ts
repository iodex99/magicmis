/**
 * Branded integer money types.
 *
 * SPEC §4: INR is integer paise, credits are integers, AI cost is integer micro-USD,
 * and JavaScript floating point is never used for money.
 *
 * The representation is `bigint`, not `number`, and that is the load-bearing choice:
 * a `bigint` cannot be mixed with a float without an explicit, visible conversion.
 * `1n * 1.5` is a TypeError, not a silently wrong answer. `number` would have been
 * large enough (paise stay well inside MAX_SAFE_INTEGER until ~₹90,000 crore), but it
 * would leave every float bug a plain typo away.
 *
 * The brands then stop the second class of bug: passing paise where micro-USD is
 * expected, or rupees where paise is. Those are the same shape at runtime and the
 * compiler is the only thing that can tell them apart.
 */

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Indian rupees in integer paise. ₹1 = 100 paise. */
export type Paise = Brand<bigint, "Paise">;

/** US dollars in integer micro-USD. $1 = 1,000,000 micro-USD. */
export type MicroUsd = Brand<bigint, "MicroUsd">;

/** Wallet credits. 1 credit = ₹1 excluding GST (SPEC §2.4). Always a whole number. */
export type Credits = Brand<bigint, "Credits">;

export const PAISE_PER_RUPEE = 100n;
export const MICRO_USD_PER_USD = 1_000_000n;

/** Construct paise from a bigint. Use the parsers for anything user- or DB-supplied. */
export const paise = (v: bigint): Paise => v as Paise;
export const microUsd = (v: bigint): MicroUsd => v as MicroUsd;
export const credits = (v: bigint): Credits => v as Credits;

export const ZERO_PAISE = paise(0n);
export const ZERO_MICRO_USD = microUsd(0n);
export const ZERO_CREDITS = credits(0n);
