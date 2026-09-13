/** Data export against real Postgres (SPEC §10, §31). */

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { storeSnapshot } from "@magicmis/engine/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ExportUnavailable,
  listAccountExports,
  openAccountExport,
  processAccountExports,
  requestAccountExport,
} from "../src/exports";
import { deleteAccount, purgeAccounts } from "../src/lifecycle";
import { accountWithCompany, emptySnapshot, MemoryOutputStore, wrapper } from "./helpers";

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

const HOUR = 3_600_000;

describe("data export (SPEC §10, §31)", () => {
  it("builds a sealed export in the background, opens it for the owner until the link expires", async () => {
    const { accountId, companyId } = await accountWithCompany(pool(), 500n);
    await storeSnapshot(pool(), wrapper, {
      accountId,
      companyId,
      jobId: null,
      payload: emptySnapshot("2027-01"),
    });
    const now = new Date(Date.now() + HOUR);

    const first = await requestAccountExport(pool(), { accountId, now });
    const again = await requestAccountExport(pool(), { accountId, now });
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    await expect(
      openAccountExport(pool(), wrapper, new MemoryOutputStore(), {
        accountId,
        exportId: first.id,
        now,
      }),
    ).rejects.toMatchObject({ reason: "not_ready" });

    const store = new MemoryOutputStore();
    const tick = await processAccountExports(pool(), wrapper, store, now);
    expect(tick.built).toBeGreaterThanOrEqual(1);
    const [row] = await listAccountExports(pool(), accountId);
    expect(row?.status).toBe("ready");
    expect(row?.expiresAt?.getTime()).toBeGreaterThan(now.getTime());

    // Stored sealed: nothing readable at rest.
    const email =
      (
        await pool().query<{ email: string }>(
          `select email from accounts where id = $1`,
          [accountId],
        )
      ).rows[0]?.email ?? "";
    const [sealed] = [...store.files.values()];
    expect(sealed).toBeDefined();
    expect(sealed?.includes(Buffer.from(email))).toBe(false);

    const notice = await pool().query(
      `select type, payload from notifications where account_id = $1 and type = 'account.export_ready'`,
      [accountId],
    );
    expect(notice.rows).toHaveLength(1);

    const opened = JSON.parse(
      (
        await openAccountExport(pool(), wrapper, store, {
          accountId,
          exportId: first.id,
          now,
        })
      ).toString("utf8"),
    ) as {
      profile: { email: string };
      companies: { id: string; snapshots: { period: string }[] }[];
      wallet: { ledger: unknown[] };
      consents: unknown[];
    };
    expect(opened.profile.email).toBe(email);
    expect(opened.companies[0]?.id).toBe(companyId);
    expect(opened.companies[0]?.snapshots.map((s) => s.period)).toEqual(["2027-01"]);
    expect(opened.wallet.ledger.length).toBeGreaterThan(0);

    // Another account cannot open it.
    const other = await accountWithCompany(pool(), 0n);
    await expect(
      openAccountExport(pool(), wrapper, store, {
        accountId: other.accountId,
        exportId: first.id,
        now,
      }),
    ).rejects.toBeInstanceOf(ExportUnavailable);

    // Past the link window the file is removed and the link is dead.
    const later = new Date(now.getTime() + 100 * HOUR);
    const expired = await processAccountExports(pool(), wrapper, store, later);
    expect(expired.expired).toBeGreaterThanOrEqual(1);
    expect(store.files.size).toBe(0);
    await expect(
      openAccountExport(pool(), wrapper, store, {
        accountId,
        exportId: first.id,
        now: later,
      }),
    ).rejects.toMatchObject({ reason: "expired" });
  });

  it("removes stored exports when the account is purged", async () => {
    const { accountId } = await accountWithCompany(pool(), 0n);
    const now = new Date(Date.now() + HOUR);
    const store = new MemoryOutputStore();
    await requestAccountExport(pool(), { accountId, now });
    await processAccountExports(pool(), wrapper, store, now);
    const path = `exports/${accountId}/`;
    expect([...store.files.keys()].some((k) => k.startsWith(path))).toBe(true);

    const { purgeAfter } = await deleteAccount(pool(), { accountId, now });
    await purgeAccounts(pool(), store, new Date(purgeAfter.getTime() + 60_000), wrapper);
    expect([...store.files.keys()].some((k) => k.startsWith(path))).toBe(false);
    const [row] = await listAccountExports(pool(), accountId);
    expect(row?.status).toBe("expired");
  });
});
