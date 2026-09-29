/**
 * The browser that signed up (ADR 0071, R-85): the confirmation link signs in only the browser
 * holding the secret it was given; anywhere else the password chosen at sign-up is destroyed and
 * the mailbox owner finishes the account.
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  forgetSignupPassword,
  newSignupNonce,
  provisionAccount,
  refinishAccount,
  signupNonceMatches,
  signupProfileSchema,
  spendSignupNonce,
} from "../src/signup";

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

const profile = signupProfileSchema.parse({
  businessName: "Stranger's Choice Pvt Ltd",
  acceptTerms: true,
  acceptPrivacy: true,
});

async function signUpWith(hash: string | null): Promise<string> {
  const result = await provisionAccount(pool(), {
    authUserId: randomUUID(),
    email: `${randomUUID()}@example.test`,
    profile,
    ip: "203.0.113.5",
    signupNonceHash: hash,
  });
  if (result.status !== "created") throw new Error(`provision: ${result.status}`);
  return result.accountId;
}

const account = async (id: string) =>
  (
    await pool().query<{
      business_name: string;
      has_password: boolean;
      signup_nonce_hash: string | null;
    }>(
      `select business_name, has_password, signup_nonce_hash from accounts where id = $1`,
      [id],
    )
  ).rows[0];

describe("the secret given to the browser that signed up", () => {
  it("is a fresh random value each time, and only its hash is kept", async () => {
    const a = newSignupNonce();
    const b = newSignupNonce();
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/u);
    const id = await signUpWith(a.hash);
    expect((await account(id))?.signup_nonce_hash).toBe(a.hash);
    expect((await account(id))?.signup_nonce_hash).not.toContain(a.nonce);
  });

  it("matches only the browser that holds it", async () => {
    const browser = newSignupNonce();
    const id = await signUpWith(browser.hash);
    expect(await signupNonceMatches(pool(), id, browser.nonce)).toBe(true);
    expect(await signupNonceMatches(pool(), id, newSignupNonce().nonce)).toBe(false);
    expect(await signupNonceMatches(pool(), id, undefined)).toBe(false);
    expect(await signupNonceMatches(pool(), id, "")).toBe(false);
  });

  it("is worth nothing once spent, or on an account signed up before there were any", async () => {
    const browser = newSignupNonce();
    const id = await signUpWith(browser.hash);
    await spendSignupNonce(pool(), id);
    expect(await signupNonceMatches(pool(), id, browser.nonce)).toBe(false);
    const older = await signUpWith(null);
    expect(await signupNonceMatches(pool(), older, browser.nonce)).toBe(false);
  });
});

describe("a confirmation opened in another browser", () => {
  it("records the destroyed password, and the owner's own password and name at the finish", async () => {
    const id = await signUpWith(newSignupNonce().hash);
    await forgetSignupPassword(pool(), { accountId: id, ip: "198.51.100.9" });
    expect(await account(id)).toMatchObject({
      has_password: false,
      signup_nonce_hash: null,
    });
    const audit = await pool().query(
      `select 1 from audit_log where target_id = $1 and action = 'account.signup_password_destroyed'`,
      [id],
    );
    expect(audit.rowCount).toBe(1);

    expect(
      await refinishAccount(pool(), {
        accountId: id,
        businessName: "The Actual Owner & Co",
        ip: "198.51.100.9",
        hasPassword: true,
      }),
    ).toBe(true);
    expect(await account(id)).toMatchObject({
      business_name: "The Actual Owner & Co",
      has_password: true,
    });
    // Their consent, recorded against their own request, beside the stranger's.
    const consents = await pool().query<{ n: number }>(
      `select count(*)::int as n from consents where account_id = $1`,
      [id],
    );
    expect(consents.rows[0]?.n).toBe(4);
  });

  it("leaves a Google or Apple finish without a password, as before (ADR 0043)", async () => {
    const id = await signUpWith(newSignupNonce().hash);
    await refinishAccount(pool(), {
      accountId: id,
      businessName: "Provider Co",
      ip: null,
    });
    expect(await account(id)).toMatchObject({
      has_password: false,
      signup_nonce_hash: null,
    });
  });
});
