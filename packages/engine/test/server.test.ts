/**
 * Company memory storage against real Postgres: encrypted, versioned, hash-chained, never
 * overwritten, and unreadable after crypto-shredding (SPEC §9, §10, §20).
 */

import { randomBytes, randomUUID } from "node:crypto";

import { LocalKeyWrapper } from "@magicmis/crypto";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ENGINE_VERSION } from "../src/compute";
import {
  CompanyKeyDestroyed,
  BlueprintConflict,
  latestBlueprint,
  latestSnapshot,
  loadAccountRules,
  saveAccountRules,
  storeBlueprint,
  storeSnapshot,
  verifyBlueprintChain,
} from "../src/server";
import type { SnapshotPayload } from "../src/snapshot";

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
const wrapper = LocalKeyWrapper.fromBase64(randomBytes(32).toString("base64"));

async function company(): Promise<{ accountId: string; companyId: string }> {
  const a = await pool().query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code) values (gen_random_uuid(), $1, 'Memory Co', '27') returning id`,
    [`${randomUUID()}@example.test`],
  );
  const accountId = a.rows[0]?.id ?? "";
  const c = await pool().query<{ id: string }>(
    `insert into companies (account_id, name) values ($1, 'Synthetic Co') returning id`,
    [accountId],
  );
  return { accountId, companyId: c.rows[0]?.id ?? "" };
}

const snapshot = (closing: string): SnapshotPayload => ({
  schemaVersion: 1,
  period: "2025-04",
  engineVersion: ENGINE_VERSION,
  sourceFingerprint: "fp-1",
  ledgerBalances: [
    {
      ledgerKey: "sundry debtors > party_abc",
      head: "CA_RECEIVABLES",
      period: "2025-04",
      closing,
      movement: null,
    },
  ],
  metricStore: {
    engineVersion: ENGINE_VERSION,
    computedAt: "2026-09-13T00:00:00.000Z",
    values: [],
  },
  validationResults: [
    {
      id: "V3",
      status: "pass",
      severity: "blocking",
      failureClass: "data_fault",
      amounts: { difference: "0" },
    },
  ],
});

describe("snapshots", () => {
  it("stores encrypted new versions, never overwrites, and reads the latest", async () => {
    const { accountId, companyId } = await company();
    const first = await storeSnapshot(pool(), wrapper, {
      accountId,
      companyId,
      jobId: null,
      payload: snapshot("100"),
    });
    const second = await storeSnapshot(pool(), wrapper, {
      accountId,
      companyId,
      jobId: null,
      payload: snapshot("250"),
    });
    expect([first.version, second.version]).toEqual([1, 2]);

    const raw = await pool().query<{ ledger_balances: Buffer }>(
      `select ledger_balances from snapshots where id = $1`,
      [first.snapshotId],
    );
    expect(raw.rows[0]?.ledger_balances.toString("utf8")).not.toContain("party_abc");

    const latest = await latestSnapshot(pool(), wrapper, {
      accountId,
      companyId,
      period: "2025-04",
    });
    expect(latest?.version).toBe(2);
    expect(latest?.ledgerBalances[0]?.closing).toBe("250");

    await expect(
      pool().query(`update snapshots set version = 9 where id = $1`, [first.snapshotId]),
    ).rejects.toThrow();
  });

  it("refuses another account's company and a moved ciphertext", async () => {
    const one = await company();
    const two = await company();
    await storeSnapshot(pool(), wrapper, { ...one, jobId: null, payload: snapshot("1") });
    await expect(
      latestSnapshot(pool(), wrapper, {
        accountId: two.accountId,
        companyId: one.companyId,
        period: "2025-04",
      }),
    ).resolves.toBeNull();
    await storeSnapshot(pool(), wrapper, { ...two, jobId: null, payload: snapshot("2") });
    // Copy company one's ciphertext into company two's row: its context no longer matches.
    await pool().query(`alter table snapshots disable trigger snapshots_append_only`);
    try {
      await pool().query(
        `update snapshots set ledger_balances = (select ledger_balances from snapshots where company_id = $1 limit 1) where company_id = $2`,
        [one.companyId, two.companyId],
      );
    } finally {
      await pool().query(`alter table snapshots enable trigger snapshots_append_only`);
    }
    await expect(
      latestSnapshot(pool(), wrapper, { ...two, period: "2025-04" }),
    ).rejects.toThrow(/Decryption failed/u);
  });

  it("is unreadable after the company key is destroyed", async () => {
    const c = await company();
    await storeSnapshot(pool(), wrapper, { ...c, jobId: null, payload: snapshot("5") });
    await pool().query(
      `update company_keys set wrapped_dek = null, destroyed_at = now() where company_id = $1`,
      [c.companyId],
    );
    await expect(
      latestSnapshot(pool(), wrapper, { ...c, period: "2025-04" }),
    ).rejects.toBeInstanceOf(CompanyKeyDestroyed);
    await expect(
      storeSnapshot(pool(), wrapper, { ...c, jobId: null, payload: snapshot("6") }),
    ).rejects.toBeInstanceOf(CompanyKeyDestroyed);
  });
});

describe("blueprints", () => {
  it("versions, hash-chains and round-trips every part; tampering breaks the chain", async () => {
    const c = await company();
    const parts = (v: number) => ({
      templateSpec: { template: "monthly_financial_mis", v },
      recipe: { schemaVersion: 1, v },
      mappingRules: {
        schemaVersion: 1,
        headsVersion: 1,
        rules: [{ ledgerKey: "k", head: "OPEX_RENT" }],
        acceptedUnmapped: [],
      },
      dashboardSpec: null,
      materiality: { pct: "0.05" },
      sourceFingerprints: { tb: "sig-1" },
    });
    const v1 = await storeBlueprint(pool(), wrapper, {
      ...c,
      jobId: null,
      parts: parts(1),
      basedOn: null,
    });
    const v2 = await storeBlueprint(pool(), wrapper, {
      ...c,
      jobId: null,
      parts: parts(2),
      basedOn: 1,
    });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(await verifyBlueprintChain(pool(), wrapper, c)).toEqual({
      ok: true,
      checked: 2,
    });
    const latest = await latestBlueprint(pool(), wrapper, c);
    expect(latest).toMatchObject({
      version: 2,
      parts: { recipe: { v: 2 }, dashboardSpec: null },
    });

    await pool().query(`alter table blueprints disable trigger blueprints_append_only`);
    try {
      await pool().query(
        `update blueprints set materiality = '{"pct":"0.50"}' where company_id = $1 and version = 1`,
        [c.companyId],
      );
    } finally {
      await pool().query(`alter table blueprints enable trigger blueprints_append_only`);
    }
    expect(await verifyBlueprintChain(pool(), wrapper, c)).toEqual({
      ok: false,
      version: 1,
    });
  });
});

describe("a blueprint write made from a version that is no longer the latest", () => {
  const parts = (name: string) => ({
    templateSpec: { name },
    recipe: { schemaVersion: 1 },
    mappingRules: { schemaVersion: 1, headsVersion: 1, rules: [], acceptedUnmapped: [] },
    dashboardSpec: null,
    materiality: {},
    sourceFingerprints: {},
  });

  it("is refused, so parts copied from an older version never go back over a newer one", async () => {
    const c = await company();
    await storeBlueprint(pool(), wrapper, {
      ...c,
      jobId: null,
      parts: parts("first"),
      basedOn: null,
    });
    // A rename lands as version 2 while something else still holds version 1.
    await storeBlueprint(pool(), wrapper, {
      ...c,
      jobId: null,
      parts: parts("renamed"),
      basedOn: 1,
    });
    await expect(
      storeBlueprint(pool(), wrapper, {
        ...c,
        jobId: null,
        parts: parts("first"),
        basedOn: 1,
      }),
    ).rejects.toBeInstanceOf(BlueprintConflict);
    // Nor may a writer that found nothing create a first version over one that now exists.
    await expect(
      storeBlueprint(pool(), wrapper, {
        ...c,
        jobId: null,
        parts: parts("first"),
        basedOn: null,
      }),
    ).rejects.toBeInstanceOf(BlueprintConflict);
    expect(await latestBlueprint(pool(), wrapper, c)).toMatchObject({
      version: 2,
      parts: { templateSpec: { name: "renamed" } },
    });
    expect(await verifyBlueprintChain(pool(), wrapper, c)).toEqual({
      ok: true,
      checked: 2,
    });
  });

  it("lets exactly one of several simultaneous writers through", async () => {
    const c = await company();
    await storeBlueprint(pool(), wrapper, {
      ...c,
      jobId: null,
      parts: parts("first"),
      basedOn: null,
    });
    const results = await Promise.allSettled(
      ["a", "b", "c", "d", "e"].map((name) =>
        storeBlueprint(pool(), wrapper, {
          ...c,
          jobId: null,
          parts: parts(name),
          basedOn: 1,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results)
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(BlueprintConflict);
    expect((await latestBlueprint(pool(), wrapper, c))?.version).toBe(2);
    expect(await verifyBlueprintChain(pool(), wrapper, c)).toEqual({
      ok: true,
      checked: 2,
    });
  });

  it("keeps one company's versions out of another's", async () => {
    const a = await company();
    const b = await company();
    await storeBlueprint(pool(), wrapper, {
      ...a,
      jobId: null,
      parts: parts("a"),
      basedOn: null,
    });
    // Company B has nothing yet, whatever version A is at.
    const first = await storeBlueprint(pool(), wrapper, {
      ...b,
      jobId: null,
      parts: parts("b"),
      basedOn: null,
    });
    expect(first.version).toBe(1);
    expect((await latestBlueprint(pool(), wrapper, a))?.parts.templateSpec).toEqual({
      name: "a",
    });
    expect((await latestBlueprint(pool(), wrapper, b))?.parts.templateSpec).toEqual({
      name: "b",
    });
  });
});

describe("account rules", () => {
  it("stores patterns encrypted, replaces a pattern, and reads back only for the account", async () => {
    const c = await company();
    await saveAccountRules(pool(), wrapper, {
      accountId: c.accountId,
      companyId: c.companyId,
      rules: [
        { pattern: "godown rent", head: "OPEX_RENT" },
        { pattern: "staff tea", head: "EMP_WELFARE" },
      ],
    });
    await saveAccountRules(pool(), wrapper, {
      accountId: c.accountId,
      companyId: null,
      rules: [{ pattern: "godown rent", head: "COGS_DIRECT" }],
    });
    const rules = await loadAccountRules(pool(), wrapper, c.accountId);
    expect(rules.map((r) => [r.pattern, r.head]).sort()).toEqual([
      ["godown rent", "COGS_DIRECT"],
      ["staff tea", "EMP_WELFARE"],
    ]);
    const raw = await pool().query<{ normalized_pattern: Buffer }>(
      `select normalized_pattern from account_mapping_rules where account_id = $1`,
      [c.accountId],
    );
    expect(
      raw.rows.every((r) => !r.normalized_pattern.toString("utf8").includes("rent")),
    ).toBe(true);
    const other = await company();
    expect(await loadAccountRules(pool(), wrapper, other.accountId)).toEqual([]);
  });
});
