/**
 * Wallet load test (SPEC §30, §11). Drives many accounts through concurrent grant → reserve →
 * capture/release cycles against a Postgres with the migrations applied, then proves the money
 * invariants still hold: every ledger replays to its wallet row, the hash chains verify, no balance
 * or hold went negative, and credits in = credits captured + balance.
 *
 *   pnpm --filter @magicmis/wallet load -- --accounts 20 --cycles 50 --concurrency 16
 *
 * DATABASE_URL defaults to the local Supabase stack. Refuses any non-local host: this writes accounts.
 * Prints latency percentiles per operation and the invariant results as JSON; exits 1 on a violation.
 */

import { randomUUID } from "node:crypto";

import pg from "pg";

import { readLedger, replayLedger } from "../src/ledger";
import {
  captureReservation,
  grantCredits,
  releaseReservation,
  reserveCredits,
} from "../src/wallet";

const args = new Map<string, string>();
const argv = process.argv.slice(2).filter((a) => a !== "--");
for (let i = 0; i < argv.length; i += 2) args.set(argv[i] ?? "", argv[i + 1] ?? "");
const int = (name: string, fallback: number) => {
  const v = args.get(`--${name}`);
  return v === undefined || !/^\d+$/u.test(v) ? fallback : Number.parseInt(v, 10);
};
const ACCOUNTS = int("accounts", 10);
const CYCLES = int("cycles", 30);
const CONCURRENCY = int("concurrency", 8);
const url =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost")
  throw new Error(`load test refuses non-local database host ${host}`);

const pool = new pg.Pool({ connectionString: url, max: CONCURRENCY + 4 });
const timings = new Map<string, number[]>();
const time = async <T>(op: string, fn: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const list = timings.get(op) ?? [];
    list.push(performance.now() - start);
    timings.set(op, list);
  }
};
const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

async function cycle(accountId: string, companyId: string, n: number): Promise<bigint> {
  const job = await pool.query<{ id: string }>(
    `insert into jobs (account_id, company_id, type, state, idempotency_key) values ($1, $2, 'monthly_refresh', 'classifying', $3) returning id`,
    [accountId, companyId, randomUUID()],
  );
  const jobId = job.rows[0]?.id ?? "";
  const amount = BigInt(10 + (n % 7));
  const reserved = await time("reserve", () =>
    reserveCredits(pool, {
      accountId,
      amount,
      kind: "realtime",
      subject: { jobId },
      idempotencyKey: randomUUID(),
    }),
  );
  if (!reserved.ok) return 0n;
  if (n % 4 === 0) {
    await time("release", () =>
      releaseReservation(pool, {
        reservationId: reserved.reservationId,
        idempotencyKey: randomUUID(),
      }),
    );
    return 0n;
  }
  const captured = await time("capture", () =>
    captureReservation(pool, {
      reservationId: reserved.reservationId,
      amount,
      idempotencyKey: randomUUID(),
    }),
  );
  return captured.status === "captured" ? captured.captured : 0n;
}

async function main() {
  const accounts: {
    accountId: string;
    companyId: string;
    granted: bigint;
    captured: bigint;
  }[] = [];
  for (let i = 0; i < ACCOUNTS; i++) {
    const a = await pool.query<{ id: string }>(
      `insert into accounts (auth_user_id, email, business_name, state_code) values (gen_random_uuid(), $1, 'Load Test Co', '27') returning id`,
      [`load-${randomUUID()}@example.test`],
    );
    const accountId = a.rows[0]?.id ?? "";
    await pool.query(
      `insert into wallets (account_id) values ($1) on conflict do nothing`,
      [accountId],
    );
    const c = await pool.query<{ id: string }>(
      `insert into companies (account_id, name) values ($1, 'Load Test Traders') returning id`,
      [accountId],
    );
    // Deliberately less than the cycles could spend, so some reservations are refused.
    const granted = BigInt(CYCLES * 10);
    await time("grant", () =>
      grantCredits(pool, {
        accountId,
        credits: granted,
        source: "admin_grant",
        idempotencyKey: randomUUID(),
      }),
    );
    accounts.push({ accountId, companyId: c.rows[0]?.id ?? "", granted, captured: 0n });
  }

  const work = accounts.flatMap((a) =>
    Array.from({ length: CYCLES }, (_, n) => ({ a, n })),
  );
  const started = performance.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const item = work[next++];
        if (item === undefined) return;
        // Await first, then add: `x += await y` reads x before the await and loses concurrent updates.
        const captured = await cycle(item.a.accountId, item.a.companyId, item.n);
        item.a.captured += captured;
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;

  const violations: string[] = [];
  for (const a of accounts) {
    const w = await pool.query<{ balance: string; held: string }>(
      `select balance_credits::text as balance, held_credits::text as held from wallets where account_id = $1`,
      [a.accountId],
    );
    const balance = BigInt(w.rows[0]?.balance ?? "-1");
    const held = BigInt(w.rows[0]?.held ?? "-1");
    const replay = replayLedger(a.accountId, await readLedger(pool, a.accountId));
    if (balance < 0n || held < 0n)
      violations.push(`${a.accountId}: negative balance or hold`);
    if (held !== 0n)
      violations.push(`${a.accountId}: ${held.toString()} credits still held`);
    if (replay.state.balance !== balance || replay.state.held !== held)
      violations.push(`${a.accountId}: ledger does not replay to wallet`);
    if (replay.brokenChainSeqs.length > 0)
      violations.push(`${a.accountId}: broken hash chain`);
    if (a.granted - a.captured !== balance)
      violations.push(`${a.accountId}: granted − captured ≠ balance`);
  }

  const report = {
    accounts: ACCOUNTS,
    cyclesPerAccount: CYCLES,
    concurrency: CONCURRENCY,
    seconds: Math.ceil(seconds * 10) / 10,
    cyclesPerSecond: Math.floor(work.length / seconds),
    latencyMs: Object.fromEntries(
      [...timings.entries()].map(([op, list]) => {
        const sorted = [...list].sort((x, y) => x - y);
        return [
          op,
          {
            n: sorted.length,
            p50: pct(sorted, 50),
            p95: pct(sorted, 95),
            p99: pct(sorted, 99),
          },
        ];
      }),
    ),
    violations,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (violations.length > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  await pool.end();
}
