/** Global library candidates from account rules (SPEC §18, R-31). */

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordLibraryVotes, refreshLibraryCandidates } from "../src/library";
import { deleteAccount, purgeAccounts } from "../src/lifecycle";
import { accountWithCompany, MemoryOutputStore, wrapper } from "./helpers";

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

const candidate = async (name: string) =>
  (
    await pool().query<{ distinct_account_count: number; code: string; status: string }>(
      `select c.distinct_account_count, h.code, c.status from library_candidates c
       join mis_heads h on h.id = c.proposed_mis_head_id where c.normalized_name = $1`,
      [name],
    )
  ).rows;

describe("library candidates (SPEC §18)", () => {
  it("proposes a generic name once enough distinct accounts map it to the same head, never a party", async () => {
    const min =
      (
        await pool().query<{ value: number }>(
          `select value from app_config where key = 'semantic.library_promotion_min_accounts' order by effective_from desc limit 1`,
        )
      ).rows[0]?.value ?? 0;
    expect(min).toBeGreaterThan(1);

    const accounts: string[] = [];
    for (let i = 0; i < min; i++)
      accounts.push((await accountWithCompany(pool(), 0n)).accountId);
    const rules = [
      { pattern: "Courier & Postage Charges", head: "OPEX_OTHER" },
      { pattern: "Sharma Traders Pvt Ltd", head: "CL_PAYABLES" },
      { pattern: "PARTY_9f3a1c2e4b5d", head: "CA_RECEIVABLES" },
    ];

    // One account short of the threshold: nothing yet. The same account voting twice counts once.
    for (const accountId of accounts.slice(0, -1))
      expect(await recordLibraryVotes(pool(), wrapper, { accountId, rules })).toBe(1);
    await recordLibraryVotes(pool(), wrapper, { accountId: accounts[0] ?? "", rules });
    await refreshLibraryCandidates(pool(), wrapper);
    expect(await candidate("courier and postage charges")).toEqual([]);

    await recordLibraryVotes(pool(), wrapper, {
      accountId: accounts.at(-1) ?? "",
      rules,
    });
    await refreshLibraryCandidates(pool(), wrapper);
    expect(await candidate("courier and postage charges")).toEqual([
      { distinct_account_count: min, code: "OPEX_OTHER", status: "pending" },
    ]);

    // Nothing stored names a party or reveals which accounts voted.
    const stored = await pool().query<{ n: number }>(
      `select count(*)::int as n from library_candidates where normalized_name like '%sharma%' or normalized_name like '%party%'`,
    );
    expect(stored.rows[0]?.n).toBe(0);
    const votes = await pool().query(`select * from library_votes limit 1`);
    const fields = JSON.stringify(votes.rows[0]);
    for (const id of accounts) expect(fields).not.toContain(id);
    expect(fields).not.toContain("courier");

    // A purged account stops counting; the pending candidate's count drops on the next pass.
    const { purgeAfter } = await deleteAccount(pool(), { accountId: accounts[0] ?? "" });
    await purgeAccounts(
      pool(),
      new MemoryOutputStore(),
      new Date(purgeAfter.getTime() + 60_000),
      wrapper,
    );
    await refreshLibraryCandidates(pool(), wrapper);
    expect(await candidate("courier and postage charges")).toEqual([
      { distinct_account_count: min - 1, code: "OPEX_OTHER", status: "pending" },
    ]);
  });

  it("does not propose a name the global library already has", async () => {
    const min = 5;
    for (let i = 0; i < min; i++) {
      const { accountId } = await accountWithCompany(pool(), 0n);
      await recordLibraryVotes(pool(), wrapper, {
        accountId,
        rules: [{ pattern: "Bank Charges", head: "OPEX_BANK" }],
      });
    }
    await refreshLibraryCandidates(pool(), wrapper);
    expect(await candidate("bank charges")).toEqual([]);
  });
});
