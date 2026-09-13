/** Company lifecycle and memory fee against real Postgres (SPEC §28). */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import {
  latestSnapshot,
  loadAccountRules,
  saveAccountRules,
  storeSnapshot,
} from "@magicmis/engine/server";
import { grantCredits, priceFor } from "@magicmis/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createJob } from "../src/jobs";
import {
  debitMemoryFees,
  deleteAccount,
  purgeAccounts,
  deleteCompany,
  purgeCompanies,
  queueLifecycleNotices,
  queueRefreshReminders,
  restoreCompany,
} from "../src/lifecycle";
import {
  accountWithCompany,
  emptySnapshot,
  MemoryOutputStore,
  SMALL,
  wallet,
  wrapper,
} from "./helpers";

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

const fee = async () =>
  (
    await priceFor(pool(), {
      actionKey: "company_memory_monthly",
      tier: "professional",
      delivery: "standard",
    })
  ).credits;
const restorePrice = async () =>
  (
    await priceFor(pool(), {
      actionKey: "company_restore",
      tier: "professional",
      delivery: "standard",
    })
  ).credits;

/** A set-up company anchored on 15 Jan 2027 (IST). */
async function setUpCompany(credits: bigint) {
  const c = await accountWithCompany(pool(), credits);
  await pool().query(
    `update companies set first_setup_at = '2027-01-15T05:00:00Z', memory_fee_anchor_date = '2027-01-15' where id = $1`,
    [c.companyId],
  );
  return c;
}

const company = async (id: string) =>
  (
    await pool().query<{
      lifecycle_state: string;
      unpaid_months: number;
      purge_after: Date | null;
    }>(
      `select lifecycle_state, unpaid_months, purge_after from companies where id = $1`,
      [id],
    )
  ).rows[0];

const notices = async (accountId: string) =>
  (
    await pool().query<{ type: string }>(
      `select type from notifications where account_id = $1 order by created_at, type`,
      [accountId],
    )
  ).rows.map((r) => r.type);

describe("memory fee", () => {
  it("is debited once per company-month on the anchor anniversary, never before", async () => {
    const { accountId, companyId } = await setUpCompany(1_000n);
    await debitMemoryFees(pool(), new Date("2027-02-14T12:00:00Z"));
    expect(await wallet(pool(), accountId)).toEqual({ balance: 1_000n, held: 0n });
    await debitMemoryFees(pool(), new Date("2027-02-15T01:00:00Z"));
    await debitMemoryFees(pool(), new Date("2027-02-20T01:00:00Z"));
    const f = await fee();
    expect(await wallet(pool(), accountId)).toEqual({ balance: 1_000n - f, held: 0n });
    const charges = await pool().query(
      `select fee_month, status from company_fee_charges where company_id = $1`,
      [companyId],
    );
    expect(charges.rows).toEqual([{ fee_month: "2027-02", status: "captured" }]);
    expect(await notices(accountId)).toContain("billing.memory_fee_debited");
  });

  it("enters grace when it cannot pay, blocks jobs, pays arrears when credits arrive, and archives after the grace months", async () => {
    const { accountId, companyId } = await setUpCompany(0n);
    await debitMemoryFees(pool(), new Date("2027-02-15T06:00:00Z"));
    expect(await company(companyId)).toMatchObject({
      lifecycle_state: "grace",
      unpaid_months: 1,
    });
    expect(await notices(accountId)).toEqual(
      expect.arrayContaining(["billing.memory_fee_failed", "lifecycle.grace"]),
    );
    await expect(
      createJob(pool(), {
        accountId,
        companyId,
        type: "monthly_refresh",
        tier: "professional",
        delivery: "standard",
        idempotencyKey: randomUUID(),
        size: SMALL,
      }),
    ).rejects.toMatchObject({ code: "company_not_active" });

    await debitMemoryFees(pool(), new Date("2027-03-15T06:00:00Z"));
    expect(await company(companyId)).toMatchObject({
      lifecycle_state: "grace",
      unpaid_months: 2,
    });

    // Credits arrive: the next run pays both months of arrears and reactivates.
    await grantCredits(pool(), {
      accountId,
      credits: 1_000n,
      source: "purchase",
      idempotencyKey: randomUUID(),
    });
    await debitMemoryFees(pool(), new Date("2027-03-16T06:00:00Z"));
    const f = await fee();
    expect(await company(companyId)).toMatchObject({
      lifecycle_state: "active",
      unpaid_months: 0,
    });
    expect(await wallet(pool(), accountId)).toEqual({
      balance: 1_000n - 2n * f,
      held: 0n,
    });

    // Three unpaid months archive it.
    const other = await setUpCompany(0n);
    for (const d of ["2027-02-15", "2027-03-15"])
      await debitMemoryFees(pool(), new Date(`${d}T06:00:00Z`));
    await queueLifecycleNotices(pool(), new Date("2027-04-08T06:00:00Z"));
    expect(await notices(other.accountId)).toContain("lifecycle.archive_notice");
    await debitMemoryFees(pool(), new Date("2027-04-15T06:00:00Z"));
    const archived = await company(other.companyId);
    expect(archived).toMatchObject({ lifecycle_state: "archived", unpaid_months: 3 });
    expect(archived?.purge_after).not.toBeNull();
  });

  it("restores an archived company for the restore price plus the current month's fee", async () => {
    const { accountId, companyId } = await setUpCompany(0n);
    for (const d of ["2027-02-15", "2027-03-15", "2027-04-15"])
      await debitMemoryFees(pool(), new Date(`${d}T06:00:00Z`));
    expect((await company(companyId))?.lifecycle_state).toBe("archived");
    expect(
      await restoreCompany(pool(), {
        accountId,
        companyId,
        now: new Date("2027-05-02T06:00:00Z"),
      }),
    ).toMatchObject({ status: "insufficient_credits" });
    await grantCredits(pool(), {
      accountId,
      credits: 2_000n,
      source: "purchase",
      idempotencyKey: randomUUID(),
    });
    const r = await restoreCompany(pool(), {
      accountId,
      companyId,
      now: new Date("2027-05-02T06:00:00Z"),
    });
    const expected = (await restorePrice()) + (await fee());
    expect(r).toEqual({ status: "restored", credits: expected });
    expect(await company(companyId)).toMatchObject({
      lifecycle_state: "active",
      unpaid_months: 0,
      purge_after: null,
    });
    expect(await wallet(pool(), accountId)).toEqual({
      balance: 2_000n - expected,
      held: 0n,
    });
    // The new cycle starts on the restore date: nothing more is due until 2 June.
    await debitMemoryFees(pool(), new Date("2027-05-20T06:00:00Z"));
    expect((await wallet(pool(), accountId)).balance).toBe(2_000n - expected);
  });
});

describe("deletion and purge", () => {
  it("deletion stops fees; purge after the delay crypto-shreds the company", async () => {
    const { accountId, companyId } = await setUpCompany(5_000n);
    await storeSnapshot(pool(), wrapper, {
      accountId,
      companyId,
      jobId: null,
      payload: emptySnapshot("2027-01"),
    });
    const now = new Date("2027-02-01T06:00:00Z");
    await deleteCompany(pool(), { accountId, companyId, now });
    await debitMemoryFees(pool(), new Date("2027-02-15T06:00:00Z"));
    expect(await wallet(pool(), accountId)).toEqual({ balance: 5_000n, held: 0n });

    const store = new MemoryOutputStore();
    expect(await purgeCompanies(pool(), store, new Date("2027-02-20T06:00:00Z"))).toBe(0);
    expect(await purgeCompanies(pool(), store, new Date("2027-03-05T06:00:00Z"))).toBe(1);
    expect((await company(companyId))?.lifecycle_state).toBe("purged");
    await expect(
      latestSnapshot(pool(), wrapper, { accountId, companyId, period: "2027-01" }),
    ).rejects.toThrow(/destroyed/u);
    expect(await notices(accountId)).toContain("lifecycle.purged");
  });
});

describe("account erasure (SPEC §10, §31; Phase 9 acceptance: purge verifiably destroys keys)", () => {
  it("closes the account now and, after the delay, destroys every key so sealed data cannot be opened", async () => {
    const { accountId, companyId } = await setUpCompany(5_000n);
    await storeSnapshot(pool(), wrapper, { accountId, companyId, jobId: null, payload: emptySnapshot("2027-01") });
    await saveAccountRules(pool(), wrapper, { accountId, companyId, rules: [{ pattern: "courier charges", head: "OPEX" }] });
    expect(await loadAccountRules(pool(), wrapper, accountId)).toHaveLength(1);
    const ledgerBefore = await pool().query(`select count(*)::int as n from credit_ledger where account_id = $1`, [accountId]);

    const now = new Date("2027-02-01T06:00:00Z");
    const { purgeAfter } = await deleteAccount(pool(), { accountId, now });
    const closed = await pool().query(`select status, active_session_id from accounts where id = $1`, [accountId]);
    expect(closed.rows[0]).toEqual({ status: "deleted", active_session_id: null });
    expect(await notices(accountId)).toContain("account.deletion_scheduled");
    // Fees stop with the account.
    await debitMemoryFees(pool(), new Date("2027-02-15T06:00:00Z"));
    expect(await wallet(pool(), accountId)).toEqual({ balance: 5_000n, held: 0n });

    const store = new MemoryOutputStore();
    expect(await purgeAccounts(pool(), store, new Date(purgeAfter.getTime() - 60_000))).toBe(0);
    expect(await purgeAccounts(pool(), store, new Date(purgeAfter.getTime() + 60_000))).toBe(1);

    const keys = await pool().query<{ wrapped_dek: Buffer | null; destroyed_at: Date | null }>(
      `select wrapped_dek, destroyed_at from company_keys where company_id = $1
       union all select wrapped_dek, destroyed_at from account_keys where account_id = $2`,
      [companyId, accountId],
    );
    expect(keys.rows).toHaveLength(2);
    for (const k of keys.rows) {
      expect(k.wrapped_dek).toBeNull();
      expect(k.destroyed_at).not.toBeNull();
    }
    // The ciphertext is still in the database, and nothing can read it.
    const sealed = await pool().query(`select count(*)::int as n from snapshots where company_id = $1`, [companyId]);
    expect(sealed.rows[0]).toEqual({ n: 1 });
    await expect(latestSnapshot(pool(), wrapper, { accountId, companyId, period: "2027-01" })).rejects.toThrow(/destroyed/u);
    expect(await loadAccountRules(pool(), wrapper, accountId)).toEqual([]);
    // A destroyed account key is never silently replaced.
    await expect(
      saveAccountRules(pool(), wrapper, { accountId, companyId: null, rules: [{ pattern: "x", head: "OPEX" }] }),
    ).rejects.toThrow(/destroyed/u);

    const account = await pool().query<{ email: string; business_name: string }>(
      `select email, business_name from accounts where id = $1`,
      [accountId],
    );
    expect(account.rows[0]?.email).toBe(`purged-${accountId}@invalid`);
    expect(account.rows[0]?.business_name).toBe("Deleted account");
    const ledgerAfter = await pool().query(`select count(*)::int as n from credit_ledger where account_id = $1`, [accountId]);
    expect(ledgerAfter.rows[0]).toEqual(ledgerBefore.rows[0]);
    expect(await purgeAccounts(pool(), store, new Date(purgeAfter.getTime() + 120_000))).toBe(0);
  });
});

describe("notices and reminders", () => {
  it("warns of a low balance 7 and 1 days before the fee, and reminds monthly on the reminder day", async () => {
    const { accountId, companyId } = await setUpCompany(10n);
    await queueLifecycleNotices(pool(), new Date("2027-02-08T06:00:00Z"));
    await queueLifecycleNotices(pool(), new Date("2027-02-08T09:00:00Z"));
    await queueLifecycleNotices(pool(), new Date("2027-02-14T06:00:00Z"));
    expect(
      (await notices(accountId)).filter((t) => t === "billing.low_balance_before_fee"),
    ).toHaveLength(2);

    await pool().query(`update companies set reminder_day_of_month = 7 where id = $1`, [
      companyId,
    ]);
    // Other companies in this database share the default reminder day, so count this account only.
    const reminders = async () =>
      (await notices(accountId)).filter((t) => t === "reminder.monthly_refresh").length;
    await queueRefreshReminders(pool(), new Date("2027-03-07T04:00:00Z"));
    expect(await reminders()).toBe(1);
    await queueRefreshReminders(pool(), new Date("2027-03-07T10:00:00Z"));
    await queueRefreshReminders(pool(), new Date("2027-03-08T04:00:00Z"));
    expect(await reminders()).toBe(1);
  });
});
