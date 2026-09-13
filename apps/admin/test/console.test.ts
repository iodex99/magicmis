/**
 * Admin console completion (SPEC §26) against real Postgres: routing and registry versions,
 * config edits that keep their shape, the jobs inspector without content, library curation, and
 * break-glass — a written reason, a time limit, a notice to the account holder, an audit entry for
 * every view, and no decrypted data without an active grant.
 */

import { randomBytes, randomUUID } from "node:crypto";

import { LocalKeyWrapper } from "@magicmis/crypto";
import { verifyAuditChain } from "@magicmis/db/audit";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { storeSnapshot } from "@magicmis/engine/server";
import { confirmJob, createJob } from "@magicmis/jobs";
import { grantCredits } from "@magicmis/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  activeGrants,
  breakGlassView,
  decideCandidate,
  grantBreakGlass,
  jobDetail,
  listConfig,
  listRouting,
  publishConfig,
  publishModel,
  publishRoute,
  revokeBreakGlass,
} from "../src/server/console";
import { createAdmin } from "../src/server/identity";
import { emptySnapshot } from "../../../packages/jobs/test/helpers";

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

async function admin(): Promise<string> {
  const email = `${randomUUID()}@admin.example.test`;
  const a = await createAdmin(pool(), wrapper, {
    email,
    password: "correct-horse-battery-staple",
    allowlist: new Set([email]),
    issuer: "Test",
  });
  return a.adminId;
}

async function customer() {
  const a = await pool().query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code) values (gen_random_uuid(), $1, 'Console Co', '27') returning id`,
    [`${randomUUID()}@example.test`],
  );
  const accountId = a.rows[0]?.id ?? "";
  await pool().query(`insert into wallets (account_id) values ($1)`, [accountId]);
  const c = await pool().query<{ id: string }>(
    `insert into companies (account_id, name) values ($1, 'Synthetic Traders') returning id`,
    [accountId],
  );
  return { accountId, companyId: c.rows[0]?.id ?? "" };
}

describe("routing and registry", () => {
  it("publishes a new routing version that keeps the active prompt, and refuses unknown models", async () => {
    const adminId = await admin();
    await pool().query(
      `update tier_routing set prompt_version = 3 where tier = 'efficient' and stage = 'commentary'`,
    );
    const r = await publishRoute(pool(), {
      adminId,
      ip: null,
      route: {
        tier: "efficient",
        stage: "commentary",
        modelId: "claude-sonnet-5",
        effort: "low",
        maxTokens: 6000,
        fallbackChain: [],
      },
    });
    const row = (await listRouting(pool())).find(
      (x) => x.tier === "efficient" && x.stage === "commentary",
    );
    expect(row).toMatchObject({
      version: r.version,
      max_tokens: 6000,
      effort: "low",
      prompt_version: 3,
    });
    await expect(
      publishRoute(pool(), {
        adminId,
        ip: null,
        route: {
          tier: "efficient",
          stage: "commentary",
          modelId: "gpt-9",
          effort: null,
          maxTokens: 1000,
          fallbackChain: [],
        },
      }),
    ).rejects.toThrow(/not in the registry/u);
  });

  it("re-verifies model prices as a new registry version", async () => {
    const adminId = await admin();
    const r = await publishModel(pool(), {
      adminId,
      ip: null,
      model: {
        modelId: "claude-haiku-4-5-20251001",
        inputPricePerMTokMicroUsd: 1_000_000n,
        outputPricePerMTokMicroUsd: 5_000_000n,
        available: true,
        sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
      },
    });
    const latest = await pool().query<{ version: number; verified_at: Date }>(
      `select version, verified_at from model_registry where model_id = 'claude-haiku-4-5-20251001' order by version desc limit 1`,
    );
    expect(latest.rows[0]?.version).toBe(r.version);
    expect(Date.now() - (latest.rows[0]?.verified_at.getTime() ?? 0)).toBeLessThan(
      60_000,
    );
  });
});

describe("config editor", () => {
  it("publishes a new version with the same shape and refuses shape changes and locked keys", async () => {
    const adminId = await admin();
    const r = await publishConfig(pool(), {
      adminId,
      ip: null,
      key: "chat.max_rounds",
      valueJson: "4",
    });
    expect(
      (await listConfig(pool())).find((c) => c.key === "chat.max_rounds"),
    ).toMatchObject({ value: 4, version: r.version });
    await expect(
      publishConfig(pool(), {
        adminId,
        ip: null,
        key: "chat.max_rounds",
        valueJson: '"four"',
      }),
    ).rejects.toThrow(/stay a number/u);
    await expect(
      publishConfig(pool(), {
        adminId,
        ip: null,
        key: "ratelimit.limits",
        valueJson: '{"ai_per_account": 1}',
      }),
    ).rejects.toThrow(/same fields/u);
    await expect(
      publishConfig(pool(), { adminId, ip: null, key: "unknown.key", valueJson: "1" }),
    ).rejects.toThrow(/not editable/u);
    await publishConfig(pool(), {
      adminId,
      ip: null,
      key: "chat.max_rounds",
      valueJson: "5",
    });
  });
});

describe("jobs inspector", () => {
  it("shows the state timeline, AI calls and ledger, and only the names of checkpoint keys", async () => {
    const c = await customer();
    await grantCredits(pool(), {
      accountId: c.accountId,
      credits: 5_000n,
      source: "admin_grant",
      idempotencyKey: randomUUID(),
    });
    const job = await createJob(pool(), {
      ...c,
      type: "dashboard_addon",
      tier: "professional",
      delivery: "standard",
      idempotencyKey: randomUUID(),
      size: {
        files: 0,
        sheets: 0,
        columns: 0,
        rows: 0,
        distinctLedgerValues: 0,
        referenceMisSheets: 0,
      },
    });
    await confirmJob(pool(), { accountId: c.accountId, jobId: job.jobId });
    const detail = await jobDetail(pool(), job.jobId);
    expect(detail?.history.map((h) => h.state)).toEqual(["reserved"]);
    expect(detail?.history[0]?.from).toBe("estimated");
    expect(detail?.ledger.map((l) => l.entry_type)).toEqual(["reserve"]);
    expect(detail?.job.checkpointKeys).toContain("state_history");
    expect(JSON.stringify(detail)).not.toContain('source_fingerprints":{');
  });
});

describe("library curation", () => {
  it("approves a candidate into the library, attributed to the admin, once", async () => {
    const adminId = await admin();
    const head = await pool().query<{ id: string }>(
      `select id from mis_heads where code = 'OPEX'`,
    );
    const cand = await pool().query<{ id: string }>(
      `insert into library_candidates (normalized_name, proposed_mis_head_id, distinct_account_count) values ('courier charges', $1, 7) returning id`,
      [head.rows[0]?.id],
    );
    const id = cand.rows[0]?.id ?? "";
    await decideCandidate(pool(), {
      adminId,
      ip: null,
      candidateId: id,
      decision: "approved",
    });
    const entry = await pool().query(
      `select source, promoted_by_admin_id, tenant_count from global_mapping_library where normalized_name = 'courier charges'`,
    );
    expect(entry.rows[0]).toEqual({
      source: "promoted",
      promoted_by_admin_id: adminId,
      tenant_count: 7,
    });
    await expect(
      decideCandidate(pool(), {
        adminId,
        ip: null,
        candidateId: id,
        decision: "rejected",
      }),
    ).rejects.toThrow(/already decided/u);
  });
});

describe("break-glass", () => {
  it("needs a reason and a bounded time, notifies the holder, audits every view, and ends on revoke", async () => {
    const adminId = await admin();
    const other = await admin();
    const c = await customer();
    const snap = emptySnapshot("2026-05");
    await storeSnapshot(pool(), wrapper, {
      ...c,
      jobId: null,
      payload: {
        ...snap,
        metricStore: {
          ...snap.metricStore,
          values: [
            {
              metricId: "revenue",
              period: snap.period,
              dims: {},
              value: "100",
              nullReason: null,
              unit: "paise",
              formula: "",
              inputs: [],
            },
          ],
        },
      },
    });

    await expect(
      grantBreakGlass(pool(), {
        adminId,
        ip: null,
        accountId: c.accountId,
        reason: "help",
        minutes: 10,
      }),
    ).rejects.toThrow(/at least 20 characters/u);
    await expect(
      grantBreakGlass(pool(), {
        adminId,
        ip: null,
        accountId: c.accountId,
        reason: "Customer asked us to check a mapping",
        minutes: 600,
      }),
    ).rejects.toThrow(/between 1 and 60 minutes/u);

    const { grantId } = await grantBreakGlass(pool(), {
      adminId,
      ip: "10.0.0.1",
      accountId: c.accountId,
      reason: "Customer asked us to check a mapping",
      minutes: 15,
    });
    const notice = await pool().query(
      `select type from notifications where account_id = $1 and type = 'security.break_glass'`,
      [c.accountId],
    );
    expect(notice.rowCount).toBe(1);
    expect(await activeGrants(pool(), c.accountId)).toHaveLength(1);

    const view = await breakGlassView(pool(), wrapper, {
      adminId,
      ip: null,
      grantId,
      companyId: c.companyId,
    });
    expect(view.period).toBe("2026-05");
    expect(view.values.map((v) => v.metricId)).toContain("revenue");
    // Another admin cannot use this grant; nothing is viewable after it expires or is revoked.
    await expect(
      breakGlassView(pool(), wrapper, {
        adminId: other,
        ip: null,
        grantId,
        companyId: c.companyId,
      }),
    ).rejects.toThrow(/active break-glass grant/u);
    await expect(
      breakGlassView(pool(), wrapper, {
        adminId,
        ip: null,
        grantId,
        companyId: c.companyId,
        now: new Date(Date.now() + 16 * 60_000),
      }),
    ).rejects.toThrow(/active break-glass grant/u);
    await revokeBreakGlass(pool(), { adminId, ip: null, grantId });
    await expect(
      breakGlassView(pool(), wrapper, {
        adminId,
        ip: null,
        grantId,
        companyId: c.companyId,
      }),
    ).rejects.toThrow(/active break-glass grant/u);

    const audit = await pool().query<{ action: string }>(
      `select action from audit_log where target_id = $1 or metadata->>'grantId' = $2 order by seq`,
      [c.accountId, grantId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "admin.break_glass_granted",
      "admin.break_glass_viewed",
      "admin.break_glass_revoked",
    ]);
    expect((await verifyAuditChain(pool())).ok).toBe(true);
  });
});
