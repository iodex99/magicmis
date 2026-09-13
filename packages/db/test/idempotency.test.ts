import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  abandonIdempotent,
  beginIdempotent,
  completeIdempotent,
  requestHash,
} from "../src/idempotency";
import { startTestDb, type TestDb } from "./harness";

// Undefined until beforeAll completes, and stays undefined if it throws.
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

let counter = 0;
const freshKey = () => `test-key-${String(++counter)}-${String(Date.now())}`;

describe("idempotency keys (SPEC §4)", () => {
  it("lets the first request through and replays its stored response", async () => {
    const pool = testDb().pool;
    const key = freshKey();
    const hash = requestHash({ amount: 100 });

    expect(await beginIdempotent(pool, "account:a", key, hash)).toEqual({ state: "new" });
    await completeIdempotent(pool, "account:a", key, { status: 201, body: { id: "x" } });
    expect(await beginIdempotent(pool, "account:a", key, hash)).toEqual({
      state: "replay",
      status: 201,
      body: { id: "x" },
    });
  });

  it("rejects the same key with a different body", async () => {
    const pool = testDb().pool;
    const key = freshKey();
    await beginIdempotent(pool, "account:a", key, requestHash({ amount: 100 }));
    expect(
      await beginIdempotent(pool, "account:a", key, requestHash({ amount: 999 })),
    ).toEqual({
      state: "conflict",
    });
  });

  it("scopes keys, so one account cannot collide with another", async () => {
    const pool = testDb().pool;
    const key = freshKey();
    const hash = requestHash({ n: 1 });
    expect((await beginIdempotent(pool, "account:a", key, hash)).state).toBe("new");
    expect((await beginIdempotent(pool, "account:b", key, hash)).state).toBe("new");
  });

  it("gives exactly one of many concurrent first requests the right to run", async () => {
    const pool = testDb().pool;
    const key = freshKey();
    const hash = requestHash({ n: 1 });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => beginIdempotent(pool, "account:c", key, hash)),
    );
    expect(results.filter((r) => r.state === "new")).toHaveLength(1);
    expect(results.filter((r) => r.state === "in_progress")).toHaveLength(19);
  });

  it("never stores a response that carries a secret, and refuses to replay it", async () => {
    const pool = testDb().pool;
    const key = freshKey();
    const hash = requestHash({ action: "issue_backup_codes" });
    await beginIdempotent(pool, "account:d", key, hash);
    await completeIdempotent(pool, "account:d", key, {
      status: 200,
      body: { codes: ["ABCD-EFGH"] },
      containsSecret: true,
    });

    const stored = await pool.query<{ response_body: unknown; body_stored: boolean }>(
      `select response_body, body_stored from idempotency_keys where scope = 'account:d' and key = $1`,
      [key],
    );
    expect(stored.rows[0]).toEqual({ response_body: null, body_stored: false });
    expect(await beginIdempotent(pool, "account:d", key, hash)).toEqual({
      state: "replay_refused",
    });
  });

  it("allows a retry after an abandoned claim goes stale", async () => {
    const pool = testDb().pool;
    const key = freshKey();
    const hash = requestHash({ n: 1 });
    const start = new Date("2026-09-13T10:00:00Z");
    expect((await beginIdempotent(pool, "account:e", key, hash, start)).state).toBe(
      "new",
    );

    const soon = new Date(start.getTime() + 60_000);
    expect((await beginIdempotent(pool, "account:e", key, hash, soon)).state).toBe(
      "in_progress",
    );

    const later = new Date(start.getTime() + 121_000); // seeded stale threshold: 120s
    expect((await beginIdempotent(pool, "account:e", key, hash, later)).state).toBe(
      "new",
    );
  });

  it("releases a claim explicitly when the work failed", async () => {
    const pool = testDb().pool;
    const key = freshKey();
    const hash = requestHash({ n: 1 });
    await beginIdempotent(pool, "account:f", key, hash);
    await abandonIdempotent(pool, "account:f", key);
    expect((await beginIdempotent(pool, "account:f", key, hash)).state).toBe("new");
  });
});
