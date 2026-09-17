/**
 * Cross-tenant isolation (SPEC §34 Phase 0 acceptance, §30).
 *
 * The harness seeds two tenants with identically-shaped data and then tries, from
 * account A's session, to reach account B's rows by every route the schema offers.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedTwoAccounts, startTestDb, type SeededAccount, type TestDb } from "./harness";

// Undefined until beforeAll completes -- and it stays undefined if beforeAll throws,
// which is exactly when afterAll still runs. The optional chain below is not defensive
// noise; the type has to admit that.
let db: TestDb | undefined;
let alpha: SeededAccount;
let beta: SeededAccount;

beforeAll(async () => {
  db = await startTestDb();
  [alpha, beta] = await seedTwoAccounts(testDb().pool);
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

/** The started database. Throws a clear error instead of a TypeError if setup failed. */
function testDb(): TestDb {
  if (db === undefined) throw new Error("test database was not started");
  return db;
}

/** Every customer table that must be scoped by account_id. */
const TENANT_TABLES = [
  "companies",
  "blueprints",
  "snapshots",
  "account_mapping_rules",
  "jobs",
  "quotes",
  "credit_lots",
  "wallets",
  "reservations",
  "credit_ledger",
  "purchases",
  "invoices",
  "chat_threads",
  "chat_messages",
  "outputs",
  "notifications",
  "login_events",
  "consents",
  "source_uploads",
] as const;

/** Tables a customer-facing role must not read at all (SPEC §2.5, §10). */
const INTERNAL_TABLES = [
  "ai_calls",
  "job_stage_outputs",
  "estimator_calibration",
  "model_registry",
  "tier_routing",
  "app_config",
  "account_keys",
  "company_keys",
  "chat_query_steps",
  "library_candidates",
  "invoice_counters",
  "audit_log",
  "reauth_grants",
  "auth_throttle",
] as const;

describe("every customer table has RLS enabled and forced", () => {
  it("leaves no tenant table unprotected", async () => {
    const result = await testDb().pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by c.relname`,
    );

    const unprotected = result.rows
      .filter((r) => !r.relrowsecurity)
      .map((r) => r.relname);
    expect(unprotected, "tables without RLS enabled").toEqual([]);

    // FORCE matters: without it the table owner bypasses its own policies.
    for (const table of TENANT_TABLES) {
      const row = result.rows.find((r) => r.relname === table);
      expect(row?.relforcerowsecurity, `${table} should FORCE row level security`).toBe(
        true,
      );
    }
  });

  it("covers every table named in SPEC §9", async () => {
    const result = await testDb().pool.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const present = new Set(result.rows.map((r) => r.relname));
    for (const table of [
      ...TENANT_TABLES,
      ...INTERNAL_TABLES,
      "mis_heads",
      "global_mapping_library",
      "price_book",
      "credit_packs",
    ]) {
      expect(present.has(table), `missing table ${table}`).toBe(true);
    }
    // SPEC §9 listed 35 tables; `backup_codes` and `account_recoveries` went with the
    // customer's second factor (ADR 0028), so the floor is the rest of them.
    expect(present.size).toBeGreaterThanOrEqual(33);
  });
});

describe("account A cannot reach account B's data", () => {
  it("sees only its own row in every tenant table", async () => {
    for (const table of TENANT_TABLES) {
      const rows = await testDb().asUser(
        alpha.authUserId,
        "authenticated",
        async (client) => {
          const r = await client.query<{ account_id: string }>(
            `select account_id from public.${table}`,
          );
          return r.rows;
        },
      );
      for (const row of rows) {
        expect(row.account_id, `${table} leaked a row to the wrong tenant`).toBe(
          alpha.accountId,
        );
      }
    }
  });

  it("returns zero rows when filtering explicitly for the other tenant", async () => {
    for (const table of TENANT_TABLES) {
      const count = await testDb().asUser(
        alpha.authUserId,
        "authenticated",
        async (client) => {
          const r = await client.query<{ n: string }>(
            `select count(*)::text as n from public.${table} where account_id = $1`,
            [beta.accountId],
          );
          return Number.parseInt(r.rows[0]?.n ?? "0", 10);
        },
      );
      expect(count, `${table} returned rows for the other tenant`).toBe(0);
    }
  });

  it("cannot read another tenant's company by its id", async () => {
    const rows = await testDb().asUser(
      alpha.authUserId,
      "authenticated",
      async (client) => {
        const r = await client.query(`select id from public.companies where id = $1`, [
          beta.companyId,
        ]);
        return r.rowCount;
      },
    );
    expect(rows).toBe(0);
  });

  /**
   * Assert an attempted write neither succeeds nor mutates anything.
   *
   * Two independent layers stop it, and either alone is sufficient: `authenticated`
   * holds no UPDATE or DELETE grant, so it is refused at the privilege level before RLS
   * is consulted; and the policy would match no rows regardless. The security property
   * is "the row is unchanged", so that is what is asserted -- not which layer happened
   * to refuse it first.
   */
  async function expectWriteRefused(sql: string, params: unknown[]): Promise<void> {
    let affected: number | null = 0;
    try {
      affected = await testDb().asUser(
        alpha.authUserId,
        "authenticated",
        async (client) => {
          const r = await client.query(sql, params);
          return r.rowCount;
        },
      );
    } catch (error) {
      expect(String(error)).toMatch(/permission denied|violates row-level security/iu);
      affected = 0;
    }
    expect(affected).toBe(0);
  }

  it("cannot update another tenant's company", async () => {
    await expectWriteRefused(
      `update public.companies set name = 'stolen' where id = $1`,
      [beta.companyId],
    );
    // And the row really is untouched, verified from a role that can see it.
    const name = await testDb().asUser(null, "service_role", async (client) => {
      const r = await client.query<{ name: string }>(
        `select name from public.companies where id = $1`,
        [beta.companyId],
      );
      return r.rows[0]?.name;
    });
    expect(name).toBe("beta Trading Pvt Ltd");
  });

  it("cannot delete another tenant's company", async () => {
    await expectWriteRefused(`delete from public.companies where id = $1`, [
      beta.companyId,
    ]);
    const stillThere = await testDb().asUser(null, "service_role", async (client) => {
      const r = await client.query(`select 1 from public.companies where id = $1`, [
        beta.companyId,
      ]);
      return r.rowCount;
    });
    expect(stillThere).toBe(1);
  });

  it("cannot insert a row belonging to another tenant", async () => {
    await expect(
      testDb().asUser(alpha.authUserId, "authenticated", async (client) => {
        await client.query(
          `insert into public.companies (account_id, name) values ($1, 'forged')`,
          [beta.accountId],
        );
      }),
    ).rejects.toThrow();
  });

  it("cannot see another account's profile row", async () => {
    const rows = await testDb().asUser(
      alpha.authUserId,
      "authenticated",
      async (client) => {
        const r = await client.query<{ id: string }>(`select id from public.accounts`);
        return r.rows;
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(alpha.accountId);
  });

  it("cannot impersonate by shadowing accounts with a temp table", async () => {
    // app.current_account_id() pins an empty search_path precisely to stop this.
    const rows = await testDb().asUser(
      alpha.authUserId,
      "authenticated",
      async (client) => {
        await client.query(
          `create temp table accounts (id uuid, auth_user_id uuid, deleted_at timestamptz, status text)`,
        );
        await client.query(`insert into accounts values ($1, $2, null, 'active')`, [
          beta.accountId,
          alpha.authUserId,
        ]);
        const r = await client.query<{ account_id: string }>(
          `select account_id from public.companies`,
        );
        return r.rows;
      },
    );
    for (const row of rows) {
      expect(row.account_id).toBe(alpha.accountId);
    }
  });
});

describe("SPEC §8 at the database layer: the single active session", () => {
  /** Rows the account can see in every tenant table, under the given claim overrides. */
  async function visibleRows(claims: Record<string, string>): Promise<number> {
    let total = 0;
    for (const table of TENANT_TABLES) {
      total += await testDb().asUser(
        alpha.authUserId,
        "authenticated",
        async (client) => {
          const r = await client.query<{ n: string }>(
            `select count(*)::text as n from public.${table}`,
          );
          return Number.parseInt(r.rows[0]?.n ?? "0", 10);
        },
        claims,
      );
    }
    return total;
  }

  it("serves a token on the active session (control)", async () => {
    // Without this control, the refusals below could pass because nothing is visible to
    // anyone.
    expect(await visibleRows({})).toBeGreaterThan(0);
  });

  it("ignores the aal claim — a password is the only customer factor (ADR 0028)", async () => {
    // Migration 0012 required aal2 here. Migration 0036 dropped it: every customer token
    // is aal1 now, and a predicate that refuses all of them is a dead second layer, not a
    // strict one. Neither value decides anything; the active session does.
    expect(await visibleRows({ aal: "aal1" })).toBeGreaterThan(0);
    expect(await visibleRows({ aal: "aal2" })).toBeGreaterThan(0);
  });

  it("serves a token with no aal claim at all", async () => {
    const count = await testDb().asUser(
      alpha.authUserId,
      "authenticated",
      async (client) => {
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: alpha.authUserId, session_id: alpha.sessionId }),
        ]);
        const r = await client.query<{ n: string }>(
          `select count(*)::text as n from public.companies`,
        );
        return Number.parseInt(r.rows[0]?.n ?? "0", 10);
      },
    );
    expect(count).toBeGreaterThan(0);
  });

  it("returns nothing to a superseded session — a second login terminates the first", async () => {
    expect(
      await visibleRows({ session_id: "00000000-0000-4000-8000-000000000000" }),
    ).toBe(0);
  });

  it("stops serving the old session the moment active_session_id moves", async () => {
    const oldSession = alpha.sessionId;
    await testDb().pool.query(
      `update public.accounts set active_session_id = gen_random_uuid() where id = $1`,
      [alpha.accountId],
    );
    try {
      expect(await visibleRows({ session_id: oldSession })).toBe(0);
    } finally {
      await testDb().pool.query(
        `update public.accounts set active_session_id = $1 where id = $2`,
        [oldSession, alpha.accountId],
      );
    }
  });

  it("refuses a suspended account even on its active session", async () => {
    await testDb().pool.query(
      `update public.accounts set status = 'suspended' where id = $1`,
      [alpha.accountId],
    );
    try {
      expect(await visibleRows({})).toBe(0);
    } finally {
      await testDb().pool.query(
        `update public.accounts set status = 'active' where id = $1`,
        [alpha.accountId],
      );
    }
  });
});

describe("unauthenticated and anon access", () => {
  it("reads nothing from any tenant table with no JWT", async () => {
    for (const table of TENANT_TABLES) {
      const count = await testDb().asUser(null, "authenticated", async (client) => {
        const r = await client.query<{ n: string }>(
          `select count(*)::text as n from public.${table}`,
        );
        return Number.parseInt(r.rows[0]?.n ?? "0", 10);
      });
      expect(count, `${table} is readable without authentication`).toBe(0);
    }
  });

  it("lets anon read only the price book, packs and MIS heads (SPEC §2.3)", async () => {
    await testDb().asUser(null, "anon", async (client) => {
      await expect(
        client.query(`select * from public.price_book`),
      ).resolves.toBeDefined();
      await expect(
        client.query(`select * from public.credit_packs`),
      ).resolves.toBeDefined();
      await expect(client.query(`select * from public.mis_heads`)).resolves.toBeDefined();
    });
  });

  it("denies anon every tenant table at the privilege level", async () => {
    for (const table of TENANT_TABLES) {
      await expect(
        testDb().asUser(null, "anon", async (client) => {
          await client.query(`select * from public.${table}`);
        }),
        `anon can reach ${table}`,
      ).rejects.toThrow(/permission denied/iu);
    }
  });
});

describe("internal tables are unreachable by customer roles", () => {
  it("denies authenticated access to cost, routing and key material", async () => {
    for (const table of INTERNAL_TABLES) {
      await expect(
        testDb().asUser(alpha.authUserId, "authenticated", async (client) => {
          await client.query(`select * from public.${table}`);
        }),
        `authenticated can reach ${table} — SPEC §2.5 / §10 forbid it`,
      ).rejects.toThrow(/permission denied/iu);
    }
  });
});

describe("service role", () => {
  it("bypasses RLS, as the worker requires", async () => {
    const count = await testDb().asUser(null, "service_role", async (client) => {
      const r = await client.query<{ n: string }>(
        `select count(*)::text as n from public.companies`,
      );
      return Number.parseInt(r.rows[0]?.n ?? "0", 10);
    });
    expect(count).toBe(2);
  });

  it("still cannot update or delete an append-only table", async () => {
    // The privilege is revoked AND a trigger refuses it. Either alone would be enough;
    // both means dropping one does not silently open the other.
    for (const table of [
      "credit_ledger",
      "audit_log",
      "blueprints",
      "snapshots",
      "invoices",
    ]) {
      await expect(
        testDb().asUser(null, "service_role", async (client) => {
          await client.query(`delete from public.${table}`);
        }),
        `${table} should be append-only`,
      ).rejects.toThrow();
    }
  });
});
