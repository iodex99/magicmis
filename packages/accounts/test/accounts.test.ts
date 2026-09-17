/**
 * Accounts and security flows against real Postgres (SPEC §8, Phase 1).
 *
 * The identity provider is a recording fake. Everything this package decides -- who is
 * refused, what is recorded, when a key locks, whether a code is consumed -- runs for real.
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireAccount } from "../src/claims";
import { type AuthProvider } from "../src/provider";
import { hasFreshReauth, reauthenticate } from "../src/reauth";
import { claimSession } from "../src/session";
import { provisionAccount, signupProfileSchema } from "../src/signup";

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

class FakeProvider implements AuthProvider {
  password = "CorrectHorse42battery";
  signOutCalls = 0;
  failSignOut = false;

  verifyPassword(_email: string, password: string): Promise<boolean> {
    return Promise.resolve(password === this.password);
  }
  signOutOtherSessions(): Promise<void> {
    this.signOutCalls++;
    return this.failSignOut
      ? Promise.reject(new Error("provider down"))
      : Promise.resolve();
  }
}

const profile = signupProfileSchema.parse({
  businessName: "Iyer & Co Chartered Accountants",
  billingAddress: {
    line1: "4 Park Street",
    city: "Kolkata",
    country: "IN",
    postalCode: "700016",
    stateCode: "19",
  },
  acceptTerms: true,
  acceptPrivacy: true,
});

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const OTHER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0";

async function newAccount(email = `${randomUUID()}@example.test`) {
  const authUserId = randomUUID();
  const result = await provisionAccount(testDb().pool, {
    authUserId,
    email,
    profile,
    ip: "203.0.113.7",
  });
  if (result.status !== "created")
    throw new Error(`expected created, got ${result.status}`);
  return { authUserId, accountId: result.accountId, email };
}

const claimsFor = (authUserId: string, overrides: Record<string, unknown> = {}) => ({
  sub: authUserId,
  session_id: randomUUID(),
  aal: "aal2",
  ...overrides,
});

describe("provisioning", () => {
  it("creates the account, an empty wallet and both consent records", async () => {
    const { accountId } = await newAccount();
    const pool = testDb().pool;

    const wallet = await pool.query(
      `select balance_credits, held_credits from wallets where account_id = $1`,
      [accountId],
    );
    expect(wallet.rows[0]).toEqual({ balance_credits: "0", held_credits: "0" });

    const consents = await pool.query<{ document: string; version: string }>(
      `select document, version from consents where account_id = $1 order by document`,
      [accountId],
    );
    expect(consents.rows.map((r) => r.document)).toEqual(["privacy", "terms"]);
    expect(consents.rows[0]?.version).toBe("1.0-draft");
  });

  it("is idempotent on the auth user id", async () => {
    const authUserId = randomUUID();
    const email = `${randomUUID()}@example.test`;
    const pool = testDb().pool;
    const first = await provisionAccount(pool, { authUserId, email, profile, ip: null });
    const second = await provisionAccount(pool, { authUserId, email, profile, ip: null });
    expect(first.status).toBe("created");
    expect(second).toEqual({
      status: "already_provisioned",
      accountId: first.status === "created" ? first.accountId : "",
    });

    const consents = await pool.query(
      `select count(*)::int as n from consents c join accounts a on a.id = c.account_id where a.auth_user_id = $1`,
      [authUserId],
    );
    expect(consents.rows[0]).toEqual({ n: 2 });
  });

  it("reports an email held by another auth user without creating anything", async () => {
    const email = `${randomUUID()}@example.test`;
    await newAccount(email);
    const again = await provisionAccount(testDb().pool, {
      authUserId: randomUUID(),
      email: email.toUpperCase(),
      profile,
      ip: null,
    });
    expect(again).toEqual({ status: "email_taken" });
  });

  it("stores the GSTIN state as the state code when a GSTIN is given (SPEC §13)", async () => {
    const withGstin = signupProfileSchema.parse({ ...profile, gstin: "29AAGCB7383J1Z4" });
    const result = await provisionAccount(testDb().pool, {
      authUserId: randomUUID(),
      email: `${randomUUID()}@example.test`,
      profile: withGstin,
      ip: null,
    });
    if (result.status !== "created") throw new Error("expected created");
    const row = await testDb().pool.query(
      `select state_code, gstin from accounts where id = $1`,
      [result.accountId],
    );
    expect(row.rows[0]).toEqual({ state_code: "29", gstin: "29AAGCB7383J1Z4" });
  });
});

describe("single active session (SPEC §8)", () => {
  it("claims on the password step, which is the only factor (ADR 0028)", async () => {
    const { authUserId, accountId } = await newAccount();
    const provider = new FakeProvider();
    const result = await claimSession(
      testDb().pool,
      provider,
      claimsFor(authUserId, { aal: "aal1" }),
      { ip: null, userAgent: DESKTOP_UA },
    );
    expect(result).toMatchObject({ status: "claimed", accountId });
    expect(provider.signOutCalls).toBe(1);
  });

  it("a second login terminates the first", async () => {
    const { authUserId } = await newAccount();
    const provider = new FakeProvider();
    const pool = testDb().pool;
    const first = claimsFor(authUserId);
    const second = claimsFor(authUserId);

    await claimSession(pool, provider, first, { ip: null, userAgent: DESKTOP_UA });
    expect((await requireAccount(pool, first)).ok).toBe(true);

    await claimSession(pool, provider, second, { ip: null, userAgent: DESKTOP_UA });
    expect(await requireAccount(pool, first)).toEqual({
      ok: false,
      reason: "session_superseded",
    });
    expect((await requireAccount(pool, second)).ok).toBe(true);
    expect(provider.signOutCalls).toBe(2);
  });

  it("still cuts off the old session when provider revocation fails", async () => {
    const { authUserId } = await newAccount();
    const provider = new FakeProvider();
    const pool = testDb().pool;
    const first = claimsFor(authUserId);
    await claimSession(pool, provider, first, { ip: null, userAgent: DESKTOP_UA });

    provider.failSignOut = true;
    const second = claimsFor(authUserId);
    const result = await claimSession(pool, provider, second, {
      ip: null,
      userAgent: DESKTOP_UA,
    });
    expect(result).toMatchObject({ status: "claimed", otherSessionsRevoked: false });
    expect(await requireAccount(pool, first)).toEqual({
      ok: false,
      reason: "session_superseded",
    });
  });

  it("re-claiming the same session is a no-op", async () => {
    const { authUserId } = await newAccount();
    const provider = new FakeProvider();
    const claims = claimsFor(authUserId);
    await claimSession(testDb().pool, provider, claims, {
      ip: null,
      userAgent: DESKTOP_UA,
    });
    const again = await claimSession(testDb().pool, provider, claims, {
      ip: null,
      userAgent: DESKTOP_UA,
    });
    expect(again.status).toBe("already_active");
    expect(provider.signOutCalls).toBe(1);
  });

  it("alerts on a new device, but not on the first login or a returning device", async () => {
    const { authUserId, accountId } = await newAccount();
    const pool = testDb().pool;
    const provider = new FakeProvider();
    const login = (ua: string) =>
      claimSession(pool, provider, claimsFor(authUserId), { ip: null, userAgent: ua });

    expect(await login(DESKTOP_UA)).toMatchObject({ newDevice: false }); // first ever
    expect(await login(DESKTOP_UA)).toMatchObject({ newDevice: false }); // same device
    expect(await login(OTHER_UA)).toMatchObject({ newDevice: true }); // new device

    const notices = await pool.query<{ type: string }>(
      `select type from notifications where account_id = $1`,
      [accountId],
    );
    expect(notices.rows.map((r) => r.type)).toEqual(["security.new_device_login"]);
  });

  it("records login and session-revoked events", async () => {
    const { authUserId, accountId } = await newAccount();
    const provider = new FakeProvider();
    await claimSession(testDb().pool, provider, claimsFor(authUserId), {
      ip: "198.51.100.4",
      userAgent: DESKTOP_UA,
    });
    await claimSession(testDb().pool, provider, claimsFor(authUserId), {
      ip: "198.51.100.4",
      userAgent: DESKTOP_UA,
    });
    const events = await testDb().pool.query<{ event_type: string }>(
      `select event_type from login_events where account_id = $1 order by created_at, id`,
      [accountId],
    );
    expect(events.rows.map((r) => r.event_type).sort()).toEqual([
      "login",
      "login",
      "session_revoked",
    ]);
  });
});

describe("requireAccount decision table", () => {
  it("names each refusal distinctly", async () => {
    const pool = testDb().pool;
    expect(await requireAccount(pool, { sub: "not-a-uuid" })).toEqual({
      ok: false,
      reason: "invalid_claims",
    });
    expect(await requireAccount(pool, claimsFor(randomUUID()))).toEqual({
      ok: false,
      reason: "no_account",
    });

    const { authUserId, accountId } = await newAccount();
    // An aal1 token is an ordinary token now, so it gets the same answer as any other.
    expect(await requireAccount(pool, claimsFor(authUserId, { aal: "aal1" }))).toEqual({
      ok: false,
      reason: "session_not_claimed",
    });
    expect(await requireAccount(pool, claimsFor(authUserId))).toEqual({
      ok: false,
      reason: "session_not_claimed",
    });

    await pool.query(`update accounts set status = 'suspended' where id = $1`, [
      accountId,
    ]);
    expect(await requireAccount(pool, claimsFor(authUserId))).toEqual({
      ok: false,
      reason: "account_not_active",
    });
  });
});

describe("re-authentication gates (SPEC §8)", () => {
  async function signedIn() {
    const { authUserId } = await newAccount();
    const provider = new FakeProvider();
    const claims = claimsFor(authUserId);
    await claimSession(testDb().pool, provider, claims, {
      ip: null,
      userAgent: DESKTOP_UA,
    });
    const decision = await requireAccount(testDb().pool, claims);
    if (!decision.ok) throw new Error(decision.reason);
    return { provider, account: decision.account };
  }

  it("grants a session-bound window for the right password only", async () => {
    const { provider, account } = await signedIn();
    const pool = testDb().pool;

    expect(await hasFreshReauth(pool, account)).toBe(false);
    expect(
      (await reauthenticate(pool, provider, account, { password: "wrong", ip: null }))
        .status,
    ).toBe("invalid_credentials");
    expect(await hasFreshReauth(pool, account)).toBe(false);

    const granted = await reauthenticate(pool, provider, account, {
      password: provider.password,
      ip: null,
    });
    expect(granted.status).toBe("granted");
    expect(await hasFreshReauth(pool, account)).toBe(true);

    // Another session of the same account does not inherit the grant.
    expect(await hasFreshReauth(pool, { ...account, sessionId: randomUUID() })).toBe(
      false,
    );
  });

  it("expires the grant after the configured TTL", async () => {
    const { provider, account } = await signedIn();
    const now = new Date();
    await reauthenticate(
      testDb().pool,
      provider,
      account,
      { password: provider.password, ip: null },
      now,
    );
    const ttl = 600_000; // seeded auth.reauth_ttl_seconds
    expect(
      await hasFreshReauth(testDb().pool, account, new Date(now.getTime() + ttl - 1000)),
    ).toBe(true);
    expect(
      await hasFreshReauth(testDb().pool, account, new Date(now.getTime() + ttl + 1000)),
    ).toBe(false);
  });

  it("locks after the configured failures, then refuses even correct credentials", async () => {
    const { provider, account } = await signedIn();
    const pool = testDb().pool;
    let last;
    for (let i = 0; i < 5; i++) {
      last = await reauthenticate(pool, provider, account, {
        password: "wrong",
        ip: null,
      });
    }
    expect(last?.status).toBe("locked");
    const correct = await reauthenticate(pool, provider, account, {
      password: provider.password,
      ip: null,
    });
    expect(correct.status).toBe("locked");
  });
});
