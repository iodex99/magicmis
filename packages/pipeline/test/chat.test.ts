/**
 * Deep chat in the browser's DuckDB (SPEC §27): session tables, the guard re-run before execution,
 * result caps and redaction, and defence in depth — once locked, the database refuses file access
 * and refuses to be unlocked, even for SQL that never went through the guard.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTestDuck } from "../../ingest/test/duck";
import { loadChatTables, runChatQuery } from "../src/chat";

let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
beforeAll(async () => {
  duck = await openTestDuck();
  const balances = Array.from({ length: 80 }, (_, i) => [
    "2026-05",
    i % 2 === 0 ? "CA_RECEIVABLES" : "REV",
    i % 2 === 0 ? "Trade receivables" : "Revenue",
    `PARTY_${i.toString(16).padStart(12, "0")}`,
    "Sundry Debtors",
    0n,
    100n * BigInt(i),
    0n,
    100n * BigInt(i),
  ]);
  await loadChatTables(duck, {
    balances,
    bills: [["receivable", "2026-05", "PARTY_000000000001", "2026-04-01", 5000n, 44]],
  });
});
afterAll(() => {
  duck?.close();
});
const conn = () => {
  if (duck === undefined) throw new Error("duck not open");
  return duck;
};

const opts = (over: Partial<Parameters<typeof runChatQuery>[2]> = {}) => ({
  maxRows: 50,
  maxBytes: 16_384,
  timeoutMs: 10_000,
  redactText: (t: string) =>
    Promise.resolve(t.replace(/ABCDE1234F/gu, "PAN_0123456789ab")),
  ...over,
});

describe("chat session queries", () => {
  it("runs guarded aggregate queries over the session tables", async () => {
    const r = await runChatQuery(
      conn(),
      "SELECT head, sum(closing_paise) AS total FROM balances GROUP BY head ORDER BY head",
      opts(),
    );
    expect(r).toEqual({
      status: "ok",
      columns: ["head", "total"],
      rows: [
        ["CA_RECEIVABLES", "156000"],
        ["REV", "160000"],
      ],
      truncated: false,
    });
  });

  it("caps rows and bytes and marks truncation", async () => {
    const rows = await runChatQuery(conn(), "SELECT ledger FROM balances", opts());
    expect(rows.status === "ok" && rows.rows.length).toBe(50);
    expect(rows.status === "ok" && rows.truncated).toBe(true);
    const bytes = await runChatQuery(
      conn(),
      "SELECT ledger, group_path FROM balances",
      opts({ maxBytes: 600 }),
    );
    expect(
      bytes.status === "ok" && new TextEncoder().encode(JSON.stringify(bytes)).length,
    ).toBeLessThanOrEqual(600);
  });

  it("redacts every result cell", async () => {
    const r = await runChatQuery(conn(), "SELECT 'ABCDE1234F' AS id FROM bills", opts());
    expect(r).toMatchObject({ status: "ok", rows: [["PAN_0123456789ab"]] });
  });

  it("refuses unguarded SQL in the browser too", async () => {
    const r = await runChatQuery(conn(), "SELECT * FROM read_csv('x.csv')", opts());
    expect(r).toMatchObject({ status: "error" });
  });

  it("once locked, DuckDB itself refuses file access and unlocking", async () => {
    await expect(async () => conn().query("SELECT * FROM read_csv('secret.csv')")).rejects.toThrow();
    await expect(async () => conn().query("SET enable_external_access = true")).rejects.toThrow();
    await expect(async () => conn().query("COPY balances TO 'out.csv'")).rejects.toThrow();
  });
});
