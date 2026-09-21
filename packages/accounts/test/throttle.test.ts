/**
 * The brute-force throttle under concurrency (ADR 0058).
 *
 * The check and the count used to be two statements with no lock between them, so a burst of
 * parallel attempts all read the same zero and all passed. With no second factor for customers
 * this throttle is the whole defence against a leaked password list, so the assertion that
 * matters is not "it locks" — it is "it locks at the limit even when nobody waits their turn".
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimAttempt,
  clearThrottle,
  releaseAttempt,
  throttleLimitFor,
  type ThrottleLimit,
} from "../src/throttle";

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

const attempts = async (key: string): Promise<number> =>
  (
    await pool().query<{ attempts: number }>(
      `select attempts from public.auth_throttle where key = $1`,
      [key],
    )
  ).rows[0]?.attempts ?? 0;

describe("claiming an attempt", () => {
  it("lets exactly the limit through when every attempt arrives at once", async () => {
    const key = `sign_in:ip:${randomUUID()}`;
    const limit = await throttleLimitFor(pool(), "sign_in");

    // Twenty times the limit, fired together. Read-then-write let all of them pass.
    const results = await Promise.all(
      Array.from({ length: limit.max_attempts * 20 }, () =>
        claimAttempt(pool(), [key], limit),
      ),
    );
    const allowed = results.filter((r) => !r.locked).length;
    expect(allowed).toBe(limit.max_attempts);
    expect(await attempts(key)).toBe(limit.max_attempts);
  });

  it("refuses the attempt after the limit, and counts nothing more", async () => {
    const key = `sign_in:ip:${randomUUID()}`;
    const limit: ThrottleLimit = {
      max_attempts: 3,
      window_seconds: 900,
      lockout_seconds: 900,
    };
    for (let i = 0; i < 3; i += 1)
      expect((await claimAttempt(pool(), [key], limit)).locked).toBe(false);

    const refused = await claimAttempt(pool(), [key], limit);
    expect(refused.locked).toBe(true);
    // A locked key does not keep counting, or an attacker could extend their own lockout
    // for ever and so could anyone else's.
    expect(await attempts(key)).toBe(3);
  });

  it("refuses without counting the other keys when one of them is locked", async () => {
    const ipKey = `sign_in:ip:${randomUUID()}`;
    const emailKey = `sign_in:email:${randomUUID()}`;
    const limit: ThrottleLimit = {
      max_attempts: 2,
      window_seconds: 900,
      lockout_seconds: 900,
    };
    await claimAttempt(pool(), [emailKey], limit);
    await claimAttempt(pool(), [emailKey], limit);

    // The email key is spent; the attempt is refused and the network's key is untouched.
    expect((await claimAttempt(pool(), [ipKey, emailKey], limit)).locked).toBe(true);
    expect(await attempts(ipKey)).toBe(0);
  });

  it("gives the attempt back on success, but does not wipe the network's count", async () => {
    // An office behind one address would otherwise lock its own network out by signing in,
    // and clearing the key outright would let one valid account zero the bucket for every
    // other account behind that address.
    const ipKey = `sign_in:ip:${randomUUID()}`;
    const emailKey = `sign_in:email:${randomUUID()}`;
    const limit: ThrottleLimit = {
      max_attempts: 5,
      window_seconds: 900,
      lockout_seconds: 900,
    };
    await claimAttempt(pool(), [ipKey], limit); // somebody else's failure
    await claimAttempt(pool(), [ipKey, emailKey], limit); // this person's attempt
    expect(await attempts(ipKey)).toBe(2);

    await clearThrottle(pool(), emailKey);
    await releaseAttempt(pool(), [ipKey]);
    expect(await attempts(emailKey)).toBe(0);
    expect(await attempts(ipKey), "somebody else's failure was wiped too").toBe(1);
  });

  it("starts a fresh window once the old one has passed", async () => {
    const key = `sign_in:ip:${randomUUID()}`;
    const limit: ThrottleLimit = {
      max_attempts: 2,
      window_seconds: 60,
      lockout_seconds: 60,
    };
    const start = new Date("2026-09-21T10:00:00Z");
    await claimAttempt(pool(), [key], limit, start);
    await claimAttempt(pool(), [key], limit, start);
    expect((await claimAttempt(pool(), [key], limit, start)).locked).toBe(true);

    const later = new Date(start.getTime() + 61_000);
    const after = await claimAttempt(pool(), [key], limit, later);
    expect(after.locked).toBe(false);
    expect(await attempts(key)).toBe(1);
  });
});
