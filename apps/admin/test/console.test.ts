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
  approveBreakGlass,
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
import { base32Decode, hotp, timeStep } from "../src/server/totp";
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
  /**
   * Each step-up code is single-use, so the test walks a timeline one TOTP period at a
   * time. The timeline is anchored to the clock at the moment of the call, not to one
   * captured when this file was loaded: under a loaded `pnpm -r test` the file can start
   * minutes after that, leaving every fabricated timestamp behind the real clock and the
   * "fresh code" check refusing a code the test believes is current.
   */
  let tick = 0;
  const next = () => new Date(Date.now() + (tick++ + 1) * 31_000);
  const codeAt = (secret: string, at: Date) => hotp(base32Decode(secret), timeStep(at));

  async function adminWithSecret(): Promise<{
    adminId: string;
    secret: string;
  }> {
    const email = `${randomUUID()}@admin.example.test`;
    const a = await createAdmin(pool(), wrapper, {
      email,
      password: "correct-horse-battery-staple",
      allowlist: new Set([email]),
      issuer: "Test",
    });
    return { adminId: a.adminId, secret: a.totpSecret };
  }

  async function withRevenue(c: { accountId: string; companyId: string }) {
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
  }

  it("needs a reason, a bounded time and a fresh code; is scoped to one company; notifies, audits every view, ends on revoke", async () => {
    const { adminId, secret } = await adminWithSecret();
    const other = await adminWithSecret();
    const c = await customer();
    await withRevenue(c);
    const second = await pool().query<{ id: string }>(
      `insert into companies (account_id, name) values ($1, 'Second Co') returning id`,
      [c.accountId],
    );
    const base = {
      adminId,
      ip: null,
      accountId: c.accountId,
      companyId: c.companyId,
      reason: "Customer asked us to check a mapping",
      minutes: 15,
    };

    const at = next();
    await expect(
      grantBreakGlass(pool(), wrapper, {
        ...base,
        reason: "help",
        code: codeAt(secret, at),
        now: at,
      }),
    ).rejects.toThrow(/at least 20 characters/u);
    await expect(
      grantBreakGlass(pool(), wrapper, {
        ...base,
        minutes: 600,
        code: codeAt(secret, at),
        now: at,
      }),
    ).rejects.toThrow(/between 1 and 60 minutes/u);
    // A reason the customer notice cannot carry would leave the grant unannounced: refused.
    await expect(
      grantBreakGlass(pool(), wrapper, {
        ...base,
        reason: "x".repeat(501),
        code: codeAt(secret, at),
        now: at,
      }),
    ).rejects.toThrow(/500 characters/u);
    // Step-up: a wrong code, or another admin's code, is refused.
    await expect(
      grantBreakGlass(pool(), wrapper, { ...base, code: "000000", now: at }),
    ).rejects.toThrow(/authenticator code/u);
    await expect(
      grantBreakGlass(pool(), wrapper, {
        ...base,
        code: codeAt(other.secret, at),
        now: at,
      }),
    ).rejects.toThrow(/authenticator code/u);
    const purged = await pool().query<{ id: string; company: string }>(
      `with a as (insert into accounts (auth_user_id, email, business_name, state_code, status, purged_at)
         values (gen_random_uuid(), $1, 'Deleted account', '27', 'deleted', now()) returning id)
       insert into companies (account_id, name) select id, 'Gone Co' from a returning account_id as id, id as company`,
      [`purged-${String(Date.now())}@invalid`],
    );
    await expect(
      grantBreakGlass(pool(), wrapper, {
        ...base,
        accountId: purged.rows[0]?.id ?? "",
        companyId: purged.rows[0]?.company ?? "",
        code: codeAt(secret, at),
        now: at,
      }),
    ).rejects.toThrow(/purged/u);

    const { grantId, pending } = await grantBreakGlass(pool(), wrapper, {
      ...base,
      ip: "10.0.0.1",
      code: codeAt(secret, at),
      now: at,
    });
    expect(pending).toBe(false);
    // The same code cannot be used twice.
    await expect(
      grantBreakGlass(pool(), wrapper, {
        ...base,
        code: codeAt(secret, at),
        now: at,
      }),
    ).rejects.toThrow(/authenticator code/u);
    const notice = await pool().query(
      `select type from notifications where account_id = $1 and type = 'security.break_glass'`,
      [c.accountId],
    );
    expect(notice.rowCount).toBe(1);
    expect(await activeGrants(pool(), c.accountId, at)).toHaveLength(1);

    const view = await breakGlassView(pool(), wrapper, {
      adminId,
      ip: null,
      grantId,
      companyId: c.companyId,
      now: at,
    });
    expect(view.period).toBe("2026-05");
    expect(view.values.map((v) => v.metricId)).toContain("revenue");
    // Viewing again the same day sends no second customer notice.
    await breakGlassView(pool(), wrapper, {
      adminId,
      ip: null,
      grantId,
      companyId: c.companyId,
      now: at,
    });
    const viewed = await pool().query(
      `select 1 from notifications where account_id = $1 and type = 'security.break_glass_viewed'`,
      [c.accountId],
    );
    expect(viewed.rowCount).toBe(1);

    // Scoped: the grant does not open the account's other company.
    await expect(
      breakGlassView(pool(), wrapper, {
        adminId,
        ip: null,
        grantId,
        companyId: second.rows[0]?.id ?? "",
        now: at,
      }),
    ).rejects.toThrow(/active break-glass grant/u);
    // Another admin cannot use this grant; nothing is viewable after it expires or is revoked.
    await expect(
      breakGlassView(pool(), wrapper, {
        adminId: other.adminId,
        ip: null,
        grantId,
        companyId: c.companyId,
        now: at,
      }),
    ).rejects.toThrow(/active break-glass grant/u);
    await expect(
      breakGlassView(pool(), wrapper, {
        adminId,
        ip: null,
        grantId,
        companyId: c.companyId,
        now: new Date(at.getTime() + 16 * 60_000),
      }),
    ).rejects.toThrow(/active break-glass grant/u);
    await revokeBreakGlass(pool(), { adminId, ip: null, grantId });
    await expect(
      breakGlassView(pool(), wrapper, {
        adminId,
        ip: null,
        grantId,
        companyId: c.companyId,
        now: at,
      }),
    ).rejects.toThrow(/active break-glass grant/u);

    const audit = await pool().query<{ action: string }>(
      `select action from audit_log where metadata->>'grantId' = $1 order by seq`,
      [grantId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "admin.break_glass_granted",
      "admin.break_glass_viewed",
      "admin.break_glass_viewed",
      "admin.break_glass_revoked",
    ]);
    expect((await verifyAuditChain(pool())).ok).toBe(true);
  });

  it("with the two-admin rule on, access waits for a different admin's approval and its clock starts then", async () => {
    const requester = await adminWithSecret();
    const approver = await adminWithSecret();
    const c = await customer();
    await withRevenue(c);
    const cfg = await pool().query<{ version: number }>(
      `insert into app_config (key, value, version, effective_from)
       select 'admin.break_glass_second_admin', 'true'::jsonb, coalesce(max(version), 0) + 1, now() - interval '1 second'
       from app_config where key = 'admin.break_glass_second_admin' returning version`,
    );
    try {
      const at = next();
      const { grantId, pending, expiresAt } = await grantBreakGlass(pool(), wrapper, {
        adminId: requester.adminId,
        ip: null,
        accountId: c.accountId,
        companyId: c.companyId,
        reason: "Customer asked us to check a mapping",
        minutes: 10,
        code: codeAt(requester.secret, at),
        now: at,
      });
      expect(pending).toBe(true);
      expect(expiresAt).toBeNull();
      // Pending: not viewable, no customer notice yet.
      await expect(
        breakGlassView(pool(), wrapper, {
          adminId: requester.adminId,
          ip: null,
          grantId,
          companyId: c.companyId,
          now: at,
        }),
      ).rejects.toThrow(/active break-glass grant/u);
      const early = await pool().query(
        `select 1 from notifications where account_id = $1 and type = 'security.break_glass'`,
        [c.accountId],
      );
      expect(early.rowCount).toBe(0);

      const later = next();
      await expect(
        approveBreakGlass(pool(), wrapper, {
          adminId: requester.adminId,
          ip: null,
          grantId,
          code: codeAt(requester.secret, later),
          now: later,
        }),
      ).rejects.toThrow(/different admin/u);
      const approved = await approveBreakGlass(pool(), wrapper, {
        adminId: approver.adminId,
        ip: null,
        grantId,
        code: codeAt(approver.secret, later),
        now: later,
      });
      expect(approved.expiresAt.getTime()).toBe(later.getTime() + 10 * 60_000);
      const view = await breakGlassView(pool(), wrapper, {
        adminId: requester.adminId,
        ip: null,
        grantId,
        companyId: c.companyId,
        now: later,
      });
      expect(view.period).toBe("2026-05");
      const notices = await pool().query(
        `select 1 from notifications where account_id = $1 and type = 'security.break_glass'`,
        [c.accountId],
      );
      expect(notices.rowCount).toBe(1);
    } finally {
      await pool().query(
        `delete from app_config where key = 'admin.break_glass_second_admin' and version = $1`,
        [cfg.rows[0]?.version],
      );
    }
  });
});
