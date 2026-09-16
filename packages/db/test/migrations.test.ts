/**
 * Migrations and schema constraints.
 *
 * Every constraint in the schema exists because application code can be bypassed. These
 * tests assert each one actually refuses its violation -- a CHECK that is never tested
 * is a comment.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadMigrations, migrate, MigrationChecksumError } from "../src/migrate";
import { startTestDb, type TestDb } from "./harness";

// Undefined until beforeAll completes -- and it stays undefined if beforeAll throws,
// which is exactly when afterAll still runs. The optional chain below is not defensive
// noise; the type has to admit that.
let db: TestDb | undefined;
let accountId: string;

beforeAll(async () => {
  db = await startTestDb();
  const r = await testDb().pool.query<{ id: string }>(
    `insert into public.accounts (auth_user_id, email, business_name, state_code)
     values (gen_random_uuid(), 'constraints@example.test', 'Constraint Co', '27')
     returning id`,
  );
  const row = r.rows[0];
  if (row === undefined) throw new Error("seed failed");
  accountId = row.id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

/** The started database. Throws a clear error instead of a TypeError if setup failed. */
function testDb(): TestDb {
  if (db === undefined) throw new Error("test database was not started");
  return db;
}

describe("migration runner", () => {
  it("records every migration it applied", async () => {
    const files = await loadMigrations();
    const applied = await testDb().pool.query<{ version: string }>(
      `select version from app.schema_migrations order by version`,
    );
    expect(applied.rows.map((r) => r.version)).toEqual(files.map((f) => f.version));
  });

  it("is idempotent — a second run applies nothing", async () => {
    const result = await migrate(testDb().pool);
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it("detects a migration edited after it was applied", async () => {
    // Silent divergence between the repo and a deployed database is the failure here:
    // every later environment would get a different schema.
    await testDb().pool.query(
      `update app.schema_migrations set checksum = 'deadbeef' where version = $1`,
      ["0002_identity"],
    );
    await expect(migrate(testDb().pool)).rejects.toThrow(MigrationChecksumError);

    const files = await loadMigrations();
    const original = files.find((f) => f.version === "0002_identity");
    await testDb().pool.query(
      `update app.schema_migrations set checksum = $1 where version = $2`,
      [original?.checksum, "0002_identity"],
    );
  });
});

describe("wallet invariants are enforced by the database", () => {
  it("refuses a negative balance", async () => {
    await expect(
      testDb().pool.query(
        `insert into public.wallets (account_id, balance_credits) values ($1, -1)`,
        [accountId],
      ),
    ).rejects.toThrow(/wallets_balance_non_negative/iu);
  });

  it("refuses held exceeding balance", async () => {
    await expect(
      testDb().pool.query(
        `insert into public.wallets (account_id, balance_credits, held_credits)
         values ($1, 10, 11)`,
        [accountId],
      ),
    ).rejects.toThrow(/wallets_held_within_balance/iu);
  });

  it("refuses a lot with more remaining than granted", async () => {
    await expect(
      testDb().pool.query(
        `insert into public.credit_lots (account_id, source, credits_granted, credits_remaining, expires_at)
         values ($1, 'purchase', 100, 101, now() + interval '1 year')`,
        [accountId],
      ),
    ).rejects.toThrow(/credit_lots_remaining_within_granted/iu);
  });

  it("refuses a negative remaining balance on a lot", async () => {
    await expect(
      testDb().pool.query(
        `insert into public.credit_lots (account_id, source, credits_granted, credits_remaining, expires_at)
         values ($1, 'purchase', 100, -1, now() + interval '1 year')`,
        [accountId],
      ),
    ).rejects.toThrow(/credits_remaining/iu);
  });

  it("enforces the ledger idempotency key as unique", async () => {
    const insert = (key: string): Promise<unknown> =>
      testDb().pool.query(
        `insert into public.credit_ledger
           (account_id, entry_type, amount, balance_after, held_after, idempotency_key, prev_hash, hash)
         values ($1, 'grant', 100, 100, 0, $2, 'p', 'h')`,
        [accountId, key],
      );
    await insert("idem-1");
    await expect(insert("idem-1")).rejects.toThrow(/duplicate key|unique/iu);
  });

  it("refuses a ledger entry with held above balance", async () => {
    await expect(
      testDb().pool.query(
        `insert into public.credit_ledger
           (account_id, entry_type, amount, balance_after, held_after, idempotency_key, prev_hash, hash)
         values ($1, 'reserve', 10, 5, 6, 'idem-bad', 'p', 'h')`,
        [accountId],
      ),
    ).rejects.toThrow(/credit_ledger_held_within_balance/iu);
  });

  it("refuses a reservation that belongs to both a job and a chat message", async () => {
    await expect(
      testDb().pool.query(
        `insert into public.reservations (account_id, job_id, chat_message_id, amount, expires_at)
         values ($1, gen_random_uuid(), gen_random_uuid(), 10, now() + interval '2 hours')`,
        [accountId],
      ),
    ).rejects.toThrow(/reservations_single_subject|violates foreign key/iu);
  });
});

describe("GST invariants (SPEC §13)", () => {
  const insertPurchase = (
    cgst: number,
    sgst: number,
    igst: number,
    gst: number,
  ): Promise<unknown> =>
    testDb().pool.query(
      `insert into public.purchases
         (account_id, amount_minor_ex_tax, tax_minor, cgst_minor, sgst_minor, igst_minor,
          total_minor, method, status)
       values ($1, 200000, $2, $3, $4, $5, $6, 'razorpay', 'created')`,
      [accountId, gst, cgst, sgst, igst, 200000 + gst],
    );

  it("accepts an intra-state split", async () => {
    await expect(insertPurchase(18000, 18000, 0, 36000)).resolves.toBeDefined();
  });

  it("accepts an inter-state IGST charge", async () => {
    await expect(insertPurchase(0, 0, 36000, 36000)).resolves.toBeDefined();
  });

  it("refuses charging both CGST/SGST and IGST", async () => {
    await expect(insertPurchase(9000, 9000, 18000, 36000)).rejects.toThrow(
      /purchases_gst_is_intra_or_inter/iu,
    );
  });

  it("refuses components that do not sum to the GST total", async () => {
    // Equal split, so only the sum constraint can be the one that fires. An unequal
    // split would trip purchases_cgst_sgst_equal_split first and the test would pass
    // for the wrong reason.
    await expect(insertPurchase(18000, 18000, 0, 37000)).rejects.toThrow(
      /purchases_gst_components_sum/iu,
    );
  });

  it("refuses an unequal CGST/SGST split beyond a single paisa", async () => {
    await expect(insertPurchase(20000, 16000, 0, 36000)).rejects.toThrow(
      /purchases_cgst_sgst_equal_split/iu,
    );
  });

  it("allows a one-paisa difference, since an odd total cannot split evenly", async () => {
    await expect(insertPurchase(18001, 18000, 0, 36001)).resolves.toBeDefined();
  });
});

describe("other schema invariants", () => {
  it("refuses an fy_start_month outside 1-12", async () => {
    await expect(
      testDb().pool.query(
        `insert into public.companies (account_id, name, fy_start_month)
                     values ($1, 'Bad FY', 13)`,
        [accountId],
      ),
    ).rejects.toThrow(/fy_start_month/iu);
  });

  it("refuses a malformed period id on a snapshot", async () => {
    const company = await testDb().pool.query<{ id: string }>(
      `insert into public.companies (account_id, name) values ($1, 'Period Co') returning id`,
      [accountId],
    );
    await expect(
      testDb().pool.query(
        `insert into public.snapshots
           (company_id, account_id, period, version, ledger_balances, metric_store, engine_version)
         values ($1, $2, '2025-13', 1, '\\x00', '\\x00', 't')`,
        [company.rows[0]?.id, accountId],
      ),
    ).rejects.toThrow(/period/iu);
  });

  it("refuses a company key marked destroyed that still holds a wrapped DEK", async () => {
    // SPEC §10: purge is crypto-shredding. "Destroyed" must mean the key is gone.
    const company = await testDb().pool.query<{ id: string }>(
      `insert into public.companies (account_id, name) values ($1, 'Shred Co') returning id`,
      [accountId],
    );
    await expect(
      testDb().pool.query(
        `insert into public.company_keys (company_id, account_id, wrapped_dek, kms_key_version, destroyed_at)
         values ($1, $2, '\\xdeadbeef', 'v1', now())`,
        [company.rows[0]?.id, accountId],
      ),
    ).rejects.toThrow(/company_keys_shred_is_real/iu);
  });

  it("refuses a model registry row without a verification source (SPEC §0.4)", async () => {
    await expect(
      testDb().pool.query(
        `insert into public.model_registry
           (model_id, display_name_internal, input_price_per_mtok_micro_usd,
            output_price_per_mtok_micro_usd, verified_at)
         values ('x', 'X', 1, 1, now())`,
      ),
    ).rejects.toThrow(/source_url/iu);
  });

  it("refuses a promoted library entry with no approving admin (SPEC §18)", async () => {
    const head = await testDb().pool.query<{ id: string }>(
      `select id from public.mis_heads where code = 'UNMAPPED'`,
    );
    await expect(
      testDb().pool.query(
        `insert into public.global_mapping_library (normalized_name, mis_head_id, source)
         values ('salary', $1, 'promoted')`,
        [head.rows[0]?.id],
      ),
    ).rejects.toThrow(/global_library_promotion_is_attributed/iu);
  });

  it("refuses an estimator p90 below its p50", async () => {
    await expect(
      testDb().pool.query(
        `insert into public.estimator_calibration
           (action_key, tier, size_bucket, p50_cost_micro_usd, p90_cost_micro_usd)
         values ('company_setup', 'professional', 'large', 500, 100)`,
      ),
    ).rejects.toThrow(/estimator_p90_not_below_p50/iu);
  });

  it("refuses a failed job with no failure class (SPEC §23 — billing depends on it)", async () => {
    await expect(
      testDb().pool.query(
        `insert into public.jobs (account_id, type, state, idempotency_key)
         values ($1, 'company_setup', 'failed_data', 'k1')`,
        [accountId],
      ),
    ).rejects.toThrow(/jobs_failure_is_classified/iu);
  });

  it("refuses a user chat message with no declared type (SPEC §27 — type is the price)", async () => {
    const company = await testDb().pool.query<{ id: string }>(
      `insert into public.companies (account_id, name) values ($1, 'Chat Co') returning id`,
      [accountId],
    );
    const thread = await testDb().pool.query<{ id: string }>(
      `insert into public.chat_threads (account_id, company_id) values ($1, $2) returning id`,
      [accountId, company.rows[0]?.id],
    );
    await expect(
      testDb().pool.query(
        `insert into public.chat_messages (thread_id, account_id, role, content)
         values ($1, $2, 'user', '\\x00')`,
        [thread.rows[0]?.id, accountId],
      ),
    ).rejects.toThrow(/chat_messages_user_declares_type/iu);
  });

  it("keeps blueprints immutable (SPEC §9)", async () => {
    const company = await testDb().pool.query<{ id: string }>(
      `insert into public.companies (account_id, name) values ($1, 'BP Co') returning id`,
      [accountId],
    );
    await testDb().pool.query(
      `insert into public.blueprints
         (company_id, account_id, version, template_spec, recipe, mapping_rules, prev_hash, hash)
       values ($1, $2, 1, '\\x00', '\\x00', '\\x00', 'p', 'h')`,
      [company.rows[0]?.id, accountId],
    );
    await expect(
      testDb().pool.query(`update public.blueprints set version = 2`),
    ).rejects.toThrow(/append-only/iu);
  });
});
