/**
 * Deep chat in the browser (SPEC §27): session tables built from the loaded, tokenised files, in a
 * DuckDB instance used only for chat. After loading, the instance turns off external access and
 * locks its configuration (https://duckdb.org/docs/current/configuration/overview.html), so a query
 * that slipped past the guard still cannot read files, URLs or extensions, or re-enable them.
 *
 * Each query is re-validated with the same guard the server used, run with a timeout, and its
 * result is redacted, stringified and capped to the configured rows and bytes before it is posted.
 */

import { addMonths, financialYearOf } from "@magicmis/core/time";
import { guardSql, loadGuard, SESSION_TABLES } from "@magicmis/sql-guard";
import type { DuckConn } from "@magicmis/ingest";
import type { Mapping } from "@magicmis/semantic";

import type { Prepared } from "./prepare";

type Cell = string | number | bigint | null;

export interface ChatTables {
  readonly balances: readonly (readonly Cell[])[];
  readonly bills: readonly (readonly Cell[])[];
}

/**
 * A ledger's own figure for one month (ADR 0077), by the engine's rule (`compute.ts`): an income
 * or expense closing is the financial year to date, so the month is its closing less the month
 * before in the same year, and the year's first month is its closing; any other ledger's month is
 * its change. Null when the month before is not in the session — not loaded, or hidden by the
 * customer — rather than a year to date passed off as a month. Given to the model as a column so
 * it never does this arithmetic itself, which it did wrongly across a year boundary.
 */
function monthFigure(
  closing: bigint,
  previous: bigint | undefined,
  opening: bigint | null,
  pnl: boolean,
  firstOfYear: boolean,
): bigint | null {
  if (pnl) {
    if (firstOfYear) return closing;
    return previous === undefined ? null : closing - previous;
  }
  if (previous !== undefined) return closing - previous;
  return opening === null ? null : closing - opening;
}

/** Rows for the session tables, in `SESSION_TABLES` column order. Names are already tokens. */
export function chatTables(
  prepared: Prepared,
  mappings: readonly Mapping[],
  headName: (code: string) => string,
  year: {
    /** The company's financial-year start month, 1-12 (ADR 0035). */
    readonly fyStartMonth: number;
    /** Whether a head is on the profit and loss statement; false for UNMAPPED. */
    readonly isPnl: (head: string) => boolean;
  },
): ChatTables {
  const heads = new Map(mappings.map((m) => [m.ledgerKey, m.head]));
  const closings = new Map(
    prepared.facts.map((f) => [`${f.ledgerKey}\n${f.period}`, f.closing]),
  );
  const balances = prepared.facts.map((f): Cell[] => {
    const head = heads.get(f.ledgerKey) ?? "UNMAPPED";
    const period = f.period;
    return [
      f.period,
      head,
      headName(head),
      f.name,
      f.groupPath.join(" > "),
      f.opening,
      f.debit,
      f.credit,
      f.closing,
      monthFigure(
        f.closing,
        closings.get(`${f.ledgerKey}\n${addMonths(period, -1)}`),
        f.opening,
        year.isPnl(head),
        financialYearOf(period, year.fyStartMonth).start === period,
      ),
    ];
  });
  const bills = prepared.bills.flatMap((b) =>
    b.lines.map((l): Cell[] => [
      b.side,
      b.period,
      l.party,
      l.billDate,
      l.pending,
      l.overdueDays,
    ]),
  );
  return { balances, bills };
}

const csv = (v: Cell): string => {
  if (v === null) return "";
  const s = typeof v === "string" ? v : v.toString();
  return /[",\n\r]/u.test(s) ? `"${s.replace(/"/gu, '""')}"` : s;
};

/** Creates the session tables, then disables external access and locks the configuration. */
export async function loadChatTables(conn: DuckConn, tables: ChatTables): Promise<void> {
  for (const def of SESSION_TABLES) {
    const rows = def.name === "balances" ? tables.balances : tables.bills;
    const columns = def.columns.map((c) => `${c.name} ${c.type}`).join(", ");
    await conn.query(`CREATE OR REPLACE TABLE ${def.name} (${columns})`);
    if (rows.length === 0) continue;
    const file = `chat_${def.name}.csv`;
    await conn.registerFileText(file, rows.map((r) => r.map(csv).join(",")).join("\n"));
    try {
      const spec = def.columns.map((c) => `'${c.name}': '${c.type}'`).join(", ");
      await conn.query(
        `INSERT INTO ${def.name} SELECT * FROM read_csv('${file}', header = false, delim = ',', quote = '"', escape = '"', nullstr = '', columns = {${spec}})`,
      );
    } finally {
      await conn.dropFile(file);
    }
  }
  await conn.query("SET enable_external_access = false");
  await conn.query("SET lock_configuration = true");
}

export type ChatQueryOutcome =
  | {
      readonly status: "ok";
      readonly columns: string[];
      readonly rows: string[][];
      readonly truncated: boolean;
    }
  | { readonly status: "error"; readonly reason: string };

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean")
    return v.toString();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Arrow wrappers for HUGEINT and DECIMAL stringify to their value.
  const s = (v as { toString(): string }).toString();
  if (s !== "[object Object]") return s.replace(/^"+|"+$/gu, "");
  return JSON.stringify(v);
};

/**
 * Digit runs in the session's text cells. A numeric result equal to one could have been cast out
 * of a ledger name, so it is still redacted; any other number is a figure (ADR 0077).
 */
export function textDigitRuns(tables: ChatTables): Set<string> {
  const runs = new Set<string>();
  for (const rows of [tables.balances, tables.bills])
    for (const row of rows)
      for (const cell of row)
        if (typeof cell === "string")
          for (const m of cell.matchAll(/\d{6,}/gu)) runs.add(m[0]);
  return runs;
}

const NUMBER = /^-?\d+(\.\d+)?$/u;

/** Guards, runs, redacts and caps one Deep query. */
export async function runChatQuery(
  conn: DuckConn & { cancel?: () => Promise<void> },
  sql: string,
  options: {
    maxRows: number;
    maxBytes: number;
    timeoutMs: number;
    redactText: (text: string) => Promise<string>;
    /**
     * From `textDigitRuns`. When given, a numeric cell skips the identifier detectors unless its
     * digits are one of these: an amount of Rs 6-10 crore is ten digits in paise and read as a
     * mobile number, so a Deep answer showed a token where the figure belonged.
     */
    textDigits?: ReadonlySet<string>;
  },
): Promise<ChatQueryOutcome> {
  await loadGuard();
  const guard = guardSql(sql, { maxRows: options.maxRows });
  if (!guard.ok)
    return {
      status: "error",
      reason: `the query was refused before it ran: ${guard.reason}`,
    };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rows: Record<string, unknown>[];
  try {
    rows = await Promise.race([
      conn.query(guard.sql),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          void conn.cancel?.();
          reject(new Error("the query took too long"));
        }, options.timeoutMs);
      }),
    ]);
  } catch (error) {
    // The engine quotes the value that broke the query — "Could not convert string 'Rent —
    // Sharma, PAN ABCDE1234F' to INT64" — and this reason is replayed to the model in the next
    // round's tool result. It is data, so it is redacted exactly as a cell is (ADR 0057).
    return {
      status: "error",
      reason: await options.redactText(
        error instanceof Error ? error.message.slice(0, 300) : "the query failed",
      ),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const columns = rows[0] === undefined ? [] : Object.keys(rows[0]);
  let truncated = rows.length > options.maxRows;
  const out: string[][] = [];
  for (const r of rows.slice(0, options.maxRows)) {
    const cells: string[] = [];
    for (const c of columns) {
      const raw = r[c];
      const text = cellText(raw);
      const figure =
        options.textDigits !== undefined &&
        typeof raw !== "string" &&
        NUMBER.test(text) &&
        !options.textDigits.has(text.replace(/^-/u, "").split(".")[0] ?? "");
      cells.push((figure ? text : await options.redactText(text)).slice(0, 400));
    }
    out.push(cells);
  }
  // Rows are dropped from the end until the result fits the byte cap.
  const encoder = new TextEncoder();
  const size = () =>
    encoder.encode(JSON.stringify({ status: "ok", columns, rows: out, truncated: true }))
      .length;
  while (out.length > 0 && size() > options.maxBytes) {
    out.pop();
    truncated = true;
  }
  if (columns.length === 0)
    return { status: "ok", columns: ["result"], rows: [], truncated: false };
  return { status: "ok", columns, rows: out, truncated };
}
