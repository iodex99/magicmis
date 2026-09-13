import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { consumeRateLimit } from "../src/ratelimit";
import { startTestDb, type TestDb } from "./harness";

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

describe("rate limits (SPEC §30)", () => {
  it("allows up to the configured limit per window, then refuses until the window resets", async () => {
    const pool = testDb().pool;
    const minute = Math.floor(Date.now() / 60_000) * 60_000 + 3_600_000;
    const now = new Date(minute + 10_000);
    const { rows } = await pool.query<{ value: { export_per_account: number } }>(
      `select value from public.app_config where key = 'ratelimit.limits' order by effective_from desc limit 1`,
    );
    const limit = rows[0]?.value.export_per_account ?? 0;
    expect(limit).toBeGreaterThan(0);

    for (let i = 1; i <= limit; i++) {
      const d = await consumeRateLimit(pool, "export_per_account", "acct-1", { now });
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(limit - i);
    }
    const refused = await consumeRateLimit(pool, "export_per_account", "acct-1", { now });
    expect(refused).toMatchObject({ allowed: false, remaining: 0, retryAfter: 50 });

    // Another subject has its own counter.
    expect(
      (await consumeRateLimit(pool, "export_per_account", "acct-2", { now })).allowed,
    ).toBe(true);

    const later = new Date(minute + 60_000);
    expect(
      (await consumeRateLimit(pool, "export_per_account", "acct-1", { now: later }))
        .allowed,
    ).toBe(true);
  });
});
