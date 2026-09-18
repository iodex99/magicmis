/**
 * SPEC §11 required tests, against real Postgres:
 *   - Property: ledger replay reproduces `wallets` exactly
 *   - Property: balance and held never go negative under any operation sequence
 *   - Concurrency: 50 parallel reservations against a balance that fits 10 → exactly 10
 *   - Idempotency: the same key twice produces one effect
 *   - Time travel: lot expiry, reservation expiry, FIFO order
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readLedger, replayLedger } from "../src/ledger";
import {
  adminAdjust,
  captureReservation,
  grantCredits,
  heartbeatReservation,
  releaseReservation,
  reserveCredits,
  sweepExpiredReservations,
  walletSummary,
} from "../src/wallet";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
function testDb(): TestDb {
  if (db === undefined) throw new Error("test database was not started");
  return db;
}

const DAY = 86_400_000;
const T0 = new Date("2026-04-01T06:00:00Z");
const at = (days: number, hours = 0) =>
  new Date(T0.getTime() + days * DAY + hours * 3_600_000);

async function newAccount(): Promise<string> {
  const r = await testDb().pool.query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code)
     values (gen_random_uuid(), $1, 'Wallet Test Co', '27') returning id`,
    [`${randomUUID()}@example.test`],
  );
  const id = r.rows[0]?.id;
  if (id === undefined) throw new Error("account insert failed");
  await testDb().pool.query(`insert into wallets (account_id) values ($1)`, [id]);
  return id;
}

async function newJob(accountId: string): Promise<string> {
  const r = await testDb().pool.query<{ id: string }>(
    `insert into jobs (account_id, type, idempotency_key) values ($1, 'company_setup', $2) returning id`,
    [accountId, randomUUID()],
  );
  const id = r.rows[0]?.id;
  if (id === undefined) throw new Error("job insert failed");
  return id;
}

async function walletRow(accountId: string) {
  const r = await testDb().pool.query<{ balance_credits: string; held_credits: string }>(
    `select balance_credits, held_credits from wallets where account_id = $1`,
    [accountId],
  );
  return {
    balance: BigInt(r.rows[0]?.balance_credits ?? "-1"),
    held: BigInt(r.rows[0]?.held_credits ?? "-1"),
  };
}

/** The invariants that must hold after any operation, checked against the database itself. */
async function assertInvariants(accountId: string) {
  const pool = testDb().pool;
  const wallet = await walletRow(accountId);
  const ledger = await readLedger(pool, accountId);
  const replay = replayLedger(accountId, ledger);

  expect(
    replay.inconsistentSeqs,
    "every ledger row's after-state follows from the previous",
  ).toEqual([]);
  expect(replay.brokenChainSeqs, "per-account hash chain verifies").toEqual([]);
  expect(replay.state, "ledger replay reproduces the wallet row").toEqual(wallet);
  expect(wallet.balance >= 0n && wallet.held >= 0n && wallet.held <= wallet.balance).toBe(
    true,
  );

  const lots = await pool.query<{ sum: string | null }>(
    `select sum(credits_remaining)::text as sum from credit_lots where account_id = $1`,
    [accountId],
  );
  const holds = await pool.query<{ sum: string | null }>(
    `select sum(amount)::text as sum from reservations where account_id = $1 and status = 'held'`,
    [accountId],
  );
  expect(wallet.balance, "balance = Σ lots").toBe(BigInt(lots.rows[0]?.sum ?? "0"));
  expect(wallet.held, "held = Σ held reservations").toBe(
    BigInt(holds.rows[0]?.sum ?? "0"),
  );
}

describe("grant, reserve, capture, release", () => {
  it("captures FIFO oldest first and releases the remainder", async () => {
    const pool = testDb().pool;
    const accountId = await newAccount();
    const older = await grantCredits(pool, {
      accountId,
      credits: 100n,
      source: "purchase",
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    const newer = await grantCredits(pool, {
      accountId,
      credits: 100n,
      source: "bonus",
      idempotencyKey: randomUUID(),
      now: at(1),
    });
    if (older.status !== "granted" || newer.status !== "granted")
      throw new Error("grant failed");

    const jobId = await newJob(accountId);
    const reserved = await reserveCredits(pool, {
      accountId,
      amount: 180n,
      kind: "realtime",
      subject: { jobId },
      idempotencyKey: randomUUID(),
      now: at(1),
    });
    if (!reserved.ok) throw new Error("reserve failed");

    const captured = await captureReservation(pool, {
      reservationId: reserved.reservationId,
      amount: 150n,
      idempotencyKey: randomUUID(),
      now: at(1),
    });
    expect(captured).toMatchObject({ status: "captured", captured: 150n, released: 30n });

    const lots = await pool.query<{ id: string; credits_remaining: string }>(
      `select id, credits_remaining from credit_lots where account_id = $1`,
      [accountId],
    );
    const remaining = Object.fromEntries(
      lots.rows.map((l) => [l.id, l.credits_remaining]),
    );
    expect(remaining[older.lotId]).toBe("0"); // oldest credits consumed first
    expect(remaining[newer.lotId]).toBe("50");

    const res = await pool.query(
      `select status, captured_amount from reservations where id = $1`,
      [reserved.reservationId],
    );
    expect(res.rows[0]).toEqual({ status: "partially_captured", captured_amount: "150" });
    await assertInvariants(accountId);
  });

  it("refuses a reservation beyond available credits and reports the shortfall", async () => {
    const pool = testDb().pool;
    const accountId = await newAccount();
    await grantCredits(pool, {
      accountId,
      credits: 300n,
      source: "purchase",
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    const job = await newJob(accountId);
    await reserveCredits(pool, {
      accountId,
      amount: 200n,
      kind: "realtime",
      subject: { jobId: job },
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    const refused = await reserveCredits(pool, {
      accountId,
      amount: 999n,
      kind: "realtime",
      subject: { jobId: job },
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    expect(refused).toEqual({
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      available: 100n,
      shortfall: 899n,
    });
    await assertInvariants(accountId);
  });

  it("releases a hold in full", async () => {
    const pool = testDb().pool;
    const accountId = await newAccount();
    await grantCredits(pool, {
      accountId,
      credits: 500n,
      source: "purchase",
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    const r = await reserveCredits(pool, {
      accountId,
      amount: 400n,
      kind: "review",
      subject: { jobId: await newJob(accountId) },
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    if (!r.ok) throw new Error("reserve failed");
    expect(
      await releaseReservation(pool, {
        reservationId: r.reservationId,
        idempotencyKey: randomUUID(),
        now: at(0),
      }),
    ).toMatchObject({ status: "released", released: 400n });
    expect((await walletSummary(pool, accountId)).available).toBe(500n);
    await assertInvariants(accountId);
  });

  it("refuses to capture more than was reserved, and after an ordinary release", async () => {
    const pool = testDb().pool;
    const accountId = await newAccount();
    await grantCredits(pool, {
      accountId,
      credits: 500n,
      source: "purchase",
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    const r = await reserveCredits(pool, {
      accountId,
      amount: 100n,
      kind: "realtime",
      subject: { jobId: await newJob(accountId) },
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    if (!r.ok) throw new Error("reserve failed");
    await expect(
      captureReservation(pool, {
        reservationId: r.reservationId,
        amount: 101n,
        idempotencyKey: randomUUID(),
        now: at(0),
      }),
    ).rejects.toThrow(RangeError);
    await releaseReservation(pool, {
      reservationId: r.reservationId,
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    await expect(
      captureReservation(pool, {
        reservationId: r.reservationId,
        amount: 50n,
        idempotencyKey: randomUUID(),
        now: at(0),
      }),
    ).rejects.toThrow(/not held/u);
  });
});

describe("idempotency (SPEC §11)", () => {
  it("applies each operation once per key", async () => {
    const pool = testDb().pool;
    const accountId = await newAccount();
    const grantKey = randomUUID();
    expect(
      (
        await grantCredits(pool, {
          accountId,
          credits: 1000n,
          source: "purchase",
          idempotencyKey: grantKey,
          now: at(0),
        })
      ).status,
    ).toBe("granted");
    expect(
      await grantCredits(pool, {
        accountId,
        credits: 1000n,
        source: "purchase",
        idempotencyKey: grantKey,
        now: at(0),
      }),
    ).toEqual({ status: "duplicate" });

    const job = await newJob(accountId);
    const reserveKey = randomUUID();
    const first = await reserveCredits(pool, {
      accountId,
      amount: 300n,
      kind: "realtime",
      subject: { jobId: job },
      idempotencyKey: reserveKey,
      now: at(0),
    });
    const second = await reserveCredits(pool, {
      accountId,
      amount: 300n,
      kind: "realtime",
      subject: { jobId: job },
      idempotencyKey: reserveKey,
      now: at(0),
    });
    if (!first.ok || !second.ok) throw new Error("reserve failed");
    expect(second.reservationId).toBe(first.reservationId);
    expect(second.duplicate).toBe(true);

    const captureKey = randomUUID();
    await captureReservation(pool, {
      reservationId: first.reservationId,
      amount: 300n,
      idempotencyKey: captureKey,
      now: at(0),
    });
    expect(
      await captureReservation(pool, {
        reservationId: first.reservationId,
        amount: 300n,
        idempotencyKey: captureKey,
        now: at(0),
      }),
    ).toEqual({ status: "duplicate", captured: 300n });

    const adjustKey = randomUUID();
    await adminAdjust(pool, {
      accountId,
      delta: 50n,
      reason: "goodwill for outage",
      adminId: randomUUID(),
      idempotencyKey: adjustKey,
      now: at(0),
    });
    expect(
      await adminAdjust(pool, {
        accountId,
        delta: 50n,
        reason: "goodwill for outage",
        adminId: randomUUID(),
        idempotencyKey: adjustKey,
        now: at(0),
      }),
    ).toEqual({ status: "duplicate" });

    expect(await walletRow(accountId)).toEqual({ balance: 750n, held: 0n });
    await assertInvariants(accountId);
  });
});

describe("concurrency (SPEC §11)", () => {
  it("50 parallel reservations against a balance that fits 10 → exactly 10, no overdraft", async () => {
    const pool = testDb().pool;
    const accountId = await newAccount();
    await grantCredits(pool, {
      accountId,
      credits: 1000n,
      source: "purchase",
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    const jobs = await Promise.all(Array.from({ length: 50 }, () => newJob(accountId)));

    const results = await Promise.all(
      jobs.map((jobId) =>
        reserveCredits(pool, {
          accountId,
          amount: 100n,
          kind: "realtime",
          subject: { jobId },
          idempotencyKey: randomUUID(),
          now: at(0),
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.filter((r) => !r.ok)).toHaveLength(40);
    expect(await walletRow(accountId)).toEqual({ balance: 1000n, held: 1000n });
    await assertInvariants(accountId);
  });

  it("parallel captures and releases leave the ledger consistent", async () => {
    const pool = testDb().pool;
    const accountId = await newAccount();
    await grantCredits(pool, {
      accountId,
      credits: 2000n,
      source: "purchase",
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    const holds = [];
    for (let i = 0; i < 20; i++) {
      const r = await reserveCredits(pool, {
        accountId,
        amount: 90n,
        kind: "realtime",
        subject: { jobId: await newJob(accountId) },
        idempotencyKey: randomUUID(),
        now: at(0),
      });
      if (r.ok) holds.push(r.reservationId);
    }
    await Promise.all(
      holds.map((reservationId, i) =>
        i % 2 === 0
          ? captureReservation(pool, {
              reservationId,
              amount: 60n,
              idempotencyKey: randomUUID(),
              now: at(0),
            })
          : releaseReservation(pool, {
              reservationId,
              idempotencyKey: randomUUID(),
              now: at(0),
            }),
      ),
    );
    expect(await walletRow(accountId)).toEqual({ balance: 2000n - 10n * 60n, held: 0n });
    await assertInvariants(accountId);
  });
});

describe("time travel (SPEC §11)", () => {
  it("leaves a years-old lot fully spendable: credits never expire", async () => {
    const pool = testDb().pool;
    const accountId = await newAccount();
    const granted = await grantCredits(pool, {
      accountId,
      credits: 100n,
      source: "purchase",
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    if (granted.status !== "granted") throw new Error("grant failed");

    // Three years on, to the day the old twelve-month validity would have taken them.
    const later = at(1095);
    expect((await walletSummary(pool, accountId)).available).toBe(100n);

    const jobId = await newJob(accountId);
    const reserved = await reserveCredits(pool, {
      accountId,
      amount: 100n,
      kind: "realtime",
      subject: { jobId },
      idempotencyKey: randomUUID(),
      now: later,
    });
    if (!reserved.ok) throw new Error("reserve failed");
    expect(
      await captureReservation(pool, {
        reservationId: reserved.reservationId,
        amount: 100n,
        idempotencyKey: randomUUID(),
        now: later,
      }),
    ).toMatchObject({ status: "captured", captured: 100n });

    const ledger = await pool.query<{ entry_type: string }>(
      `select entry_type from credit_ledger where account_id = $1 order by seq`,
      [accountId],
    );
    expect(ledger.rows.map((r) => r.entry_type)).not.toContain("expire");
    await assertInvariants(accountId);
  });

  it("sweeps an expired reservation without a recent heartbeat and expires its job", async () => {
    const pool = testDb().pool;
    const accountId = await newAccount();
    await grantCredits(pool, {
      accountId,
      credits: 500n,
      source: "purchase",
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    const quiet = await newJob(accountId);
    const busy = await newJob(accountId);
    const a = await reserveCredits(pool, {
      accountId,
      amount: 100n,
      kind: "realtime",
      subject: { jobId: quiet },
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    const b = await reserveCredits(pool, {
      accountId,
      amount: 100n,
      kind: "realtime",
      subject: { jobId: busy },
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    if (!a.ok || !b.ok) throw new Error("reserve failed");

    // Realtime TTL is 2h. At 3h, `busy` heartbeated 1 minute ago; `quiet` never did.
    await heartbeatReservation(pool, b.reservationId, at(0, 3 - 1 / 60));
    await sweepExpiredReservations(pool, at(0, 3));

    const statuses = await pool.query<{ id: string; status: string }>(
      `select id, status from reservations where id = any($1)`,
      [[a.reservationId, b.reservationId]],
    );
    const byId = Object.fromEntries(statuses.rows.map((s) => [s.id, s.status]));
    expect(byId[a.reservationId]).toBe("expired");
    expect(byId[b.reservationId]).toBe("held");
    const job = await pool.query(`select state, failure_class from jobs where id = $1`, [
      quiet,
    ]);
    expect(job.rows[0]).toEqual({ state: "expired", failure_class: "expired" });
    await assertInvariants(accountId);
  });
});

describe("admin adjustment (SPEC §11.7)", () => {
  it("never takes credits that back a running hold", async () => {
    const pool = testDb().pool;
    const accountId = await newAccount();
    await grantCredits(pool, {
      accountId,
      credits: 100n,
      source: "purchase",
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    await reserveCredits(pool, {
      accountId,
      amount: 80n,
      kind: "realtime",
      subject: { jobId: await newJob(accountId) },
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    expect(
      await adminAdjust(pool, {
        accountId,
        delta: -50n,
        reason: "reversal of duplicate grant",
        adminId: randomUUID(),
        idempotencyKey: randomUUID(),
        now: at(0),
      }),
    ).toEqual({ status: "insufficient_available", available: 20n });
    expect(
      (
        await adminAdjust(pool, {
          accountId,
          delta: -20n,
          reason: "reversal of duplicate grant",
          adminId: randomUUID(),
          idempotencyKey: randomUUID(),
          now: at(0),
        })
      ).status,
    ).toBe("adjusted");
    await assertInvariants(accountId);
  });

  it("requires a reason", async () => {
    const accountId = await newAccount();
    await expect(
      adminAdjust(testDb().pool, {
        accountId,
        delta: 10n,
        reason: " ",
        adminId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(/reason/u);
  });

  it("writes an audit entry naming the admin", async () => {
    const pool = testDb().pool;
    const accountId = await newAccount();
    const adminId = randomUUID();
    await adminAdjust(pool, {
      accountId,
      delta: 25n,
      reason: "support credit for ticket 812",
      adminId,
      idempotencyKey: randomUUID(),
      now: at(0),
    });
    const audit = await pool.query(
      `select actor_type, actor_id, action from audit_log where target_id = $1`,
      [accountId],
    );
    expect(audit.rows).toContainEqual({
      actor_type: "admin",
      actor_id: adminId,
      action: "wallet.admin_adjust",
    });
  });
});

describe("property (SPEC §11): arbitrary operation sequences", () => {
  type Op =
    | { kind: "grant"; credits: number }
    | { kind: "reserve"; amount: number }
    | { kind: "capture"; pick: number; fraction: number }
    | { kind: "release"; pick: number }
    | { kind: "adjust"; delta: number }
    | { kind: "advance"; days: number };

  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      kind: fc.constant("grant" as const),
      credits: fc.integer({ min: 1, max: 500 }),
    }),
    fc.record({
      kind: fc.constant("reserve" as const),
      amount: fc.integer({ min: 1, max: 600 }),
    }),
    fc.record({
      kind: fc.constant("capture" as const),
      pick: fc.nat(),
      fraction: fc.integer({ min: 0, max: 100 }),
    }),
    fc.record({ kind: fc.constant("release" as const), pick: fc.nat() }),
    fc.record({
      kind: fc.constant("adjust" as const),
      delta: fc.integer({ min: -200, max: 200 }).filter((d) => d !== 0),
    }),
    fc.record({
      kind: fc.constant("advance" as const),
      days: fc.integer({ min: 1, max: 45 }),
    }),
  );

  it("never drives balance or held negative, and the ledger always replays to the wallet", async () => {
    const pool = testDb().pool;
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 5, maxLength: 25 }), async (ops) => {
        const accountId = await newAccount();
        let now = at(0);
        const holds: string[] = [];

        for (const o of ops) {
          switch (o.kind) {
            case "grant":
              await grantCredits(pool, {
                accountId,
                credits: BigInt(o.credits),
                source: "purchase",
                idempotencyKey: randomUUID(),
                now,
              });
              break;
            case "reserve": {
              const r = await reserveCredits(pool, {
                accountId,
                amount: BigInt(o.amount),
                kind: "realtime",
                subject: { chatMessageId: randomUUID() },
                idempotencyKey: randomUUID(),
                now,
              });
              if (r.ok) holds.push(r.reservationId);
              break;
            }
            case "capture": {
              const id =
                holds.length === 0
                  ? undefined
                  : holds.splice(o.pick % holds.length, 1)[0];
              if (id === undefined) break;
              const res = await pool.query<{ amount: string; status: string }>(
                `select amount, status from reservations where id = $1`,
                [id],
              );
              const row = res.rows[0];
              if (row?.status !== "held") break;
              const amount = (BigInt(row.amount) * BigInt(o.fraction)) / 100n;
              await captureReservation(pool, {
                reservationId: id,
                amount,
                idempotencyKey: randomUUID(),
                now,
              });
              break;
            }
            case "release": {
              const id =
                holds.length === 0
                  ? undefined
                  : holds.splice(o.pick % holds.length, 1)[0];
              if (id !== undefined)
                await releaseReservation(pool, {
                  reservationId: id,
                  idempotencyKey: randomUUID(),
                  now,
                });
              break;
            }
            case "adjust":
              await adminAdjust(pool, {
                accountId,
                delta: BigInt(o.delta),
                reason: "property test adjustment",
                adminId: randomUUID(),
                idempotencyKey: randomUUID(),
                now,
              });
              break;
            case "advance":
              now = new Date(now.getTime() + o.days * DAY);
              break;
          }
          const w = await walletRow(accountId);
          if (w.balance < 0n || w.held < 0n || w.held > w.balance) return false;
        }

        await assertInvariants(accountId);
        return true;
      }),
      { numRuns: 30 },
    );
  }, 600_000);
});
