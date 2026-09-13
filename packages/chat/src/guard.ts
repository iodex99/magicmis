/**
 * SQL guard (SPEC §27), shared by the server and the browser. Parsing uses libpg-query 17.7.4,
 * PostgreSQL's own parser compiled to WebAssembly; DuckDB's parser is a fork of the same code
 * (ADR 0023). The guard is an allowlist and fails closed:
 *
 * - exactly one statement, a SELECT (CTEs, joins, subqueries, aggregates, window functions);
 * - every AST node type, function, type name and relation must be on an allowlist; relations are
 *   the session tables or CTEs defined in the query, so table functions (`read_csv`), replacement
 *   scans (`FROM 'x.csv'`, `FROM x.csv`) and catalogs are all rejected;
 * - no SELECT INTO, no locking clauses, no comments, no string literal that looks like a URL;
 * - a LIMIT is enforced by wrapping the query, and the wrapped text is validated again.
 *
 * The browser's DuckDB for chat additionally runs with `enable_external_access = false` and
 * `lock_configuration = true` (https://duckdb.org/docs/current/configuration/overview.html).
 */

import { loadModule, parseSync } from "libpg-query";

export interface SessionTable {
  readonly name: string;
  readonly description: string;
  readonly columns: readonly {
    readonly name: string;
    readonly type: string;
    readonly description: string;
  }[];
}

/** Tables the browser creates from the loaded files for Deep questions. Names are tokens. */
export const SESSION_TABLES: readonly SessionTable[] = [
  {
    name: "balances",
    description:
      "Trial balance lines: one row per ledger per month, mapped to MIS heads.",
    columns: [
      { name: "period", type: "VARCHAR", description: "Month, YYYY-MM" },
      {
        name: "head",
        type: "VARCHAR",
        description: "MIS head code, e.g. REV, COGS, CA_RECEIVABLES",
      },
      { name: "head_name", type: "VARCHAR", description: "MIS head name" },
      {
        name: "ledger",
        type: "VARCHAR",
        description: "Ledger name; party ledgers are tokens like PARTY_…",
      },
      {
        name: "group_path",
        type: "VARCHAR",
        description: "Account group path, ' > ' separated",
      },
      {
        name: "opening_paise",
        type: "BIGINT",
        description: "Opening balance, debit positive, in paise",
      },
      {
        name: "debit_paise",
        type: "BIGINT",
        description: "Debits in the month, in paise",
      },
      {
        name: "credit_paise",
        type: "BIGINT",
        description: "Credits in the month, in paise",
      },
      {
        name: "closing_paise",
        type: "BIGINT",
        description: "Closing balance, debit positive, in paise",
      },
    ],
  },
  {
    name: "bills",
    description: "Pending bills from bills receivable and payable reports.",
    columns: [
      { name: "side", type: "VARCHAR", description: "receivable or payable" },
      { name: "period", type: "VARCHAR", description: "Month of the report, YYYY-MM" },
      { name: "party", type: "VARCHAR", description: "Party token" },
      { name: "bill_date", type: "DATE", description: "Bill date" },
      { name: "amount_paise", type: "BIGINT", description: "Pending amount in paise" },
      {
        name: "days_outstanding",
        type: "INTEGER",
        description: "Days from bill date to the report date",
      },
    ],
  },
];

const ALLOWED_NODES = new Set([
  "SelectStmt",
  "ResTarget",
  "ColumnRef",
  "String",
  "A_Star",
  "A_Const",
  "A_Expr",
  "BoolExpr",
  "NullTest",
  "BooleanTest",
  "FuncCall",
  "TypeCast",
  "TypeName",
  "SortBy",
  "WindowDef",
  "RangeVar",
  "RangeSubselect",
  "JoinExpr",
  "Alias",
  "WithClause",
  "CommonTableExpr",
  "CaseExpr",
  "CaseWhen",
  "CoalesceExpr",
  "MinMaxExpr",
  "NullIfExpr",
  "SubLink",
  "List",
  "Integer",
  "Float",
  "Boolean",
  "RowExpr",
  "SQLValueFunction",
]);

const ALLOWED_FUNCTIONS = new Set([
  // aggregates
  "sum",
  "count",
  "avg",
  "min",
  "max",
  "median",
  "stddev",
  "stddev_samp",
  "stddev_pop",
  "variance",
  "var_samp",
  "bool_and",
  "bool_or",
  "string_agg",
  "count_if",
  "quantile_cont",
  "quantile_disc",
  // windows
  "row_number",
  "rank",
  "dense_rank",
  "percent_rank",
  "cume_dist",
  "ntile",
  "lag",
  "lead",
  "first_value",
  "last_value",
  "nth_value",
  // scalar
  "abs",
  "round",
  "floor",
  "ceil",
  "ceiling",
  "sign",
  "coalesce",
  "nullif",
  "greatest",
  "least",
  "lower",
  "upper",
  "trim",
  "ltrim",
  "rtrim",
  "length",
  "substr",
  "substring",
  "concat",
  "replace",
  "left",
  "right",
  "starts_with",
  "ends_with",
  "contains",
  "split_part",
  "lpad",
  "rpad",
  "date_trunc",
  "date_part",
  "extract",
  "make_date",
  "year",
  "month",
  "day",
  "date_diff",
  "datediff",
  "strftime",
  "to_char",
  "mod",
]);

const ALLOWED_TYPES = new Set([
  "int2",
  "int4",
  "int8",
  "integer",
  "bigint",
  "smallint",
  "numeric",
  "decimal",
  "float4",
  "float8",
  "double",
  "real",
  "text",
  "varchar",
  "bpchar",
  "date",
  "bool",
  "boolean",
  "hugeint",
  "interval",
]);

export type GuardResult =
  | { readonly ok: true; readonly sql: string; readonly tables: readonly string[] }
  | { readonly ok: false; readonly reason: string };

let ready: Promise<void> | null = null;
/** Loads the parser (WebAssembly) once. Call before `guardSql`. */
export function loadGuard(): Promise<void> {
  ready ??= loadModule();
  return ready;
}

type Node = Record<string, unknown>;
const isObject = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && !Array.isArray(v);

class Rejection extends Error {}
const reject = (reason: string): never => {
  throw new Rejection(reason);
};

const sval = (v: unknown): string =>
  isObject(v) && isObject(v["String"]) && typeof v["String"]["sval"] === "string"
    ? v["String"]["sval"]
    : "";

function checkType(typeName: Node): void {
  const parts = (Array.isArray(typeName["names"]) ? typeName["names"] : [])
    .map(sval)
    .map((p) => p.toLowerCase());
  const name = parts.at(-1) ?? "";
  if (parts.length > 1 && parts[0] !== "pg_catalog")
    reject(`type ${parts.join(".")} is not allowed`);
  if (!ALLOWED_TYPES.has(name)) reject(`type ${name} is not allowed`);
  if (typeName["arrayBounds"] !== undefined) reject("array types are not allowed");
}

function collectCtes(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectCtes(n, out);
    return;
  }
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "CommonTableExpr" &&
      isObject(value) &&
      typeof value["ctename"] === "string"
    )
      out.add(value["ctename"].toLowerCase());
    collectCtes(value, out);
  }
}

function walk(
  node: unknown,
  ctx: { tables: Set<string>; ctes: Set<string>; used: Set<string> },
): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, ctx);
    return;
  }
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    // AST node wrappers are PascalCase keys; everything else is a field of the enclosing node.
    if (/^[A-Z]/u.test(key)) {
      if (!ALLOWED_NODES.has(key)) reject(`${key} is not allowed`);
      const n = isObject(value) ? value : {};
      switch (key) {
        case "SelectStmt":
          if (n["intoClause"] !== undefined) reject("SELECT INTO is not allowed");
          if (n["lockingClause"] !== undefined) reject("locking clauses are not allowed");
          break;
        case "RangeVar": {
          if (n["catalogname"] !== undefined) reject("catalog names are not allowed");
          const schema =
            typeof n["schemaname"] === "string" ? n["schemaname"].toLowerCase() : null;
          if (schema !== null && schema !== "main")
            reject(`schema ${schema} is not allowed`);
          const rel = typeof n["relname"] === "string" ? n["relname"].toLowerCase() : "";
          if (schema === null && ctx.ctes.has(rel)) break;
          if (!ctx.tables.has(rel)) reject(`table ${rel} is not a session table`);
          ctx.used.add(rel);
          break;
        }
        case "FuncCall": {
          const parts = (Array.isArray(n["funcname"]) ? n["funcname"] : [])
            .map(sval)
            .map((s) => s.toLowerCase());
          const name = parts.at(-1) ?? "";
          const schema = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
          if (schema !== null && schema !== "pg_catalog")
            reject(`function ${parts.join(".")} is not allowed`);
          if (!ALLOWED_FUNCTIONS.has(name)) reject(`function ${name} is not allowed`);
          break;
        }
        case "TypeName":
          checkType(n);
          break;
        case "TypeCast":
          // The target type is a plain field, not a wrapped node.
          checkType(isObject(n["typeName"]) ? n["typeName"] : {});
          break;
        case "A_Const": {
          const s = isObject(n["sval"]) ? n["sval"]["sval"] : undefined;
          if (
            typeof s === "string" &&
            /:\/\/|^[a-z]:\\|\.(csv|parquet|json|xlsx?|db|duckdb)$/iu.test(s)
          )
            reject("string literals that look like paths or URLs are not allowed");
          break;
        }
        default:
          break;
      }
    }
    walk(value, ctx);
  }
}

function parseOne(sql: string): Node {
  let parsed: unknown;
  try {
    parsed = parseSync(sql);
  } catch (error) {
    return reject(
      `the query does not parse: ${error instanceof Error ? error.message : "syntax error"}`,
    );
  }
  const stmts = isObject(parsed) && Array.isArray(parsed["stmts"]) ? parsed["stmts"] : [];
  if (stmts.length !== 1) reject("exactly one statement is allowed");
  const stmt: unknown = isObject(stmts[0]) ? stmts[0]["stmt"] : undefined;
  if (!isObject(stmt) || Object.keys(stmt).length !== 1 || !isObject(stmt["SelectStmt"]))
    reject("only SELECT statements are allowed");
  return stmt as Node;
}

/**
 * Validates a query and returns it wrapped with an enforced row limit. Must be called after
 * `loadGuard()` has resolved.
 */
export function guardSql(
  rawSql: string,
  options: { tables?: readonly string[]; maxRows: number; maxLength?: number },
): GuardResult {
  const tables = new Set(
    (options.tables ?? SESSION_TABLES.map((t) => t.name)).map((t) => t.toLowerCase()),
  );
  try {
    const sql = rawSql.trim().replace(/;\s*$/u, "");
    if (sql.length === 0) reject("the query is empty");
    if (sql.length > (options.maxLength ?? 4000)) reject("the query is too long");
    if (/--|\/\*/u.test(sql)) reject("comments are not allowed");
    if (sql.includes(";")) reject("exactly one statement is allowed");
    for (let i = 0; i < sql.length; i += 1) {
      const c = sql.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) reject("control characters are not allowed");
    }

    const stmt = parseOne(sql);
    const ctes = new Set<string>();
    collectCtes(stmt, ctes);
    for (const t of tables) ctes.delete(t);
    const used = new Set<string>();
    walk(stmt, { tables, ctes, used });

    const limit = options.maxRows + 1;
    const wrapped = `SELECT * FROM (${sql}) AS guarded_query LIMIT ${limit.toString()}`;
    // The wrapped text is what runs, so it is validated as well.
    const outer = parseOne(wrapped);
    const select = outer["SelectStmt"] as Node;
    const from = Array.isArray(select["fromClause"]) ? select["fromClause"] : [];
    const limitCount = isObject(select["limitCount"])
      ? select["limitCount"]["A_Const"]
      : undefined;
    const limitValue =
      isObject(limitCount) && isObject(limitCount["ival"])
        ? limitCount["ival"]["ival"]
        : undefined;
    const sub = isObject(from[0]) ? from[0]["RangeSubselect"] : undefined;
    const alias =
      isObject(sub) && isObject(sub["alias"]) ? sub["alias"]["aliasname"] : undefined;
    if (
      from.length !== 1 ||
      alias !== "guarded_query" ||
      limitValue !== limit ||
      select["whereClause"] !== undefined
    )
      reject("the query could not be limited safely");
    walk(outer, { tables, ctes, used: new Set() });
    return { ok: true, sql: wrapped, tables: [...used].sort() };
  } catch (error) {
    if (error instanceof Rejection) return { ok: false, reason: error.message };
    throw error;
  }
}
