import { randomBytes, randomUUID } from "node:crypto";

import { PRODUCT_NAME } from "@magicmis/core/brand";
import { LocalKeyWrapper } from "@magicmis/crypto";
import { verifyAuditChain } from "@magicmis/db/audit";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { priceFor } from "@magicmis/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { accountDetail, searchAccounts, setAccountStatus } from "../src/server/accounts";
import {
  createPack,
  listPriceBook,
  publishPriceBookVersion,
  setPackActive,
} from "../src/server/catalog";
import { loadAdminEnv } from "../src/server/env";
import {
  createAdmin,
  parseAllowlist,
  resolveSession,
  signIn,
  signOut,
} from "../src/server/identity";
import { hashPassword, verifyPassword } from "../src/server/password";
import {
  base32Decode,
  base32Encode,
  hotp,
  timeStep,
  verifyTotp,
} from "../src/server/totp";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
function pool() {
  if (db === undefined) throw new Error("test database was not started");
  return db.pool;
}

const wrapper = new LocalKeyWrapper(randomBytes(32));
const PASSWORD = "correct-horse-battery-staple";
const codeAt = (secret: string, at: Date) => hotp(base32Decode(secret), timeStep(at));

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC 6238 Appendix B SHA-1 vectors (truncated to 6 digits)", () => {
    // Secret "12345678901234567890" (ASCII). RFC values are 8 digits; the last 6 are ours.
    const secret = Buffer.from("12345678901234567890");
    const vectors: [number, string][] = [
      [59, "94287082"],
      [1_111_111_109, "07081804"],
      [1_111_111_111, "14050471"],
      [1_234_567_890, "89005924"],
      [2_000_000_000, "69279037"],
    ];
    for (const [t, expected] of vectors) {
      expect(hotp(secret, BigInt(Math.floor(t / 30)))).toBe(expected.slice(-6));
    }
  });

  it("round-trips base32 and refuses replays and far-skewed codes", () => {
    const bytes = randomBytes(20);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    const secret = base32Encode(bytes);
    const now = new Date("2027-02-01T10:00:15Z");
    const code = codeAt(secret, now);
    const step = verifyTotp(secret, code, now, 0n);
    expect(step).toBe(timeStep(now));
    expect(verifyTotp(secret, code, now, step ?? 0n)).toBeNull(); // replay
    expect(
      verifyTotp(secret, codeAt(secret, new Date(now.getTime() - 30_000)), now, 0n),
    ).not.toBeNull(); // one step skew
    expect(
      verifyTotp(secret, codeAt(secret, new Date(now.getTime() - 90_000)), now, 0n),
    ).toBeNull();
    expect(verifyTotp(secret, "12345", now, 0n)).toBeNull();
  });
});

describe("passwords (scrypt)", () => {
  it("verifies the right password only, and refuses short ones", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^scrypt\$131072\$8\$1\$/u);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}!`, hash)).toBe(false);
    expect(await verifyPassword(PASSWORD, "garbage")).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow(RangeError);
  });
});

describe("admin identity (SPEC §26)", () => {
  const email = "ops@example.test";
  const allowlist = parseAllowlist(`${email}, other@example.test`);

  it("signs in with allowlisted email + password + TOTP, stores the TOTP secret encrypted, and expires sessions", async () => {
    const created = await createAdmin(pool(), wrapper, {
      email: "OPS@example.test",
      password: PASSWORD,
      allowlist,
      issuer: `${PRODUCT_NAME} Admin`,
    });
    expect(created.otpauthUri).toMatch(
      new RegExp(
        `^otpauth://totp/${encodeURIComponent(`${PRODUCT_NAME} Admin`)}%3Aops%40example\\.test\\?secret=`,
        "u",
      ),
    );

    // The issuer the app reads back must be the issuer the label names (ADR 0060). This was
    // built with `URLSearchParams`, which writes form encoding — a space becomes `+` — so an
    // authenticator percent-decoding the query got "Magic+MIS+Admin" while the label said
    // "Magic MIS Admin", and one that checks the two agree refuses the enrolment. The default
    // issuer has a space in it, so this was every admin enrolled the documented way. The old
    // assertion above only ever looked at the label, which is why it went unseen.
    const uri = new URL(created.otpauthUri);
    expect(uri.searchParams.get("issuer")).toBe(`${PRODUCT_NAME} Admin`);
    expect(decodeURIComponent(uri.pathname.slice(1)).split(":")[0]).toBe(
      uri.searchParams.get("issuer"),
    );
    // A literal plus in the query is the form-encoding tell.
    expect(created.otpauthUri.split("?")[1] ?? "").not.toContain("+");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
    // And the secret survives the round trip, since it is what the codes are computed from.
    expect(uri.searchParams.get("secret")).toBe(created.totpSecret);

    const stored = await pool().query<{ totp_secret_enc: Buffer }>(
      `select totp_secret_enc from admin_users where id = $1`,
      [created.adminId],
    );
    expect(stored.rows[0]?.totp_secret_enc.toString("utf8")).not.toContain(
      created.totpSecret,
    );

    const now = new Date(Date.now() + 5_000);
    const base = {
      email,
      password: PASSWORD,
      allowlist,
      ipAllowlist: null,
      ip: "10.0.0.1",
      userAgent: "test",
    };

    expect(await signIn(pool(), wrapper, { ...base, code: "000000", now })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
    expect(
      await signIn(pool(), wrapper, {
        ...base,
        password: "wrong-password-123",
        code: codeAt(created.totpSecret, now),
        now,
      }),
    ).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });

    const code = codeAt(created.totpSecret, now);
    const ok = await signIn(pool(), wrapper, { ...base, code, now });
    if (!ok.ok) throw new Error(`sign-in failed: ${ok.reason}`);
    // The same code cannot be used again.
    expect((await signIn(pool(), wrapper, { ...base, code, now })).ok).toBe(false);

    expect(await resolveSession(pool(), ok.token, now)).toMatchObject({
      adminId: created.adminId,
      email,
    });
    const stored2 = await pool().query<{ token_hash: string }>(
      `select token_hash from admin_sessions where admin_id = $1`,
      [created.adminId],
    );
    expect(stored2.rows[0]?.token_hash).not.toBe(ok.token);

    // Idle timeout (30 min in config) and absolute expiry (8 h).
    expect(
      await resolveSession(pool(), ok.token, new Date(now.getTime() + 31 * 60_000)),
    ).toBeNull();

    // A fresh session, then sign-out revokes it.
    const later = new Date(now.getTime() + 60_000);
    const again = await signIn(pool(), wrapper, {
      ...base,
      code: codeAt(created.totpSecret, later),
      now: later,
    });
    if (!again.ok) throw new Error("second sign-in failed");
    expect(await resolveSession(pool(), again.token, later)).not.toBeNull();
    await signOut(pool(), again.token, later);
    expect(await resolveSession(pool(), again.token, later)).toBeNull();
    expect(await resolveSession(pool(), "not-a-token", later)).toBeNull();
  });

  it("refuses emails not on the allowlist even with valid credentials, and IPs outside an IP allowlist", async () => {
    const e = "other@example.test";
    const created = await createAdmin(pool(), wrapper, {
      email: e,
      password: PASSWORD,
      allowlist,
      issuer: "x",
    });
    const now = new Date(Date.now() + 5_000);
    const input = {
      email: e,
      password: PASSWORD,
      code: codeAt(created.totpSecret, now),
      userAgent: "t",
      now,
    };
    expect(
      (
        await signIn(pool(), wrapper, {
          ...input,
          allowlist: parseAllowlist("ops@example.test"),
          ipAllowlist: null,
          ip: null,
        })
      ).ok,
    ).toBe(false);
    expect(
      await signIn(pool(), wrapper, {
        ...input,
        allowlist,
        ipAllowlist: new Set(["10.9.9.9"]),
        ip: "10.0.0.1",
      }),
    ).toEqual({ ok: false, reason: "ip_not_allowed" });
    await expect(
      createAdmin(pool(), wrapper, {
        email: "intruder@example.test",
        password: PASSWORD,
        allowlist,
        issuer: "x",
      }),
    ).rejects.toThrow(/ADMIN_ALLOWED_EMAILS/u);
  });

  it("locks out after repeated failures", async () => {
    const e = "lock@example.test";
    const list = parseAllowlist(e);
    const created = await createAdmin(pool(), wrapper, {
      email: e,
      password: PASSWORD,
      allowlist: list,
      issuer: "x",
    });
    const now = new Date(Date.now() + 5_000);
    const base = {
      email: e,
      allowlist: list,
      ipAllowlist: null,
      ip: null,
      userAgent: "t",
      now,
    };
    for (let i = 0; i < 5; i += 1)
      await signIn(pool(), wrapper, {
        ...base,
        password: "wrong-password-xyz",
        code: "000000",
      });
    expect(
      await signIn(pool(), wrapper, {
        ...base,
        password: PASSWORD,
        code: codeAt(created.totpSecret, now),
      }),
    ).toEqual({
      ok: false,
      reason: "locked_out",
    });
  });
});

describe("catalog administration", () => {
  it("publishes a new price book version that takes effect only from its date, and audits it", async () => {
    const adminId = randomUUID();
    const now = new Date(Date.now() + 1_000);
    const future = new Date(now.getTime() + 86_400_000);
    const { version } = await publishPriceBookVersion(pool(), {
      adminId,
      now,
      version: {
        actionKey: "monthly_refresh",
        baseCredits: 349n,
        efficient: "0.8",
        professional: "1.0",
        expert: "2.5",
        instantSurchargeCredits: 0n,
        maxAiCostRatio: "0.2",
        reservationMode: "fixed",
        priceFromActionKey: null,
        enabled: true,
        effectiveFrom: future,
      },
    });
    expect(version).toBe(2);
    expect(
      (
        await priceFor(pool(), {
          actionKey: "monthly_refresh",
          tier: "professional",
          delivery: "standard",
          at: now,
        })
      ).credits,
    ).toBe(299n);
    expect(
      (
        await priceFor(pool(), {
          actionKey: "monthly_refresh",
          tier: "professional",
          delivery: "standard",
          at: new Date(future.getTime() + 1),
        })
      ).credits,
    ).toBe(349n);
    const rows = (await listPriceBook(pool(), now)).filter(
      (r) => r.actionKey === "monthly_refresh",
    );
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [2, "scheduled"],
      [1, "in_effect"],
    ]);

    await expect(
      publishPriceBookVersion(pool(), {
        adminId,
        now,
        version: {
          actionKey: "monthly_refresh",
          baseCredits: 1n,
          efficient: "1",
          professional: "1",
          expert: "1",
          instantSurchargeCredits: 0n,
          maxAiCostRatio: "0.2",
          reservationMode: "fixed",
          priceFromActionKey: null,
          enabled: true,
          effectiveFrom: new Date(now.getTime() - 3_600_000),
        },
      }),
    ).rejects.toThrow(/past/u);

    const audit = await pool().query<{ action: string }>(
      `select action from audit_log where actor_id = $1`,
      [adminId],
    );
    expect(audit.rows.map((a) => a.action)).toEqual([
      "pricing.price_book_version_published",
    ]);
  });

  it("creates and deactivates packs with audit", async () => {
    const adminId = randomUUID();
    const id = await createPack(pool(), {
      adminId,
      pack: {
        name: "Partner",
        priceInrMinor: 7_500_000n,
        priceUsdMinor: 89_900n,
        credits: 75_000n,
        bonusCredits: 9_000n,
        sortOrder: 7,
      },
    });
    await setPackActive(pool(), { adminId, packId: id, active: false });
    const r = await pool().query<{ active: boolean; name: string | null }>(
      `select active, name from credit_packs where id = $1`,
      [id],
    );
    expect(r.rows[0]).toEqual({ active: false, name: "Partner" });
    await expect(
      setPackActive(pool(), { adminId, packId: randomUUID(), active: true }),
    ).rejects.toThrow(/not found/u);
  });
});

describe("account administration", () => {
  it("searches, shows detail, suspends with a reason and ends the customer session", async () => {
    const r = await pool().query<{ id: string }>(
      `insert into accounts (auth_user_id, email, business_name, state_code, billing_country, active_session_id)
       values (gen_random_uuid(), 'findme@example.test', 'Findable 100% Traders', '27', 'IN', gen_random_uuid()) returning id`,
    );
    const accountId = r.rows[0]?.id ?? "";
    expect((await searchAccounts(pool(), "findme")).map((a) => a.id)).toContain(
      accountId,
    );
    expect((await searchAccounts(pool(), "100%")).map((a) => a.id)).toEqual([accountId]);
    expect((await accountDetail(pool(), accountId))?.account.business_name).toBe(
      "Findable 100% Traders",
    );

    const adminId = randomUUID();
    await expect(
      setAccountStatus(pool(), { adminId, accountId, status: "suspended", reason: "" }),
    ).rejects.toThrow(/reason/u);
    await setAccountStatus(pool(), {
      adminId,
      accountId,
      status: "suspended",
      reason: "chargeback investigation",
    });
    const after = await pool().query<{
      status: string;
      active_session_id: string | null;
    }>(`select status, active_session_id from accounts where id = $1`, [accountId]);
    expect(after.rows[0]).toEqual({ status: "suspended", active_session_id: null });
  });

  it("keeps the audit chain intact across all admin activity", async () => {
    expect((await verifyAuditChain(pool())).ok).toBe(true);
  });
});

describe("admin env", () => {
  it("refuses the local key wrapper in production and requires KMS settings otherwise", () => {
    const base = {
      DATABASE_URL: "postgres://x",
      ADMIN_ALLOWED_EMAILS: "a@example.test",
      APP_ENVIRONMENT: "development",
    };
    expect(() =>
      loadAdminEnv({
        ...base,
        APP_ENVIRONMENT: "production",
        KEY_WRAPPER: "local",
        LOCAL_MASTER_KEY: randomBytes(32).toString("base64"),
      }),
    ).toThrow(/KEY_WRAPPER/u);
    expect(() => loadAdminEnv({ ...base, KEY_WRAPPER: "kms" })).toThrow(
      /KMS_MASTER_KEY_ID/u,
    );
    expect(
      loadAdminEnv({
        ...base,
        KEY_WRAPPER: "local",
        LOCAL_MASTER_KEY: randomBytes(32).toString("base64"),
      }).KEY_WRAPPER,
    ).toBe("local");
  });
});
