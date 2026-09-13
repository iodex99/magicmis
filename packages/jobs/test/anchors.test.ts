/** Tamper-evident anchors over the audit log and credit ledger (R-52). */

import { randomBytes, randomUUID } from "node:crypto";

import { LocalKeyWrapper } from "@magicmis/crypto";
import { appendAudit, verifyAuditChain } from "@magicmis/db/audit";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { withTransaction } from "@magicmis/db/tx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createIntegrityAnchors, verifyIntegrityAnchors } from "../src/anchors";
import { accountWithCompany, wrapper } from "./helpers";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("db not started");
  return db.pool;
};

// Anchors look back past a settle window; run them "later" so every test row is settled.
const later = (hours: number) => new Date(Date.now() + hours * 3_600_000);

const audit = (action: string) =>
  withTransaction(pool(), (tx) =>
    appendAudit(tx, { actorType: "system", actorId: null, action, metadata: {} }),
  );

/** An attacker with database owner rights: row triggers (append-only guards) are bypassed. */
async function asOwner(sql: string, params: unknown[] = []): Promise<void> {
  const client = await pool().connect();
  try {
    await client.query("set session_replication_role = replica");
    await client.query(sql, params);
  } finally {
    await client.query("set session_replication_role = origin");
    client.release();
  }
}

const reasons = async (at: Date) =>
  (await verifyIntegrityAnchors(pool(), wrapper, at)).failures.map(
    (f) => `${f.chain}:${f.reason}`,
  );

describe("integrity anchors (R-52)", () => {
  it("hold on an untouched history and catch rewrites the row chain cannot see", async () => {
    await accountWithCompany(pool(), 1_000n); // ledger rows
    for (const a of ["test.one", "test.two", "test.three"]) await audit(a);

    // No anchors yet and old rows: the check reports it.
    expect(await reasons(later(48))).toEqual(
      expect.arrayContaining(["audit_log:missing", "credit_ledger:missing"]),
    );

    const first = await createIntegrityAnchors(pool(), wrapper, later(1));
    expect(first.audit_log).not.toBeNull();
    expect(first.credit_ledger).not.toBeNull();
    expect(await reasons(later(1))).toEqual([]);
    // Nothing new: no second anchor.
    expect(
      (await createIntegrityAnchors(pool(), wrapper, later(1))).audit_log,
    ).toBeNull();

    // More history, a second anchor that links to the first.
    await audit("test.four");
    await createIntegrityAnchors(pool(), wrapper, later(2));
    const { anchorsChecked, failures } = await verifyIntegrityAnchors(
      pool(),
      wrapper,
      later(2),
    );
    expect(failures).toEqual([]);
    expect(anchorsChecked).toBeGreaterThanOrEqual(3);

    // 1. A timestamp rewrite: invisible to the row hash chain, caught by the anchor.
    const row = await pool().query<{ id: string }>(
      `select id from audit_log where action = 'test.two'`,
    );
    await asOwner(
      `update audit_log set created_at = created_at - interval '1 day' where id = $1`,
      [row.rows[0]?.id],
    );
    expect((await verifyAuditChain(pool())).failures).toEqual([]);
    expect(await reasons(later(2))).toContain("audit_log:digest_mismatch");
    await asOwner(
      `update audit_log set created_at = created_at + interval '1 day' where id = $1`,
      [row.rows[0]?.id],
    );
    expect(await reasons(later(2))).toEqual([]);

    // 2. A forged anchor (someone recomputes a digest without the key).
    const newest = await pool().query<{ id: string; mac: string }>(
      `select id, mac from integrity_anchors where chain = 'audit_log' order by through_seq desc limit 1`,
    );
    const mac = newest.rows[0]?.mac ?? "";
    await asOwner(`update integrity_anchors set mac = $2 where id = $1`, [
      newest.rows[0]?.id,
      "a".repeat(64),
    ]);
    expect(await reasons(later(2))).toContain("audit_log:bad_mac");
    await asOwner(`update integrity_anchors set mac = $2 where id = $1`, [
      newest.rows[0]?.id,
      mac,
    ]);

    // 3. Without the real master key the anchor key cannot even be opened.
    const other = LocalKeyWrapper.fromBase64(randomBytes(32).toString("base64"));
    await expect(verifyIntegrityAnchors(pool(), other, later(2))).rejects.toThrow();

    // 4. Trimming the newest rows past an anchor.
    const head = await pool().query<{ seq: string }>(
      `select max(seq)::text as seq from audit_log`,
    );
    await asOwner(`delete from audit_log where seq = $1`, [head.rows[0]?.seq]);
    expect(await reasons(later(2))).toEqual(
      expect.arrayContaining(["audit_log:chain_truncated", "audit_log:digest_mismatch"]),
    );
  });

  it("reports anchoring that stopped", async () => {
    await withTransaction(pool(), (tx) =>
      appendAudit(tx, {
        actorType: "system",
        actorId: null,
        action: `test.${randomUUID()}`,
        metadata: {},
      }),
    );
    await createIntegrityAnchors(pool(), wrapper, later(3));
    expect(await reasons(later(3 + 40))).toContain("audit_log:stale");
  });
});
