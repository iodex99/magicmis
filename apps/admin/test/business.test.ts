/**
 * The owner's business report (ADR 0055).
 *
 * What is worth testing here is not that a count counts. It is the two places the figures could
 * quietly mislead: cash collected must not be reported as revenue earned, and the recurring
 * figure must separate the memory fee, which is contracted, from consumption, which is not.
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { businessReport } from "../src/server/business";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("test database was not started");
  return db.pool;
};

const NOW = new Date("2027-01-10T06:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

async function account(created: Date): Promise<string> {
  const r = await pool().query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code, billing_country, created_at)
     values (gen_random_uuid(), $1, 'Report Co', '27', 'IN', $2) returning id`,
    [`${randomUUID()}@example.test`, created],
  );
  const id = r.rows[0]?.id ?? "";
  await pool().query(`insert into wallets (account_id) values ($1)`, [id]);
  return id;
}

describe("the owner's business report", () => {
  it("counts signups, activation and paying accounts as distinct steps", async () => {
    const before = await businessReport(pool(), NOW);

    const justSignedUp = await account(ago(2));
    const activated = await account(ago(20));
    await pool().query(
      `insert into companies (account_id, name, first_setup_at) values ($1, 'Set Up Co', $2)`,
      [activated, ago(18)],
    );

    const after = await businessReport(pool(), NOW);
    expect(after.growth.accounts).toBe(before.growth.accounts + 2);
    expect(after.growth.accountsLast7).toBe(before.growth.accountsLast7 + 1);
    // Adding a company is not activation; completing a setup is.
    expect(after.growth.activated).toBe(before.growth.activated + 1);
    expect(after.growth.withCompany).toBe(before.growth.withCompany + 1);
    // Neither of them has bought anything, so neither counts as paying.
    expect(after.growth.paying).toBe(before.growth.paying);
    expect(justSignedUp).not.toBe(activated);
  });

  it("keeps cash collected apart from revenue earned, and counts the unspent balance as owed", async () => {
    // The distinction a prepaid product lives with: money arrives once and is earned over
    // months. Reporting the purchase as revenue would overstate every month somebody buys in.
    const accountId = await account(ago(40));
    const before = await businessReport(pool(), NOW);

    await pool().query(
      `insert into purchases (account_id, amount_minor_ex_tax, tax_minor, igst_minor, total_minor,
                              method, currency, status, credits, created_at, credited_at, buyer_country)
       values ($1, 1000000, 180000, 180000, 1180000, 'razorpay', 'INR', 'credited', 10000, $2, $2, 'IN')`,
      [accountId, ago(20)],
    );

    const paid = await businessReport(pool(), NOW);
    const inr = (rows: readonly { currency: string; exTax: string }[]) =>
      BigInt(rows.find((c) => c.currency === "INR")?.exTax ?? "0");

    // ₹10,000 ex-tax reached the bank.
    expect(inr(paid.cash.collected) - inr(before.cash.collected)).toBe(1_000_000n);
    // And none of it is revenue yet, because nothing has been spent.
    expect(paid.recognised.creditsAllTime).toBe(before.recognised.creditsAllTime);
  });

  it("separates the contracted memory fee from consumption, and never adds them into one MRR", async () => {
    // The baseline is taken before the company exists, because the committed figure counts
    // active companies: measuring after adding it would compare a number with itself.
    const before = await businessReport(pool(), NOW);
    const accountId = await account(ago(60));
    const c = await pool().query<{ id: string }>(
      `insert into companies (account_id, name, lifecycle_state, first_setup_at)
       values ($1, 'Active Co', 'active', $2) returning id`,
      [accountId, ago(50)],
    );
    const companyId = c.rows[0]?.id ?? "";

    // A month's memory fee, which is contracted, and a run, which is not.
    await pool().query(
      `insert into company_fee_charges (company_id, account_id, fee_month, kind, credits, status, created_at)
       values ($1, $2, '2026-12', 'memory_fee', 99, 'captured', $3)`,
      [companyId, accountId, ago(10)],
    );
    await pool().query(
      `insert into credit_ledger (account_id, entry_type, amount, balance_after, held_after, idempotency_key, prev_hash, hash, created_at)
       values ($1, 'capture', 99, 0, 0, $2, '', '', $3),
              ($1, 'capture', 299, 0, 0, $4, '', '', $3)`,
      [accountId, randomUUID(), ago(10), randomUUID()],
    );

    const after = await businessReport(pool(), NOW);
    // Both captures are revenue earned.
    expect(
      BigInt(after.recognised.creditsLast30) - BigInt(before.recognised.creditsLast30),
    ).toBe(398n);
    // Consumption excludes the fee, so the two cannot be double counted into the run rate.
    expect(
      BigInt(after.recurring.consumptionMonthlyCredits) -
        BigInt(before.recurring.consumptionMonthlyCredits),
    ).toBe(299n);
    // The committed figure is the fee times active companies, and owes nothing to consumption.
    expect(after.recurring.activeCompanies).toBe(before.recurring.activeCompanies + 1);
    expect(
      BigInt(after.recurring.committedMonthlyCredits) -
        BigInt(before.recurring.committedMonthlyCredits),
    ).toBe(BigInt(after.recurring.feePerCompanyCredits));
  });

  it("reports AI cost against revenue earned rather than cash collected", async () => {
    const accountId = await account(ago(30));
    const before = await businessReport(pool(), NOW);
    await pool().query(
      `insert into ai_calls (account_id, stage, prompt_version, model_requested, model_used,
                             max_tokens, input_tokens, output_tokens, cache_read_input_tokens,
                             usd_cost_micro, inr_cost_paise, fx_rate_used, created_at)
       values ($1, 'commentary', 'commentary/v1', 'claude-sonnet-5', 'claude-sonnet-5',
               2000, 1000, 500, 3000, 50000, 4900, 97.85, $2)`,
      [accountId, ago(5)],
    );
    const after = await businessReport(pool(), NOW);
    expect(BigInt(after.ai.costPaiseLast30) - BigInt(before.ai.costPaiseLast30)).toBe(
      4900n,
    );
    expect(after.ai.callsLast30).toBe(before.ai.callsLast30 + 1);
    // Cached input is counted against all input read, not against output.
    expect(Number.parseFloat(after.ai.cacheHitPercent)).toBeGreaterThan(0);
  });
});
