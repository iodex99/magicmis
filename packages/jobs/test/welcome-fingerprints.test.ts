/**
 * The welcome fingerprint is kept a stated time after an account is deleted, then erased
 * (ADR 0072). The privacy notice names the period; this is what makes it true.
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { forgetWelcomeFingerprints } from "../src/lifecycle";

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

const NOW = new Date("2027-06-01T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

async function accountWithFingerprint(deletedAt: Date | null): Promise<string> {
  const r = await pool().query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code, deleted_at, status)
     values (gen_random_uuid(), $1, 'Fingerprint Co', '27', $2, $3) returning id`,
    [
      `${randomUUID()}@example.test`,
      deletedAt,
      deletedAt === null ? "active" : "deleted",
    ],
  );
  const id = r.rows[0]?.id ?? "";
  await pool().query(
    `insert into welcome_credits (account_id, outcome, reason, credits, mailbox_digest)
     values ($1, 'withheld', 'offer_off', 0, $2)`,
    [id, randomUUID().replaceAll("-", "")],
  );
  return id;
}

const digest = async (id: string) =>
  (
    await pool().query<{ d: string | null }>(
      `select mailbox_digest as d from welcome_credits where account_id = $1`,
      [id],
    )
  ).rows[0]?.d ?? null;

describe("forgetWelcomeFingerprints", () => {
  it("erases the fingerprint of an account deleted longer ago than the retention period, and only that", async () => {
    // Seeded at 365 days by migration 0067.
    const old = await accountWithFingerprint(daysAgo(366));
    const recent = await accountWithFingerprint(daysAgo(30));
    const active = await accountWithFingerprint(null);

    const result = await forgetWelcomeFingerprints(pool(), NOW);
    expect(result.erased).toBeGreaterThanOrEqual(1);
    expect(await digest(old)).toBeNull();
    expect(await digest(recent)).not.toBeNull();
    expect(await digest(active)).not.toBeNull();
    // The decision itself stays: it is what stops the account being decided again.
    const kept = await pool().query(
      `select 1 from welcome_credits where account_id = $1`,
      [old],
    );
    expect(kept.rowCount).toBe(1);

    // Running again changes nothing.
    expect((await forgetWelcomeFingerprints(pool(), NOW)).erased).toBe(0);
  });
});
