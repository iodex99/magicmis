/** Master-key replacement against real Postgres (ADR 0008, SPEC §10). */

import { randomBytes } from "node:crypto";

import { LocalKeyWrapper, RotatingKeyWrapper } from "@magicmis/crypto";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import {
  latestSnapshot,
  loadAccountRules,
  saveAccountRules,
  storeSnapshot,
} from "@magicmis/engine/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordLibraryVotes } from "../src/library";
import { rewrapDataKeys } from "../src/rewrap";
import { accountWithCompany, emptySnapshot } from "./helpers";

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

describe("re-wrap onto a new master key", () => {
  it("moves company, account and platform keys; data opens under the new key only; reruns are no-ops", async () => {
    const oldKey = new LocalKeyWrapper(randomBytes(32), "master-old");
    const newKey = new LocalKeyWrapper(randomBytes(32), "master-new");
    const { accountId, companyId } = await accountWithCompany(pool(), 0n);
    await storeSnapshot(pool(), oldKey, {
      accountId,
      companyId,
      jobId: null,
      payload: emptySnapshot("2027-01"),
    });
    await saveAccountRules(pool(), oldKey, {
      accountId,
      companyId,
      rules: [{ pattern: "courier charges", head: "OPEX_OTHER" }],
    });
    await recordLibraryVotes(pool(), oldKey, {
      accountId,
      rules: [{ pattern: "courier charges", head: "OPEX_OTHER" }],
    });

    // During the move the app runs with both keys.
    const rotating = new RotatingKeyWrapper(newKey, oldKey);
    expect(
      await latestSnapshot(pool(), rotating, { accountId, companyId, period: "2027-01" }),
    ).not.toBeNull();

    const moved = await rewrapDataKeys(pool(), oldKey, newKey, "master-new", 1);
    expect(moved["company_keys"]).toBeGreaterThanOrEqual(1);
    expect(moved["account_keys"]).toBeGreaterThanOrEqual(1);
    expect(moved["platform_keys"]).toBe(1);

    const versions = await pool().query<{ n: number }>(
      `select ((select count(*) from company_keys where wrapped_dek is not null and kms_key_version <> 'master-new')
            + (select count(*) from account_keys where wrapped_dek is not null and kms_key_version <> 'master-new')
            + (select count(*) from platform_keys where kms_key_version <> 'master-new'))::int as n`,
    );
    expect(versions.rows[0]?.n).toBe(0);

    expect(
      await latestSnapshot(pool(), newKey, { accountId, companyId, period: "2027-01" }),
    ).not.toBeNull();
    expect(await loadAccountRules(pool(), newKey, accountId)).toHaveLength(1);
    await expect(
      latestSnapshot(pool(), oldKey, { accountId, companyId, period: "2027-01" }),
    ).rejects.toThrow();

    expect(await rewrapDataKeys(pool(), oldKey, newKey, "master-new")).toEqual({
      company_keys: 0,
      account_keys: 0,
      platform_keys: 0,
      admin_users: 0,
    });
  });
});
