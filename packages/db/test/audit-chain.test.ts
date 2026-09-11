/**
 * Audit chain (SPEC §34 Phase 0 acceptance: "audit chain verification passes").
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appendAuditInTransaction, verifyAuditChain } from "../src/audit.js";
import { startTestDb, type TestDb } from "./harness.js";

// Undefined until beforeAll completes -- and it stays undefined if beforeAll throws,
// which is exactly when afterAll still runs. The optional chain below is not defensive
// noise; the type has to admit that.
let db: TestDb | undefined;

beforeAll(async () => {
  db = await startTestDb();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

/** The started database. Throws a clear error instead of a TypeError if setup failed. */
function testDb(): TestDb {
  if (db === undefined) throw new Error("test database was not started");
  return db;
}

describe("audit chain", () => {
  it("verifies an empty chain", async () => {
    const result = await verifyAuditChain(testDb().pool);
    expect(result).toMatchObject({ ok: true, checked: 0 });
  });

  it("appends and verifies a chain", async () => {
    for (let i = 0; i < 25; i++) {
      await appendAuditInTransaction(testDb().pool, {
        actorType: "system",
        action: "test.event",
        targetType: "job",
        metadata: { sequence: i },
      });
    }

    const result = await verifyAuditChain(testDb().pool);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(25);
  });

  it("links each entry to its predecessor", async () => {
    const rows = await testDb().pool.query<{ prev_hash: string; hash: string }>(
      `select prev_hash, hash from public.audit_log order by seq`,
    );
    for (let i = 1; i < rows.rows.length; i++) {
      expect(rows.rows[i]?.prev_hash).toBe(rows.rows[i - 1]?.hash);
    }
  });

  it("pages correctly — a small page size gives the same verdict", async () => {
    const paged = await verifyAuditChain(testDb().pool, 4);
    const single = await verifyAuditChain(testDb().pool, 10_000);
    expect(paged.checked).toBe(single.checked);
    expect(paged.ok).toBe(single.ok);
  });

  it("serialises concurrent appends without breaking the chain", async () => {
    // The failure this guards against is not tampering -- it is two writers reading the
    // same tail hash under ordinary traffic and producing a permanently broken chain.
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        appendAuditInTransaction(testDb().pool, {
          actorType: "account",
          action: "concurrent.write",
          metadata: { worker: i },
        }),
      ),
    );

    const result = await verifyAuditChain(testDb().pool);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(55);
  });

  it("detects a tampered payload", async () => {
    // The trigger blocks UPDATE, so tamper the way a real attacker with database access
    // would have to: disable it first. If the chain could not detect this, it would be
    // decoration.
    await testDb().pool.query(`alter table public.audit_log disable trigger audit_log_append_only`);
    try {
      await testDb().pool.query(
        `update public.audit_log set action = 'tampered'
         where seq = (select seq from public.audit_log order by seq offset 5 limit 1)`,
      );

      const result = await verifyAuditChain(testDb().pool);
      expect(result.ok).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.reason).toBe("bad_hash");
    } finally {
      await testDb().pool.query(`alter table public.audit_log enable trigger audit_log_append_only`);
    }
  });

  it("refuses UPDATE and DELETE through the trigger", async () => {
    await expect(
      testDb().pool.query(`update public.audit_log set action = 'x'`),
    ).rejects.toThrow(/append-only/iu);
    await expect(testDb().pool.query(`delete from public.audit_log`)).rejects.toThrow(/append-only/iu);
  });

  it("records metadata as given, so verification is reproducible", async () => {
    const appended = await appendAuditInTransaction(testDb().pool, {
      actorType: "admin",
      action: "config.changed",
      targetType: "price_book",
      metadata: { key: "max_ai_cost_ratio", from: "0.20", to: "0.25" },
    });

    const row = await testDb().pool.query<{ metadata: Record<string, unknown>; hash: string }>(
      `select metadata, hash from public.audit_log where id = $1`,
      [appended.id],
    );
    expect(row.rows[0]?.metadata).toEqual({
      key: "max_ai_cost_ratio",
      from: "0.20",
      to: "0.25",
    });
    expect(row.rows[0]?.hash).toBe(appended.hash);
  });
});
