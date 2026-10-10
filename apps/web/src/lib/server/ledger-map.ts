import "server-only";

import type { KeyWrapper } from "@magicmis/crypto";
import {
  BlueprintConflict,
  latestBlueprint,
  latestSnapshot,
  newestSnapshotPeriod,
  storeBlueprint,
} from "@magicmis/engine/server";
import {
  CANONICAL_HEADS,
  MAPPABLE_HEADS,
  mappingRulesSchema,
  type MappingRules,
} from "@magicmis/semantic";
import type { Pool } from "pg";

/**
 * A company's ledger map: every ledger its books have shown, and the MIS line each one feeds
 * (ADR 0086).
 *
 * The mapping is the company's own — learnt on its first run, kept in its blueprint, and applied
 * before anything else on every run after (the cascade's first step). Until now nobody could see
 * it whole: lineage shows the ledgers behind one figure at a time, and a ledger left Unmapped was
 * visible only as a figure that seemed short. An accountant reviewing a client's MIS wants the
 * list, and wants to move a ledger once and have it stay moved.
 *
 * A change is a new blueprint version, written the way every other change to the company's memory
 * is (`basedOn`, refused if another version landed first), and it reaches the figures the next time
 * the MIS is built. Nothing here calls the model or charges anything: the mapping was produced
 * inside a paid run, and correcting it is the customer's own judgement.
 */

export const UNMAPPED = "UNMAPPED";

export interface LedgerRow {
  /** The cascade's key: the normalised group path and name. */
  readonly key: string;
  /** The groups above the ledger, as the books name them, nearest last. */
  readonly group: string;
  readonly name: string;
  /** Whether the name is a privacy token: a customer or supplier the AI never saw by name. */
  readonly tokenised: boolean;
  readonly head: string;
  readonly headName: string;
  /**
   * Unmapped because its owner chose to keep it off (ADR 0091), not because a run could not place
   * it. Only ever true with `head` Unmapped.
   */
  readonly keptOff: boolean;
  /** Closing balance in the latest month, in minor units, where the snapshot holds it. */
  readonly closing: string | null;
}

export interface LedgerMap {
  readonly version: number;
  readonly period: string | null;
  readonly rows: readonly LedgerRow[];
  /**
   * A run for the company is in progress, so a change would be refused (ADR 0091). Said before
   * anyone picks a line, rather than after.
   */
  readonly live: boolean;
}

const HEAD_BY_CODE = new Map(CANONICAL_HEADS.map((h) => [h.code, h]));
const TOKEN = /^(party|emp|employee|person)\s+[0-9a-f]{6,}$/u;

/** "sundry debtors > party 9f3a1c2e4b5d" → group "Sundry debtors", name "Party 9f3a1c2e4b5d". */
function describe(key: string): { group: string; name: string; tokenised: boolean } {
  const parts = key.split(" > ");
  const last = parts.at(-1) ?? key;
  const sentence = (s: string) =>
    s === "" ? s : `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}`;
  return {
    group: parts.slice(0, -1).map(sentence).join(" › "),
    name: sentence(last),
    tokenised: TOKEN.test(last),
  };
}

/** Every head a ledger may be put on, in the order the MIS reads them, for the picker. */
export function headChoices(): { code: string; name: string; statement: string }[] {
  return [...MAPPABLE_HEADS]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((h) => ({ code: h.code, name: h.name, statement: h.statement }));
}

export async function ledgerMap(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: { accountId: string; companyId: string },
): Promise<LedgerMap | null> {
  const blueprint = await latestBlueprint(pool, wrapper, scope);
  if (blueprint === null) return null;
  const rules = mappingRulesSchema.parse(blueprint.parts.mappingRules);
  // The balances of the run made last, which carries every month (ADR 0091), at the latest month
  // they cover.
  const newest = await newestSnapshotPeriod(pool, scope);
  const snapshot =
    newest === null
      ? null
      : await latestSnapshot(pool, wrapper, { ...scope, period: newest });
  const period =
    snapshot?.ledgerBalances.reduce<string | null>(
      (max, b) => (max === null || b.period > max ? b.period : max),
      null,
    ) ?? null;
  const closing = new Map(
    (snapshot?.ledgerBalances ?? [])
      .filter((b) => b.period === period)
      .map((b) => [b.ledgerKey, b.closing]),
  );

  const heads = new Map<string, string>();
  for (const key of rules.acceptedUnmapped) heads.set(key, UNMAPPED);
  // A rule wins over an accepted Unmapped for the same key, as it does in the cascade.
  for (const r of rules.rules) heads.set(r.ledgerKey, r.head);
  const keptOff = new Set(rules.keptOff ?? []);

  const rows = [...heads.entries()].map(([key, head]) => ({
    key,
    ...describe(key),
    head,
    headName: HEAD_BY_CODE.get(head)?.name ?? head,
    keptOff: head === UNMAPPED && keptOff.has(key),
    closing: closing.get(key) ?? null,
  }));
  // Not placed yet first, because those are the ledgers missing from the figures nobody has
  // looked at; then the ones kept off on purpose; then every other by the line it feeds.
  const order = (row: { head: string; keptOff: boolean }) =>
    row.head === UNMAPPED
      ? row.keptOff
        ? -1
        : -2
      : (HEAD_BY_CODE.get(row.head)?.sortOrder ?? 0);
  rows.sort(
    (a, b) =>
      order(a) - order(b) ||
      a.group.localeCompare(b.group) ||
      a.name.localeCompare(b.name),
  );
  return {
    version: blueprint.version,
    period,
    rows,
    live: await runIsLive(pool, scope),
  };
}

export class LedgerMapError extends Error {
  constructor(
    readonly code: "not_set_up" | "unknown_ledger" | "unknown_head" | "busy" | "stale",
    message: string,
  ) {
    super(message);
    this.name = "LedgerMapError";
  }
}

/** The run types whose end writes the company's mapping rules back. */
const RUN_TYPES = [
  "company_setup",
  "monthly_refresh",
  "refresh_with_restructure",
  "reference_mis_recreate",
];
const IN_FLIGHT = [
  "quote_accepted",
  "reserved",
  "preflight",
  "profiling",
  "classifying",
  "mapping",
  "awaiting_review",
  "computing",
  "validating",
  "rendering",
];

/**
 * Whether a run for the company is live: one that writes its mapping back when it ends, with a
 * heartbeat in the last ten minutes, so a run that died does not lock the map for ever.
 */
export async function runIsLive(
  pool: Pool,
  scope: { accountId: string; companyId: string },
): Promise<boolean> {
  const live = await pool.query(
    `select 1 from jobs
      where account_id = $1 and company_id = $2 and type = any($3) and state = any($4)
        and heartbeat_at > now() - interval '10 minutes'
      limit 1`,
    [scope.accountId, scope.companyId, RUN_TYPES, IN_FLIGHT],
  );
  return live.rowCount !== 0;
}

/**
 * Put one ledger on a head, or keep it off the MIS for good. Returns the new blueprint version.
 *
 * Refused while a run for the company is live (`runIsLive`): a run writes its own mapping back
 * when it ends, which would put the old head back without a word.
 */
export async function setLedgerHead(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    ledgerKey: string;
    head: string;
    basedOn: number;
  },
): Promise<number> {
  if (input.head !== UNMAPPED && !MAPPABLE_HEADS.some((h) => h.code === input.head))
    throw new LedgerMapError("unknown_head", "Choose a line from the list.");
  if (await runIsLive(pool, input))
    throw new LedgerMapError(
      "busy",
      "A run for this company is in progress. Change the map once it has finished.",
    );

  const scope = { accountId: input.accountId, companyId: input.companyId };
  const blueprint = await latestBlueprint(pool, wrapper, scope);
  if (blueprint === null)
    throw new LedgerMapError(
      "not_set_up",
      "Set up this company before changing its map.",
    );
  if (blueprint.version !== input.basedOn)
    throw new LedgerMapError(
      "stale",
      "The map changed a moment ago. Reload and try again.",
    );
  const rules = mappingRulesSchema.parse(blueprint.parts.mappingRules);
  const known =
    rules.rules.some((r) => r.ledgerKey === input.ledgerKey) ||
    rules.acceptedUnmapped.includes(input.ledgerKey);
  if (!known)
    throw new LedgerMapError(
      "unknown_ledger",
      "That ledger is not in this company's books.",
    );

  const next: MappingRules = {
    ...rules,
    rules: [
      ...rules.rules.filter((r) => r.ledgerKey !== input.ledgerKey),
      ...(input.head === UNMAPPED
        ? []
        : [{ ledgerKey: input.ledgerKey, head: input.head }]),
    ],
    acceptedUnmapped: [
      ...rules.acceptedUnmapped.filter((k) => k !== input.ledgerKey),
      ...(input.head === UNMAPPED ? [input.ledgerKey] : []),
    ],
    // Choosing to keep it off is the owner's own decision, and is remembered as one (ADR 0091).
    keptOff: [
      ...(rules.keptOff ?? []).filter((k) => k !== input.ledgerKey),
      ...(input.head === UNMAPPED ? [input.ledgerKey] : []),
    ],
  };
  try {
    const stored = await storeBlueprint(pool, wrapper, {
      ...scope,
      jobId: null,
      parts: { ...blueprint.parts, mappingRules: next },
      basedOn: blueprint.version,
    });
    return stored.version;
  } catch (error) {
    if (error instanceof BlueprintConflict)
      throw new LedgerMapError(
        "stale",
        "The map changed a moment ago. Reload and try again.",
      );
    throw error;
  }
}

/**
 * How many ledgers the map holds, how many are off the MIS because no run could place them, and
 * how many their owner kept off on purpose: the blueprint alone, no balances.
 */
export async function ledgerSummary(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: { accountId: string; companyId: string },
): Promise<{ ledgers: number; unplaced: number; keptOff: number } | null> {
  const blueprint = await latestBlueprint(pool, wrapper, scope);
  if (blueprint === null) return null;
  const rules = mappingRulesSchema.parse(blueprint.parts.mappingRules);
  const mapped = new Set(rules.rules.map((r) => r.ledgerKey));
  const off = rules.acceptedUnmapped.filter((k) => !mapped.has(k));
  const kept = new Set(rules.keptOff ?? []);
  const keptOff = off.filter((k) => kept.has(k)).length;
  return { ledgers: mapped.size + off.length, unplaced: off.length - keptOff, keptOff };
}
