/**
 * Welcome credits (ADR 0068): one decision per account and one grant per mailbox, the grant it
 * carries, what withholds it for good and what only defers it. The grant is ledger logic, so it is
 * also asserted under concurrency and against a replay of the hash-chained ledger.
 */

import { randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { readLedger, replayLedger } from "@magicmis/wallet";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  decideWelcomeCredits,
  isBlockedEmail,
  mailboxDigest,
  mailboxOf,
  networkOf,
  welcomeCreditsOffered,
  welcomeNetworkKey,
} from "../src/welcome";

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

async function newAccount(email = `${randomUUID()}@example.test`): Promise<string> {
  const r = await pool().query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code)
     values (gen_random_uuid(), $1, 'Welcome Test Co', '27') returning id`,
    [email],
  );
  const id = r.rows[0]?.id;
  if (id === undefined) throw new Error("account insert failed");
  return id;
}

/** A fresh documentation-range address, so each test counts against its own network. */
const freshIp = (): string =>
  `203.0.${String(Math.floor(Math.random() * 250) + 1)}.${String(Math.floor(Math.random() * 250) + 1)}`;

async function clearNetwork(ip: string): Promise<void> {
  await pool().query(`delete from auth_throttle where key = $1`, [welcomeNetworkKey(ip)]);
}

async function publishConfig(key: string, value: unknown): Promise<void> {
  await pool().query(
    `insert into app_config (key, value, version)
     select $1, $2::jsonb, coalesce(max(version), 0) + 1 from app_config where key = $1`,
    [key, JSON.stringify(value)],
  );
}

const balance = async (accountId: string): Promise<bigint> => {
  const r = await pool().query<{ balance_credits: string }>(
    `select balance_credits::text from wallets where account_id = $1`,
    [accountId],
  );
  return BigInt(r.rows[0]?.balance_credits ?? "0");
};

const lots = async (accountId: string) =>
  (
    await pool().query<{ source: string; credits_granted: string }>(
      `select source, credits_granted::text from credit_lots where account_id = $1`,
      [accountId],
    )
  ).rows;

const audit = async (accountId: string) =>
  (
    await pool().query<{ action: string; metadata: Record<string, unknown> }>(
      `select action, metadata from audit_log where target_id = $1 and action like 'wallet.welcome%'`,
      [accountId],
    )
  ).rows;

const decisionRow = async (accountId: string) =>
  (
    await pool().query<{ outcome: string; reason: string | null }>(
      `select outcome, reason from welcome_credits where account_id = $1`,
      [accountId],
    )
  ).rows[0];

describe("the network an address is counted under", () => {
  it("keeps an IPv4 address whole and folds IPv6 to its /64", () => {
    expect(networkOf("203.0.113.9")).toBe("203.0.113.9");
    expect(networkOf("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(networkOf("2001:db8:ab:cd:1:2:3:4")).toBe("2001:db8:ab:cd::/64");
    expect(networkOf("2001:0DB8:00ab:00cd::9")).toBe("2001:db8:ab:cd::/64");
    expect(networkOf("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(networkOf(null)).toBeNull();
    expect(networkOf("  ")).toBeNull();
  });

  it("puts every address inside one /64 on the same network", () => {
    const group = fc.integer({ min: 0, max: 0xffff }).map((n) => n.toString(16));
    fc.assert(
      fc.property(
        fc.array(group, { minLength: 4, maxLength: 4 }),
        fc.array(group, { minLength: 4, maxLength: 4 }),
        fc.array(group, { minLength: 4, maxLength: 4 }),
        (prefix, a, b) =>
          welcomeNetworkKey([...prefix, ...a].join(":")) ===
          welcomeNetworkKey([...prefix, ...b].join(":")),
      ),
    );
  });

  it("keeps no address in the clear in the throttle key", () => {
    expect(welcomeNetworkKey("203.0.113.9")).toMatch(/^welcome:network:[0-9a-f]{64}$/u);
    expect(welcomeNetworkKey("203.0.113.9")).not.toContain("203.0.113.9");
  });
});

describe("the mailbox an address reaches", () => {
  it("drops a +tag, and for Gmail the dots and googlemail.com", () => {
    expect(mailboxOf("Name+clients@GMail.com")).toBe("name@gmail.com");
    expect(mailboxOf("n.a.m.e@googlemail.com")).toBe("name@gmail.com");
    expect(mailboxOf("first.last+x@firm.example")).toBe("first.last@firm.example");
    expect(mailboxOf("ops@firm.example.")).toBe("ops@firm.example");
  });
  it("fingerprints one mailbox once, however it is spelled", () => {
    expect(mailboxDigest("p.q+1@gmail.com")).toBe(mailboxDigest("PQ+2@googlemail.com"));
    expect(mailboxDigest("pq@gmail.com")).not.toBe(mailboxDigest("pq@firm.example"));
    expect(mailboxDigest("pq@gmail.com")).not.toContain("pq");
  });
});

describe("throwaway addresses", () => {
  const blocked = ["mailinator.com", "yopmail.com"];
  it("matches the domain and any subdomain of it, in any case", () => {
    expect(isBlockedEmail("a@mailinator.com", blocked)).toBe(true);
    expect(isBlockedEmail("a@MAILINATOR.COM", blocked)).toBe(true);
    expect(isBlockedEmail("a@eu.yopmail.com", blocked)).toBe(true);
    expect(isBlockedEmail("a@mailinator.com.", blocked)).toBe(true);
  });
  it("leaves a lookalike alone, and ignores an empty entry", () => {
    expect(isBlockedEmail("a@notmailinator.com", blocked)).toBe(false);
    expect(isBlockedEmail("a@mailinator.com.in", blocked)).toBe(false);
    expect(isBlockedEmail("a@example.test", ["", " "])).toBe(false);
  });
});

describe("decideWelcomeCredits", () => {
  it("is offered at 1,500 credits as seeded", async () => {
    expect(await welcomeCreditsOffered(pool())).toBe(1500n);
  });

  it("grants the offer once, as a welcome lot on the ledger, and only reads afterwards", async () => {
    const accountId = await newAccount();
    const ip = freshIp();
    const first = await decideWelcomeCredits(pool(), { accountId, ip });
    expect(first).toMatchObject({ status: "granted", credits: 1500n });

    expect(await balance(accountId)).toBe(1500n);
    expect(await lots(accountId)).toEqual([
      { source: "welcome", credits_granted: "1500" },
    ]);
    expect(await audit(accountId)).toEqual([
      { action: "wallet.welcome_granted", metadata: { credits: "1500" } },
    ]);

    const again = await decideWelcomeCredits(pool(), { accountId, ip });
    expect(again).toEqual({ status: "already_decided", outcome: "granted" });
    expect(await balance(accountId)).toBe(1500n);

    const replay = replayLedger(accountId, await readLedger(pool(), accountId));
    expect(replay.brokenChainSeqs).toEqual([]);
    expect(replay.inconsistentSeqs).toEqual([]);
    expect(replay.state.balance).toBe(1500n);

    const decision = await pool().query<{
      outcome: string;
      credits: string;
      lot: boolean;
      digest: boolean;
    }>(
      `select outcome, credits::text, lot_id is not null as lot, mailbox_digest is not null as digest
         from welcome_credits where account_id = $1`,
      [accountId],
    );
    expect(decision.rows).toEqual([
      { outcome: "granted", credits: "1500", lot: true, digest: true },
    ]);
  });

  it("grants exactly once however many first sign-ins race, and spends one network attempt", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 6 }), async (racers) => {
        const accountId = await newAccount();
        const ip = freshIp();
        await clearNetwork(ip);
        const results = await Promise.all(
          Array.from({ length: racers }, () =>
            decideWelcomeCredits(pool(), { accountId, ip }),
          ),
        );
        expect(results.filter((r) => r.status === "granted")).toHaveLength(1);
        expect(await lots(accountId)).toHaveLength(1);
        expect(await balance(accountId)).toBe(1500n);
        const replay = replayLedger(accountId, await readLedger(pool(), accountId));
        expect(replay.brokenChainSeqs).toEqual([]);
        const attempts = await pool().query<{ attempts: number }>(
          `select attempts from auth_throttle where key = $1`,
          [welcomeNetworkKey(ip)],
        );
        expect(attempts.rows[0]?.attempts).toBe(1);
      }),
      { numRuns: 6 },
    );
  });

  it("withholds it from a throwaway address without counting the network", async () => {
    const ip = freshIp();
    await clearNetwork(ip);
    for (const email of [
      `${randomUUID()}@mailinator.com`,
      `${randomUUID()}@eu.yopmail.com`,
    ]) {
      const accountId = await newAccount(email);
      expect(await decideWelcomeCredits(pool(), { accountId, ip })).toEqual({
        status: "withheld",
        reason: "disposable_email",
      });
      expect(await balance(accountId)).toBe(0n);
      expect(await audit(accountId)).toEqual([
        { action: "wallet.welcome_withheld", metadata: { reason: "disposable_email" } },
      ]);
    }
    const attempts = await pool().query(`select 1 from auth_throttle where key = $1`, [
      welcomeNetworkKey(ip),
    ]);
    expect(attempts.rowCount).toBe(0);
  });

  it("grants one mailbox once, however it is spelled and even after the account is deleted", async () => {
    const local = `p.q${randomUUID().slice(0, 6)}`;
    const first = await newAccount(`${local}+one@gmail.com`);
    expect(
      await decideWelcomeCredits(pool(), { accountId: first, ip: freshIp() }),
    ).toMatchObject({ status: "granted" });
    // The same inbox under another spelling, from another network.
    const alias = await newAccount(`${local.replaceAll(".", "")}+two@googlemail.com`);
    expect(
      await decideWelcomeCredits(pool(), { accountId: alias, ip: freshIp() }),
    ).toEqual({
      status: "withheld",
      reason: "mailbox_already_granted",
    });
    expect(await balance(alias)).toBe(0n);
    // Deleted and purged: the address on the account is overwritten, the fingerprint remains.
    await pool().query(
      `update accounts set email = $2, deleted_at = now(), status = 'deleted' where id = $1`,
      [first, `purged-${first}@invalid`],
    );
    const again = await newAccount(`${local}+one@gmail.com`);
    expect(
      await decideWelcomeCredits(pool(), { accountId: again, ip: freshIp() }),
    ).toEqual({
      status: "withheld",
      reason: "mailbox_already_granted",
    });
  });

  it("grants one of two aliases of one inbox racing each other", async () => {
    const local = `race${randomUUID().slice(0, 6)}`;
    const a = await newAccount(`${local}+a@gmail.com`);
    const b = await newAccount(`${local}+b@gmail.com`);
    const results = await Promise.all([
      decideWelcomeCredits(pool(), { accountId: a, ip: freshIp() }),
      decideWelcomeCredits(pool(), { accountId: b, ip: freshIp() }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["granted", "withheld"]);
    expect((await balance(a)) + (await balance(b))).toBe(1500n);
  });

  it("defers a fourth account on one network a month, and decides it again from elsewhere", async () => {
    const ip = freshIp();
    await clearNetwork(ip);
    const outcomes = [];
    for (let i = 0; i < 3; i++) {
      outcomes.push(
        await decideWelcomeCredits(pool(), { accountId: await newAccount(), ip }),
      );
    }
    expect(outcomes.map((o) => o.status)).toEqual(["granted", "granted", "granted"]);

    // The fourth is not refused: nothing is recorded, nothing counted, nothing granted yet.
    const fourth = await newAccount();
    expect(await decideWelcomeCredits(pool(), { accountId: fourth, ip })).toEqual({
      status: "deferred",
      reason: "network_limit",
    });
    expect(await decisionRow(fourth)).toBeUndefined();
    expect(await balance(fourth)).toBe(0n);
    expect(await audit(fourth)).toEqual([]);
    // Signing in again from the same crowded network still waits...
    expect(await decideWelcomeCredits(pool(), { accountId: fourth, ip })).toMatchObject({
      status: "deferred",
    });
    // ...and from home it is decided, and granted.
    expect(
      await decideWelcomeCredits(pool(), { accountId: fourth, ip: freshIp() }),
    ).toMatchObject({ status: "granted" });

    // Another address in the same IPv6 /64 is the same network; a different one is not.
    const v6 = "2001:db8:77:1";
    await clearNetwork(`${v6}::1`);
    for (let i = 1; i <= 3; i++)
      await decideWelcomeCredits(pool(), {
        accountId: await newAccount(),
        ip: `${v6}::${String(i)}`,
      });
    expect(
      await decideWelcomeCredits(pool(), {
        accountId: await newAccount(),
        ip: `${v6}:9:9:9:9`,
      }),
    ).toEqual({ status: "deferred", reason: "network_limit" });
  });

  it("the month is counted from the first grant, and a new month grants again", async () => {
    const ip = freshIp();
    await clearNetwork(ip);
    const start = new Date("2026-10-01T00:00:00Z");
    for (let i = 0; i < 3; i++)
      await decideWelcomeCredits(pool(), {
        accountId: await newAccount(),
        ip,
        now: start,
      });
    const later = new Date(start.getTime() + 31 * 86_400_000);
    expect(
      await decideWelcomeCredits(pool(), {
        accountId: await newAccount(),
        ip,
        now: later,
      }),
    ).toMatchObject({ status: "granted" });
  });

  it("stops granting across the whole platform past the daily cap, and waits", async () => {
    const throttle = await pool().query<{ value: Record<string, unknown> }>(
      `select value from app_config where key = 'auth.throttle' order by version desc limit 1`,
    );
    const original = throttle.rows[0]?.value ?? {};
    await pool().query(`delete from auth_throttle where key = 'welcome:global'`);
    await publishConfig("auth.throttle", {
      ...original,
      welcome_global: { max_attempts: 2, window_seconds: 86400, lockout_seconds: 86400 },
    });
    try {
      const statuses = [];
      for (let i = 0; i < 3; i++)
        statuses.push(
          (
            await decideWelcomeCredits(pool(), {
              accountId: await newAccount(),
              ip: freshIp(),
            })
          ).status,
        );
      expect(statuses).toEqual(["granted", "granted", "deferred"]);
    } finally {
      await publishConfig("auth.throttle", original);
      await pool().query(`delete from auth_throttle where key = 'welcome:global'`);
    }
  });

  it("records an account that existed before the offer as decided, and grants it nothing", async () => {
    const accountId = await newAccount();
    // What migration 0064 wrote for every account that existed when it ran.
    await pool().query(
      `insert into welcome_credits (account_id, outcome, reason, credits)
       values ($1, 'withheld', 'existing_account', 0)`,
      [accountId],
    );
    expect(await decideWelcomeCredits(pool(), { accountId, ip: freshIp() })).toEqual({
      status: "already_decided",
      outcome: "withheld",
    });
    expect(await balance(accountId)).toBe(0n);
  });

  it("grants nothing while the offer is switched off, and the decision stands after", async () => {
    await publishConfig("wallet.welcome_credits", 0);
    try {
      const accountId = await newAccount();
      expect(await decideWelcomeCredits(pool(), { accountId, ip: freshIp() })).toEqual({
        status: "withheld",
        reason: "offer_off",
      });
      await publishConfig("wallet.welcome_credits", 1500);
      expect(await decideWelcomeCredits(pool(), { accountId, ip: freshIp() })).toEqual({
        status: "already_decided",
        outcome: "withheld",
      });
      expect(await balance(accountId)).toBe(0n);
    } finally {
      await publishConfig("wallet.welcome_credits", 1500);
    }
  });

  it("refuses a decision row that contradicts itself, or a second grant to one mailbox", async () => {
    const accountId = await newAccount();
    await expect(
      pool().query(
        `insert into welcome_credits (account_id, outcome, reason, credits) values ($1, 'granted', 'offer_off', 1500)`,
        [accountId],
      ),
    ).rejects.toThrow(/welcome_credits_reason_iff_withheld/u);
    await expect(
      pool().query(
        `insert into welcome_credits (account_id, outcome, credits) values ($1, 'granted', 0)`,
        [accountId],
      ),
    ).rejects.toThrow(/welcome_credits_granted_has_credits/u);
    const digest = mailboxDigest(`${randomUUID()}@example.test`);
    await pool().query(
      `insert into welcome_credits (account_id, outcome, credits, mailbox_digest) values ($1, 'granted', 1500, $2)`,
      [accountId, digest],
    );
    await expect(
      pool().query(
        `insert into welcome_credits (account_id, outcome, credits, mailbox_digest) values ($1, 'granted', 1500, $2)`,
        [await newAccount(), digest],
      ),
    ).rejects.toThrow(/welcome_credits_one_grant_per_mailbox/u);
  });
});

describe("the fingerprint the server supplies", () => {
  it("is the one kept with the decision, so a keyed fingerprint is never replaced by the unkeyed one", async () => {
    const accountId = await newAccount();
    const seen: string[] = [];
    await decideWelcomeCredits(pool(), {
      accountId,
      ip: freshIp(),
      fingerprint: (mailbox) => {
        seen.push(mailbox);
        return `keyed-${mailbox.length.toString()}-${accountId}`;
      },
    });
    const row = await pool().query<{ d: string }>(
      `select mailbox_digest as d from welcome_credits where account_id = $1`,
      [accountId],
    );
    expect(row.rows[0]?.d).toBe(
      `keyed-${(seen[0] ?? "").length.toString()}-${accountId}`,
    );
    // It is handed the normalised mailbox, never the raw address.
    expect(seen[0]).toMatch(/^[^+]+@example\.test$/u);
  });
});
