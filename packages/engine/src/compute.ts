/**
 * Compiler and runner (SPEC §20). Facts and mappings are loaded into typed DuckDB tables through
 * registered CSV text (never interpolated into SQL); the SQL itself is fixed text built from
 * constant identifiers, so no user or AI text can reach it. Every aggregate leaves DuckDB as a
 * decimal string and is parsed to bigint, so no value passes through a JavaScript number.
 *
 * Month movement:
 *  - P&L ledgers (by their Tally primary group): Tally's closing is FY-cumulative, so
 *    movement = closing − previous month's closing in the same FY; at the FY's first month the
 *    previous closing is 0; with no previous month the reported opening is used, else null.
 *  - Balance-sheet ledgers: closing − previous closing, else closing − reported opening.
 *  A head's movement is null when any contributing ledger's movement is unknown.
 */

import { addMonths, financialYearOf, type PeriodId } from "@magicmis/core/time";
import type { DuckConn } from "@magicmis/ingest/duckdb";
import { ancestry, CANONICAL_HEADS, type Mapping } from "@magicmis/semantic";
import { primaryOf } from "@magicmis/tally";

import type { LedgerFact } from "./facts";

export const ENGINE_VERSION = "engine-1.0.0";

export interface HeadPeriodValue {
  readonly closing: bigint;
  /** Debit-positive movement for the month; null when any ledger's movement is unknown. */
  readonly movement: bigint | null;
  readonly ledgers: number;
}

export interface DimensionFact {
  readonly period: PeriodId;
  readonly dimension: string;
  readonly value: string;
  readonly head: string;
  /** Normal-balance positive amount (e.g. taxable sales). */
  readonly amount: bigint;
}

export interface Coverage {
  readonly period: PeriodId;
  readonly sourceRows: number;
  readonly sourceClosing: bigint;
  readonly mappedRows: number;
  readonly mappedClosing: bigint;
  readonly unmappedRows: number;
  readonly unmappedClosing: bigint;
  readonly excludedRows: number;
}

export interface HeadCube {
  readonly periods: readonly PeriodId[];
  readonly fyStartMonth: number;
  get(head: string, period: PeriodId): HeadPeriodValue | null;
  readonly coverage: readonly Coverage[];
  readonly dimensions: readonly {
    period: PeriodId;
    dimension: string;
    value: string;
    head: string;
    amount: bigint;
  }[];
  /** Ledger-level rows, for lineage and continuity checks. */
  readonly ledgerRows: readonly {
    ledgerKey: string;
    period: PeriodId;
    head: string;
    closing: bigint;
    movement: bigint | null;
  }[];
}

const csv = (v: string | number | bigint | boolean | null): string => {
  if (v === null) return "";
  const s = typeof v === "string" ? v : v.toString();
  return /[",\n\r]/u.test(s) ? `"${s.replace(/"/gu, '""')}"` : s;
};

async function loadTable(
  conn: DuckConn,
  table: string,
  columns: readonly [string, string][],
  rows: readonly (readonly (string | number | bigint | boolean | null)[])[],
): Promise<void> {
  const file = `${table}.csv`;
  // An empty CSV cannot carry types; a single sentinel-free header-less file with zero rows is
  // represented by creating the table directly.
  const spec = columns.map(([n, t]) => `'${n}': '${t}'`).join(", ");
  if (rows.length === 0) {
    await conn.query(
      `CREATE OR REPLACE TABLE ${table} (${columns.map(([n, t]) => `${n} ${t}`).join(", ")})`,
    );
    return;
  }
  await conn.registerFileText(file, rows.map((r) => r.map(csv).join(",")).join("\n"));
  try {
    await conn.query(
      `CREATE OR REPLACE TABLE ${table} AS SELECT * FROM read_csv('${file}', header = false, delim = ',', quote = '"', escape = '"', nullstr = '', columns = {${spec}})`,
    );
  } finally {
    await conn.dropFile(file);
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : String(v));
const big = (v: unknown): bigint => BigInt(str(v));
const int = (v: unknown): number => Number.parseInt(str(v), 10);

export async function computeCube(
  conn: DuckConn,
  input: {
    facts: readonly LedgerFact[];
    mappings: readonly Mapping[];
    fyStartMonth: number;
    excludedLedgerKeys?: readonly string[];
    dimensions?: readonly DimensionFact[];
  },
): Promise<HeadCube> {
  const excluded = new Set(input.excludedLedgerKeys ?? []);

  await loadTable(
    conn,
    "e_ledger",
    [
      ["ledger_key", "VARCHAR"],
      ["period", "VARCHAR"],
      ["prev_period", "VARCHAR"],
      ["fy_start", "VARCHAR"],
      ["is_pl", "BOOLEAN"],
      ["opening", "BIGINT"],
      ["closing", "BIGINT"],
      ["excluded", "BOOLEAN"],
    ],
    input.facts.map((f) => {
      const primary = primaryOf(f.groupPath[0] ?? "");
      return [
        f.ledgerKey,
        f.period,
        addMonths(f.period, -1),
        financialYearOf(f.period, input.fyStartMonth).start,
        primary?.statement === "profit_and_loss",
        f.opening,
        f.closing,
        excluded.has(f.ledgerKey),
      ];
    }),
  );
  await loadTable(
    conn,
    "e_map",
    [
      ["ledger_key", "VARCHAR"],
      ["head_code", "VARCHAR"],
    ],
    // One head per ledger: the last mapping for a key wins.
    [...new Map(input.mappings.map((m) => [m.ledgerKey, m.head])).entries()],
  );
  await loadTable(
    conn,
    "e_heads",
    [
      ["code", "VARCHAR"],
      ["ancestor", "VARCHAR"],
    ],
    CANONICAL_HEADS.flatMap((h) => ancestry(h.code).map((a) => [h.code, a])),
  );
  await loadTable(
    conn,
    "e_dim",
    [
      ["period", "VARCHAR"],
      ["dimension", "VARCHAR"],
      ["value", "VARCHAR"],
      ["head", "VARCHAR"],
      ["amount", "BIGINT"],
    ],
    (input.dimensions ?? []).map((d) => [
      d.period,
      d.dimension,
      d.value,
      d.head,
      d.amount,
    ]),
  );

  // Every ledger × every loaded period. Exports omit zero-balance ledgers (closing-only layouts),
  // so a ledger absent from a loaded month is an implied zero closing, not missing data.
  await conn.query(`CREATE OR REPLACE VIEW e_grid AS
    WITH periods AS (SELECT DISTINCT period, prev_period, fy_start FROM e_ledger),
         keys AS (SELECT ledger_key, BOOL_OR(is_pl) AS is_pl, BOOL_OR(excluded) AS excluded
                  FROM e_ledger GROUP BY ledger_key)
    SELECT k.ledger_key, p.period, p.prev_period, p.fy_start, k.is_pl, k.excluded,
           f.opening, COALESCE(f.closing, 0) AS closing, f.ledger_key IS NULL AS implied
    FROM keys k CROSS JOIN periods p
    LEFT JOIN e_ledger f ON f.ledger_key = k.ledger_key AND f.period = p.period`);

  await conn.query(`CREATE OR REPLACE VIEW e_ledger_mapped AS
    SELECT g.ledger_key, g.period, g.closing, g.excluded, g.implied,
           COALESCE(m.head_code, 'UNMAPPED') AS head_code,
           g.closing - CASE
             WHEN g.is_pl AND g.period = g.fy_start THEN 0
             WHEN p.ledger_key IS NOT NULL AND (NOT g.is_pl OR p.fy_start = g.fy_start) THEN p.closing
             ELSE g.opening
           END AS movement
    FROM e_grid g
    LEFT JOIN e_map m ON m.ledger_key = g.ledger_key
    LEFT JOIN (SELECT DISTINCT ledger_key, period, fy_start, closing FROM e_grid) p
      ON p.ledger_key = g.ledger_key AND p.period = g.prev_period`);

  const heads = await conn.query(`SELECT a.ancestor AS head, l.period,
      CAST(SUM(l.closing) AS VARCHAR) AS closing,
      CAST(SUM(l.movement) AS VARCHAR) AS movement,
      COUNT(*) FILTER (WHERE NOT l.implied) AS ledgers,
      COUNT(*) AS grid_rows, COUNT(l.movement) AS movement_rows
    FROM e_ledger_mapped l JOIN e_heads a ON a.code = l.head_code
    WHERE NOT l.excluded
    GROUP BY a.ancestor, l.period`);

  const coverage = await conn.query(`SELECT period,
      COUNT(*) AS source_rows,
      CAST(COALESCE(SUM(closing) FILTER (WHERE NOT excluded), 0) AS VARCHAR) AS source_closing,
      COUNT(*) FILTER (WHERE excluded) AS excluded_rows
    FROM e_ledger GROUP BY period ORDER BY period`);
  const mapped = await conn.query(`SELECT period,
      COUNT(*) FILTER (WHERE head_code <> 'UNMAPPED') AS mapped_rows,
      CAST(COALESCE(SUM(closing) FILTER (WHERE head_code <> 'UNMAPPED'), 0) AS VARCHAR) AS mapped_closing,
      COUNT(*) FILTER (WHERE head_code = 'UNMAPPED') AS unmapped_rows,
      CAST(COALESCE(SUM(closing) FILTER (WHERE head_code = 'UNMAPPED'), 0) AS VARCHAR) AS unmapped_closing
    FROM e_ledger_mapped l
    WHERE NOT l.excluded AND NOT l.implied AND EXISTS (SELECT 1 FROM e_heads h WHERE h.code = l.head_code AND h.ancestor = l.head_code)
    GROUP BY period`);
  const ledgerRows = await conn.query(`SELECT ledger_key, period, head_code,
      CAST(closing AS VARCHAR) AS closing, CAST(movement AS VARCHAR) AS movement
    FROM e_ledger_mapped WHERE NOT excluded AND NOT implied ORDER BY ledger_key, period`);
  const dims =
    await conn.query(`SELECT period, dimension, value, head, CAST(SUM(amount) AS VARCHAR) AS amount
    FROM e_dim GROUP BY period, dimension, value, head`);

  const table = new Map<string, HeadPeriodValue>();
  for (const r of heads) {
    const ledgers = int(r["ledgers"]);
    const complete = int(r["movement_rows"]) === int(r["grid_rows"]);
    table.set(`${str(r["head"])}|${str(r["period"])}`, {
      closing: big(r["closing"]),
      movement: complete && r["movement"] !== null ? big(r["movement"]) : null,
      ledgers,
    });
  }
  const mappedBy = new Map(mapped.map((r) => [str(r["period"]), r]));
  const periods = [...new Set(input.facts.map((f) => f.period))].sort();

  return {
    periods,
    fyStartMonth: input.fyStartMonth,
    get: (head, period) => table.get(`${head}|${period}`) ?? null,
    coverage: coverage.map((r) => {
      const m = mappedBy.get(str(r["period"]));
      return {
        period: str(r["period"]) as PeriodId,
        sourceRows: int(r["source_rows"]) - int(r["excluded_rows"]),
        sourceClosing: big(r["source_closing"]),
        mappedRows: m === undefined ? 0 : int(m["mapped_rows"]),
        mappedClosing: m === undefined ? 0n : big(m["mapped_closing"]),
        unmappedRows: m === undefined ? 0 : int(m["unmapped_rows"]),
        unmappedClosing: m === undefined ? 0n : big(m["unmapped_closing"]),
        excludedRows: int(r["excluded_rows"]),
      };
    }),
    dimensions: dims.map((r) => ({
      period: str(r["period"]) as PeriodId,
      dimension: str(r["dimension"]),
      value: str(r["value"]),
      head: str(r["head"]),
      amount: big(r["amount"]),
    })),
    ledgerRows: ledgerRows.map((r) => ({
      ledgerKey: str(r["ledger_key"]),
      period: str(r["period"]) as PeriodId,
      head: str(r["head_code"]),
      closing: big(r["closing"]),
      movement: r["movement"] === null ? null : big(r["movement"]),
    })),
  };
}
