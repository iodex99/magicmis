import "server-only";

/**
 * Admin console data and mutations beyond Phase 2 (SPEC §26): model registry and tier routing,
 * config, jobs inspector, global mapping library curation, prompt activation, and break-glass
 * access. Every mutation writes its audit entry in the same transaction. Nothing here decrypts
 * customer data except `breakGlassView`, which requires an active grant and audits each view.
 */

import { activatePromptVersion, STAGES } from "@magicmis/ai";
import type { KeyWrapper } from "@magicmis/crypto";
import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import type { MetricValue } from "@magicmis/engine";
import { latestBlueprint, latestSnapshot } from "@magicmis/engine/server";
import { queueNotification } from "@magicmis/jobs";
import { normaliseName } from "@magicmis/semantic";
import type { Pool } from "pg";
import { z } from "zod";

import { verifyAdminStepUp } from "./identity";

// ---------------------------------------------------------------------------
// Model registry and tier routing
// ---------------------------------------------------------------------------

export const routeSchema = z.object({
  tier: z.enum(["efficient", "professional", "expert", "expert_plus"]),
  stage: z.enum(STAGES),
  modelId: z.string().min(1).max(80),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).nullable(),
  maxTokens: z.coerce.number().int().min(256).max(64_000),
  fallbackChain: z.array(z.string().min(1).max(80)).max(4),
});

export async function listRouting(pool: Pool) {
  const r = await pool.query<{
    tier: string;
    stage: string;
    model_id: string;
    effort: string | null;
    max_tokens: number;
    fallback_chain: string[];
    prompt_version: number | null;
    version: number;
    created_at: Date;
  }>(
    `select distinct on (tier, stage) tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version, version, created_at
     from public.tier_routing order by tier, stage, version desc`,
  );
  return r.rows;
}

/** A new routing version; the active prompt version carries over (changing it is the activation gate's job). */
export async function publishRoute(
  pool: Pool,
  input: { adminId: string; ip: string | null; route: z.infer<typeof routeSchema> },
) {
  const v = input.route;
  return withTransaction(pool, async (tx) => {
    await tx.query(
      `select pg_advisory_xact_lock(hashtext('tier_routing:' || $1 || ':' || $2))`,
      [v.tier, v.stage],
    );
    const model = await tx.query(
      `select 1 from public.model_registry where model_id = $1`,
      [v.modelId],
    );
    if (model.rowCount === 0)
      throw new RangeError(`model ${v.modelId} is not in the registry`);
    for (const f of v.fallbackChain) {
      const m = await tx.query(
        `select 1 from public.model_registry where model_id = $1`,
        [f],
      );
      if (m.rowCount === 0) throw new RangeError(`fallback ${f} is not in the registry`);
    }
    const current = await tx.query<{ version: number; prompt_version: number | null }>(
      `select version, prompt_version from public.tier_routing where tier = $1 and stage = $2 order by version desc limit 1`,
      [v.tier, v.stage],
    );
    const version = (current.rows[0]?.version ?? 0) + 1;
    await tx.query(
      `insert into public.tier_routing (tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version, version)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        v.tier,
        v.stage,
        v.modelId,
        v.effort,
        v.maxTokens,
        v.fallbackChain,
        current.rows[0]?.prompt_version ?? null,
        version,
      ],
    );
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "ai.routing_version_published",
      targetType: "tier_routing",
      targetId: null,
      metadata: { ...v, version },
      ip: input.ip,
    });
    return { version };
  });
}

export const modelSchema = z.object({
  modelId: z.string().min(1).max(80),
  inputPricePerMTokMicroUsd: z.coerce.bigint().nonnegative(),
  outputPricePerMTokMicroUsd: z.coerce.bigint().nonnegative(),
  available: z.boolean(),
  sourceUrl: z.url().startsWith("https://"),
});

/** A new registry version: prices re-verified now against `sourceUrl`. */
export async function publishModel(
  pool: Pool,
  input: { adminId: string; ip: string | null; model: z.infer<typeof modelSchema> },
) {
  const m = input.model;
  return withTransaction(pool, async (tx) => {
    const current = await tx.query<{
      version: number;
      display_name_internal: string;
      cache_read_multiplier: string;
      cache_write_multiplier: string;
      cache_write_1h_multiplier: string;
      batch_discount: string;
    }>(
      `select version, display_name_internal, cache_read_multiplier::text, cache_write_multiplier::text,
              cache_write_1h_multiplier::text, batch_discount::text
       from public.model_registry where model_id = $1 order by version desc limit 1`,
      [m.modelId],
    );
    const base = current.rows[0];
    if (base === undefined)
      throw new RangeError(`model ${m.modelId} is not in the registry`);
    const version = base.version + 1;
    await tx.query(
      `insert into public.model_registry
         (model_id, display_name_internal, input_price_per_mtok_micro_usd, output_price_per_mtok_micro_usd,
          cache_read_multiplier, cache_write_multiplier, cache_write_1h_multiplier, batch_discount, available,
          source_url, verified_at, version)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)`,
      [
        m.modelId,
        base.display_name_internal,
        m.inputPricePerMTokMicroUsd.toString(),
        m.outputPricePerMTokMicroUsd.toString(),
        base.cache_read_multiplier,
        base.cache_write_multiplier,
        base.cache_write_1h_multiplier,
        base.batch_discount,
        m.available,
        m.sourceUrl,
        version,
      ],
    );
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "ai.model_registry_version_published",
      targetType: "model_registry",
      targetId: null,
      metadata: {
        modelId: m.modelId,
        version,
        input: m.inputPricePerMTokMicroUsd.toString(),
        output: m.outputPricePerMTokMicroUsd.toString(),
        available: m.available,
        sourceUrl: m.sourceUrl,
      },
      ip: input.ip,
    });
    return { version };
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Keys the config editor may change; anything else needs a migration. */
export const EDITABLE_CONFIG_PREFIXES = [
  "ingest.",
  "ai.",
  "wallet.",
  "pricing.",
  "billing.",
  "gst.",
  "jobs.",
  "lifecycle.",
  "outputs.",
  "chat.",
  "commentary.",
  "semantic.",
  "validation.",
  "engine.",
  "admin.",
  "ratelimit.",
  "legal.",
] as const;

export async function listConfig(pool: Pool) {
  const r = await pool.query<{
    key: string;
    value: unknown;
    version: number;
    effective_from: Date;
  }>(
    `select distinct on (key) key, value, version, effective_from from public.app_config order by key, version desc`,
  );
  return r.rows;
}

export async function publishConfig(
  pool: Pool,
  input: { adminId: string; ip: string | null; key: string; valueJson: string },
) {
  if (!EDITABLE_CONFIG_PREFIXES.some((p) => input.key.startsWith(p)))
    throw new RangeError(`${input.key} is not editable here`);
  let value: unknown;
  try {
    value = JSON.parse(input.valueJson);
  } catch {
    throw new RangeError("the value is not valid JSON");
  }
  return withTransaction(pool, async (tx) => {
    const current = await tx.query<{ version: number; value: unknown }>(
      `select version, value from public.app_config where key = $1 order by version desc limit 1 for update`,
      [input.key],
    );
    const prev = current.rows[0];
    if (prev === undefined) throw new RangeError(`${input.key} does not exist`);
    // The shape must not change: a number stays a number, an object keeps its keys.
    const kind = (v: unknown) =>
      Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
    if (kind(prev.value) !== kind(value))
      throw new RangeError(`the value must stay a ${kind(prev.value)}`);
    if (kind(value) === "object") {
      const a = Object.keys(prev.value as object)
        .sort()
        .join(",");
      const b = Object.keys(value as object)
        .sort()
        .join(",");
      if (a !== b) throw new RangeError("the value must keep the same fields");
    }
    const version = prev.version + 1;
    await tx.query(
      `insert into public.app_config (key, value, version, created_by_admin_id) values ($1, $2, $3, $4)`,
      [input.key, JSON.stringify(value), version, input.adminId],
    );
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "config.version_published",
      targetType: "app_config",
      targetId: null,
      metadata: {
        key: input.key,
        version,
        previous: prev.value as never,
        value: value as never,
      },
      ip: input.ip,
    });
    return { version };
  });
}

// ---------------------------------------------------------------------------
// Jobs inspector
// ---------------------------------------------------------------------------

export async function listJobs(
  pool: Pool,
  filters: { state?: string; type?: string; accountId?: string },
) {
  const r = await pool.query<{
    id: string;
    account_id: string;
    type: string;
    tier: string;
    state: string;
    price_credits: string | null;
    captured_credits: string | null;
    actual_ai_cost_paise: string;
    failure_class: string | null;
    created_at: Date;
  }>(
    `select id, account_id, type, tier, state, price_credits::text, captured_credits::text, actual_ai_cost_paise::text,
            failure_class, created_at
     from public.jobs
     where ($1::text is null or state = $1) and ($2::text is null or type = $2) and ($3::uuid is null or account_id = $3)
     order by created_at desc limit 200`,
    [filters.state ?? null, filters.type ?? null, filters.accountId ?? null],
  );
  return r.rows;
}

/** A job's timeline, AI calls and charge outcome. No decrypted content. */
export async function jobDetail(pool: Pool, jobId: string) {
  const job = await pool.query<{
    id: string;
    account_id: string;
    company_id: string | null;
    type: string;
    tier: string;
    delivery_mode: string;
    state: string;
    price_credits: string | null;
    captured_credits: string | null;
    estimated_ai_cost_micro_usd: string | null;
    actual_ai_cost_micro_usd: string;
    actual_ai_cost_paise: string;
    failure_class: string | null;
    failure_code: string | null;
    failure_detail: string | null;
    quote_id: string | null;
    reservation_id: string | null;
    stage_checkpoints: Record<string, unknown>;
    created_at: Date;
    completed_at: Date | null;
  }>(
    `select id, account_id, company_id, type, tier, delivery_mode, state, price_credits::text, captured_credits::text,
            estimated_ai_cost_micro_usd::text, actual_ai_cost_micro_usd::text, actual_ai_cost_paise::text,
            failure_class, failure_code, failure_detail, quote_id, reservation_id, stage_checkpoints, created_at, completed_at
     from public.jobs where id = $1`,
    [jobId],
  );
  const row = job.rows[0];
  if (row === undefined) return null;
  const [calls, ledger] = await Promise.all([
    pool.query<{
      created_at: Date;
      stage: string;
      prompt_version: string;
      model_requested: string;
      model_used: string;
      fallback_from: string | null;
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
      usd_cost_micro: string;
      inr_cost_paise: string;
      is_batch: boolean;
      status: string;
      error_type: string | null;
      latency_ms: number | null;
    }>(
      `select created_at, stage, prompt_version, model_requested, model_used, fallback_from, input_tokens, output_tokens,
              cache_read_input_tokens, cache_creation_input_tokens, usd_cost_micro::text, inr_cost_paise::text, is_batch,
              status, error_type, latency_ms
       from public.ai_calls where job_id = $1 order by created_at`,
      [jobId],
    ),
    pool.query<{ created_at: Date; entry_type: string; amount: string }>(
      `select l.created_at, l.entry_type, l.amount::text from public.credit_ledger l
       where l.reservation_id = $1 order by l.created_at`,
      [row.reservation_id],
    ),
  ]);
  const history = z
    .array(z.object({ from: z.string().nullable(), state: z.string(), at: z.string() }))
    .catch([])
    .parse(row.stage_checkpoints["state_history"]);
  // Checkpoint keys only: values may describe customer structure.
  const { stage_checkpoints: checkpoints, ...rest } = row;
  return {
    job: { ...rest, checkpointKeys: Object.keys(checkpoints).sort() },
    history,
    calls: calls.rows,
    ledger: ledger.rows,
  };
}

// ---------------------------------------------------------------------------
// Global mapping library
// ---------------------------------------------------------------------------

export async function libraryCandidates(pool: Pool, minAccounts: number) {
  const r = await pool.query<{
    id: string;
    normalized_name: string;
    head_code: string;
    head_name: string;
    distinct_account_count: number;
    status: string;
    created_at: Date;
  }>(
    `select c.id, c.normalized_name, h.code as head_code, h.name as head_name, c.distinct_account_count, c.status, c.created_at
     from public.library_candidates c join public.mis_heads h on h.id = c.proposed_mis_head_id
     where c.status = 'pending' and c.distinct_account_count >= $1
     order by c.distinct_account_count desc, c.created_at limit 200`,
    [minAccounts],
  );
  return r.rows;
}

export async function librarySearch(pool: Pool, query: string) {
  const r = await pool.query<{
    id: string;
    normalized_name: string;
    aliases: string[];
    head_code: string;
    source: string;
    created_at: Date;
  }>(
    `select l.id, l.normalized_name, l.aliases, h.code as head_code, l.source, l.created_at
     from public.global_mapping_library l join public.mis_heads h on h.id = l.mis_head_id
     where $1 = '' or l.normalized_name like '%' || $1 || '%' or h.code = upper($1)
     order by l.normalized_name limit 200`,
    [normaliseName(query)],
  );
  return r.rows;
}

/** SPEC §18: an admin approves or rejects a candidate; approval adds a promoted library entry. */
export async function decideCandidate(
  pool: Pool,
  input: {
    adminId: string;
    ip: string | null;
    candidateId: string;
    decision: "approved" | "rejected";
  },
) {
  return withTransaction(pool, async (tx) => {
    const c = await tx.query<{
      normalized_name: string;
      proposed_mis_head_id: string;
      status: string;
      distinct_account_count: number;
    }>(
      `select normalized_name, proposed_mis_head_id, status, distinct_account_count from public.library_candidates where id = $1 for update`,
      [input.candidateId],
    );
    const cand = c.rows[0];
    if (cand === undefined) throw new RangeError("candidate not found");
    if (cand.status !== "pending") throw new RangeError("candidate already decided");
    await tx.query(
      `update public.library_candidates set status = $2, reviewed_by = $3, reviewed_at = now() where id = $1`,
      [input.candidateId, input.decision, input.adminId],
    );
    if (input.decision === "approved") {
      await tx.query(
        `insert into public.global_mapping_library (normalized_name, mis_head_id, source, promoted_by_admin_id, tenant_count)
         values ($1, $2, 'promoted', $3, $4)
         on conflict (normalized_name) do update set mis_head_id = excluded.mis_head_id, source = 'promoted',
           promoted_by_admin_id = excluded.promoted_by_admin_id, tenant_count = excluded.tenant_count`,
        [
          cand.normalized_name,
          cand.proposed_mis_head_id,
          input.adminId,
          cand.distinct_account_count,
        ],
      );
    }
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: `library.candidate_${input.decision}`,
      targetType: "library_candidates",
      targetId: input.candidateId,
      metadata: { normalizedName: cand.normalized_name },
      ip: input.ip,
    });
  });
}

export async function removeLibraryEntry(
  pool: Pool,
  input: { adminId: string; ip: string | null; entryId: string },
) {
  return withTransaction(pool, async (tx) => {
    const r = await tx.query<{ normalized_name: string }>(
      `delete from public.global_mapping_library where id = $1 returning normalized_name`,
      [input.entryId],
    );
    if (r.rowCount !== 1) throw new RangeError("entry not found");
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "library.entry_removed",
      targetType: "global_mapping_library",
      targetId: input.entryId,
      metadata: { normalizedName: r.rows[0]?.normalized_name ?? "" },
      ip: input.ip,
    });
  });
}

// ---------------------------------------------------------------------------
// Prompts and evals
// ---------------------------------------------------------------------------

export async function evalRuns(pool: Pool) {
  const r = await pool.query<{
    id: string;
    stage: string;
    tier: string;
    prompt_version: number;
    mode: string;
    items: number;
    correct: number;
    accuracy: string;
    cost_micro_usd: string;
    created_at: Date;
  }>(
    `select id, stage, tier, prompt_version, mode, items, correct, accuracy::text, cost_micro_usd::text, created_at
     from public.ai_eval_runs order by created_at desc limit 200`,
  );
  return r.rows;
}

export async function activatePrompt(
  pool: Pool,
  input: {
    adminId: string;
    stage: (typeof STAGES)[number];
    tier: "efficient" | "professional" | "expert" | "expert_plus";
    promptVersion: number;
  },
) {
  // The gate (live eval at or above threshold) and its audit entry live in @magicmis/ai.
  return activatePromptVersion(pool, {
    stage: input.stage,
    tier: input.tier,
    promptVersion: input.promptVersion,
    actorAdminId: input.adminId,
  });
}

// ---------------------------------------------------------------------------
// Break-glass
// ---------------------------------------------------------------------------

export class StepUpRequired extends Error {
  constructor() {
    super("enter a current authenticator code to confirm");
    this.name = "StepUpRequired";
  }
}

/**
 * Request break-glass access to one company (SPEC §26, R-53). The admin re-authenticates with a
 * current TOTP code. With `admin.break_glass_second_admin` on, the grant waits for another admin's
 * approval and its clock starts then; otherwise it is active at once. The account holder is emailed
 * when access starts, and daily while it is used.
 */
export async function grantBreakGlass(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    adminId: string;
    ip: string | null;
    accountId: string;
    companyId: string;
    reason: string;
    minutes: number;
    code: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [max, secondAdmin] = await Promise.all([
    readConfig(pool, "admin.break_glass_max_minutes", z.number().int().positive(), now),
    readConfig(pool, "admin.break_glass_second_admin", z.boolean(), now),
  ]);
  const reason = input.reason.trim();
  if (reason.length < 20)
    throw new RangeError("give a written reason of at least 20 characters");
  // The customer notice template and the database check accept at most 500: a longer reason would
  // leave the grant working while the account holder is never told (migration 0029).
  if (reason.length > 500)
    throw new RangeError("keep the reason to 500 characters or fewer");
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > max)
    throw new RangeError(`access lasts between 1 and ${max.toString()} minutes`);
  return withTransaction(pool, async (tx) => {
    if (
      !(await verifyAdminStepUp(tx, wrapper, {
        adminId: input.adminId,
        code: input.code,
        now,
      }))
    )
      throw new StepUpRequired();
    // A purged account has no data to view and no address to notify. A closed account awaiting
    // purge may be viewed, and its holder is still emailed (worker CLOSED_ACCOUNT_TYPES).
    const target = await tx.query<{
      purged_at: Date | null;
      company_purged: Date | null;
    }>(
      `select a.purged_at, c.purged_at as company_purged from public.accounts a
       join public.companies c on c.account_id = a.id where a.id = $1 and c.id = $2 for share of a`,
      [input.accountId, input.companyId],
    );
    const row = target.rows[0];
    if (row === undefined) throw new RangeError("company not found for this account");
    if (row.purged_at !== null || row.company_purged !== null)
      throw new RangeError("this account or company has been purged");
    const expiresAt = secondAdmin
      ? null
      : new Date(now.getTime() + input.minutes * 60_000);
    const g = await tx.query<{ id: string }>(
      `insert into public.break_glass_grants
         (admin_user_id, account_id, company_id, reason, minutes, expires_at, approved_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        input.adminId,
        input.accountId,
        input.companyId,
        reason,
        input.minutes,
        expiresAt,
        secondAdmin ? null : now,
        now,
      ],
    );
    const grantId = g.rows[0]?.id ?? "";
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: secondAdmin ? "admin.break_glass_requested" : "admin.break_glass_granted",
      targetType: "company",
      targetId: input.companyId,
      metadata: {
        grantId,
        reason,
        minutes: input.minutes,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      ip: input.ip,
    });
    if (expiresAt !== null)
      await queueNotification(tx, {
        accountId: input.accountId,
        type: "security.break_glass",
        payload: { reason, expires_at: expiresAt.toISOString() },
        dedupeKey: `break_glass:${grantId}`,
      });
    return { grantId, expiresAt, pending: secondAdmin };
  });
}

/** A second admin approves a pending grant with their own TOTP code; the clock starts now. */
export async function approveBreakGlass(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    adminId: string;
    ip: string | null;
    grantId: string;
    code: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return withTransaction(pool, async (tx) => {
    const g = await tx.query<{
      admin_user_id: string;
      account_id: string;
      company_id: string | null;
      reason: string;
      minutes: number;
    }>(
      `select admin_user_id, account_id, company_id, reason, minutes from public.break_glass_grants
       where id = $1 and approved_at is null and revoked_at is null for update`,
      [input.grantId],
    );
    const grant = g.rows[0];
    if (grant === undefined) throw new RangeError("no pending grant to approve");
    if (grant.admin_user_id === input.adminId)
      throw new RangeError("a different admin must approve this request");
    if (
      !(await verifyAdminStepUp(tx, wrapper, {
        adminId: input.adminId,
        code: input.code,
        now,
      }))
    )
      throw new StepUpRequired();
    const expiresAt = new Date(now.getTime() + grant.minutes * 60_000);
    await tx.query(
      `update public.break_glass_grants set approved_by = $2, approved_at = $3, expires_at = $4 where id = $1`,
      [input.grantId, input.adminId, now, expiresAt],
    );
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "admin.break_glass_approved",
      targetType: "company",
      targetId: grant.company_id,
      metadata: { grantId: input.grantId, requestedBy: grant.admin_user_id },
      ip: input.ip,
    });
    await queueNotification(tx, {
      accountId: grant.account_id,
      type: "security.break_glass",
      payload: { reason: grant.reason, expires_at: expiresAt.toISOString() },
      dedupeKey: `break_glass:${input.grantId}`,
    });
    return { expiresAt };
  });
}

export async function revokeBreakGlass(
  pool: Pool,
  input: { adminId: string; ip: string | null; grantId: string },
) {
  return withTransaction(pool, async (tx) => {
    const r = await tx.query<{ account_id: string; company_id: string | null }>(
      `update public.break_glass_grants set revoked_at = now() where id = $1 and revoked_at is null
       returning account_id, company_id`,
      [input.grantId],
    );
    if (r.rowCount !== 1) throw new RangeError("grant not found or already revoked");
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "admin.break_glass_revoked",
      targetType: "company",
      targetId: r.rows[0]?.company_id ?? null,
      metadata: { grantId: input.grantId, accountId: r.rows[0]?.account_id ?? null },
      ip: input.ip,
    });
  });
}

/** Active and pending (not yet approved) grants for an account. */
export async function activeGrants(
  pool: Pool,
  accountId: string,
  now: Date = new Date(),
) {
  const r = await pool.query<{
    id: string;
    admin_user_id: string;
    admin_email: string;
    company_id: string | null;
    company_name: string | null;
    reason: string;
    minutes: number;
    expires_at: Date | null;
    approved_at: Date | null;
    created_at: Date;
  }>(
    `select g.id, g.admin_user_id, a.email as admin_email, g.company_id, c.name as company_name, g.reason,
            g.minutes, g.expires_at, g.approved_at, g.created_at
     from public.break_glass_grants g
     join public.admin_users a on a.id = g.admin_user_id
     left join public.companies c on c.id = g.company_id
     where g.account_id = $1 and g.revoked_at is null
       and (g.approved_at is null or g.expires_at > $2)
     order by g.created_at desc`,
    [accountId, now],
  );
  return r.rows;
}

export class BreakGlassRequired extends Error {
  constructor() {
    super("An active break-glass grant is required to view customer data.");
    this.name = "BreakGlassRequired";
  }
}

/**
 * Decrypted company memory under an active, approved grant for exactly this company, held by this
 * admin: the template name and the latest month's metric values. Each view is audit-logged, and the
 * account holder gets one "support viewed your data" email per grant per IST day.
 */
export async function breakGlassView(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    adminId: string;
    ip: string | null;
    grantId: string;
    companyId: string;
    now?: Date;
  },
): Promise<{ template: string; period: string | null; values: MetricValue[] }> {
  const now = input.now ?? new Date();
  const grant = await pool.query<{
    account_id: string;
    company_name: string;
    reason: string;
  }>(
    `select g.account_id, c.name as company_name, g.reason
     from public.break_glass_grants g
     join public.companies c on c.account_id = g.account_id
     where g.id = $1 and g.admin_user_id = $2 and g.revoked_at is null
       and g.approved_at is not null and g.expires_at > $3
       and c.id = $4 and (g.company_id = c.id or g.account_wide)`,
    [input.grantId, input.adminId, now, input.companyId],
  );
  const row = grant.rows[0];
  if (row === undefined) throw new BreakGlassRequired();
  const accountId = row.account_id;
  const day = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  await withTransaction(pool, async (tx) => {
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "admin.break_glass_viewed",
      targetType: "company",
      targetId: input.companyId,
      metadata: { grantId: input.grantId },
      ip: input.ip,
    });
    await queueNotification(tx, {
      accountId,
      type: "security.break_glass_viewed",
      payload: { company_name: row.company_name, day, reason: row.reason },
      dedupeKey: `break_glass_viewed:${input.grantId}:${day}`,
    });
  });
  const scope = { accountId, companyId: input.companyId };
  const blueprint = await latestBlueprint(pool, wrapper, scope);
  const period = await pool.query<{ period: string | null }>(
    `select max(period) as period from public.snapshots where company_id = $1`,
    [input.companyId],
  );
  const latest = period.rows[0]?.period ?? null;
  const snapshot =
    latest === null
      ? null
      : await latestSnapshot(pool, wrapper, { ...scope, period: latest });
  const template = z
    .object({ name: z.string() })
    .safeParse(blueprint?.parts.templateSpec);
  return {
    template: template.success ? template.data.name : "—",
    period: latest,
    values: ((snapshot?.metricStore.values ?? []) as unknown as MetricValue[]).filter(
      (v) => Object.keys(v.dims).length === 0,
    ),
  };
}
