import "server-only";

import { randomBytes } from "node:crypto";

import { currencySymbol, type NumberFormat } from "@magicmis/core/reporting-conventions";
import type { DateOrder } from "@magicmis/core/time";
import { readConfig } from "@magicmis/db/config";

import {
  latestBlueprint,
  latestSnapshot,
  loadAccountRules,
  openForCompany,
  sealForCompany,
} from "@magicmis/engine/server";
import { mappingRulesSchema, type LibraryEntry } from "@magicmis/semantic";
import { templateSpecSchema, type TemplateSpec } from "@magicmis/templates";
import type { Pool } from "pg";
import { z } from "zod";

import { keyWrapper } from "./runtime";

export interface CompanySummary {
  readonly id: string;
  readonly name: string;
  readonly lifecycleState: string;
  readonly fyStartMonth: number;
  readonly firstSetupAt: string | null;
  readonly latestPeriod: string | null;
}

export async function listCompanies(
  pool: Pool,
  accountId: string,
): Promise<CompanySummary[]> {
  const r = await pool.query<{
    id: string;
    name: string;
    lifecycle_state: string;
    fy_start_month: number;
    first_setup_at: Date | null;
    latest_period: string | null;
  }>(
    `select c.id, c.name, c.lifecycle_state, c.fy_start_month, c.first_setup_at,
            (select max(period) from public.snapshots s where s.company_id = c.id) as latest_period
     from public.companies c where c.account_id = $1 and c.deleted_at is null order by c.created_at`,
    [accountId],
  );
  return r.rows.map((c) => ({
    id: c.id,
    name: c.name,
    lifecycleState: c.lifecycle_state,
    fyStartMonth: c.fy_start_month,
    firstSetupAt: c.first_setup_at?.toISOString() ?? null,
    latestPeriod: c.latest_period,
  }));
}

/**
 * Creates a company and its redaction key (SPEC §17): 32 random bytes, sealed under the company
 * data key, released only to the owner's browser. Creating a company captures nothing (SPEC §23).
 */
export async function createCompany(
  pool: Pool,
  input: {
    accountId: string;
    name: string;
    fyStartMonth: number;
    currency: string;
    numberFormat: NumberFormat;
    dateOrder: DateOrder;
  },
): Promise<string> {
  // The company's own reporting conventions, settled once and reused every month
  // (ADR 0030). The form pre-fills them from the account's billing country, so this
  // is a decision the reader confirmed rather than one taken for them.
  const inserted = await pool.query<{ id: string }>(
    `insert into public.companies
       (account_id, name, fy_start_month, currency, number_format, date_order)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      input.accountId,
      input.name,
      input.fyStartMonth,
      input.currency,
      input.numberFormat,
      input.dateOrder,
    ],
  );
  const companyId = inserted.rows[0]?.id ?? "";
  const key = randomBytes(32);
  try {
    const sealed = await sealForCompany(pool, keyWrapper(), {
      accountId: input.accountId,
      companyId,
      purpose: "redaction_key",
      id: companyId,
      plaintext: key,
    });
    await pool.query(
      `update public.companies set wrapped_redaction_key = $2 where id = $1`,
      [companyId, sealed],
    );
  } finally {
    key.fill(0);
  }
  return companyId;
}

const validationConfigSchema = {
  tb: z.number().int().nonnegative(),
  recon: z.number().int().nonnegative(),
  heads: z.array(z.string()),
  buckets: z.array(
    z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative().nullable()]),
  ),
};

export interface JobSession {
  readonly company: {
    id: string;
    name: string;
    fyStartMonth: number;
    lifecycleState: string;
    /**
     * This company's own reporting conventions (ADR 0030). They travel with the
     * session because the pipeline runs in the browser: the date order decides how
     * files are read, and the currency and grouping decide how the workbook reads.
     */
    currency: string;
    currencySymbol: string;
    numberFormat: "lakhs_crores" | "absolute" | "millions";
    dateOrder: DateOrder;
  };
  /** Base64 of the company redaction key; never logged, never persisted by the browser. */
  readonly redactionKey: string;
  readonly library: readonly LibraryEntry[];
  readonly fuzzyThreshold: string;
  readonly validation: {
    tbTolerancePaise: string;
    reconciliationTolerancePaise: string;
    signSanityHeads: readonly string[];
    ageingBuckets: readonly [number, number | null][];
  };
  readonly memory: {
    readonly blueprintVersion: number | null;
    readonly mappingRules: z.infer<typeof mappingRulesSchema> | null;
    readonly accountRules: readonly { pattern: string; head: string }[];
    readonly latestPeriod: string | null;
    readonly latestVersion: number | null;
    readonly priorBalances: readonly {
      ledgerKey: string;
      head: string;
      period: string;
      closing: string;
    }[];
    readonly sourceFingerprints: Readonly<Record<string, string>>;
    /** The company's template (built-in or recreated from a reference MIS); null before setup. */
    readonly templateSpec: TemplateSpec | null;
  };
}

/** Everything the browser pipeline needs for this company, decrypted for its owner only. */
export async function jobSession(
  pool: Pool,
  accountId: string,
  companyId: string,
): Promise<JobSession | null> {
  const r = await pool.query<{
    id: string;
    name: string;
    fy_start_month: number;
    lifecycle_state: string;
    currency: string;
    number_format: "lakhs_crores" | "absolute" | "millions";
    date_order: DateOrder;
    wrapped_redaction_key: Buffer | null;
    latest_period: string | null;
  }>(
    `select c.id, c.name, c.fy_start_month, c.lifecycle_state, c.wrapped_redaction_key,
            c.currency, c.number_format, c.date_order,
            (select max(period) from public.snapshots s where s.company_id = c.id) as latest_period
     from public.companies c where c.id = $1 and c.account_id = $2 and c.deleted_at is null`,
    [companyId, accountId],
  );
  const c = r.rows[0];
  if (c === undefined || c.wrapped_redaction_key === null) return null;
  const wrapper = keyWrapper();
  const key = await openForCompany(pool, wrapper, {
    accountId,
    companyId,
    purpose: "redaction_key",
    id: companyId,
    sealed: c.wrapped_redaction_key,
  });

  const library = await pool.query<{
    normalized_name: string;
    aliases: string[];
    code: string;
  }>(
    `select l.normalized_name, l.aliases, h.code from public.global_mapping_library l join public.mis_heads h on h.id = l.mis_head_id`,
  );
  const [fuzzy, tb, recon, heads, buckets] = await Promise.all([
    readConfig(pool, "semantic.fuzzy_threshold", z.string()),
    readConfig(pool, "validation.tb_tolerance_paise", validationConfigSchema.tb),
    readConfig(
      pool,
      "validation.reconciliation_tolerance_paise",
      validationConfigSchema.recon,
    ),
    readConfig(pool, "validation.sign_sanity_heads", validationConfigSchema.heads),
    readConfig(pool, "engine.ageing_buckets", validationConfigSchema.buckets),
  ]);

  const blueprint = await latestBlueprint(pool, wrapper, { accountId, companyId });
  const snapshot =
    c.latest_period === null
      ? null
      : await latestSnapshot(pool, wrapper, {
          accountId,
          companyId,
          period: c.latest_period,
        });
  const fingerprints = await pool.query<{ source_fingerprints: Record<string, string> }>(
    `select source_fingerprints from public.blueprints where company_id = $1 order by version desc limit 1`,
    [companyId],
  );

  const session: JobSession = {
    company: {
      id: c.id,
      name: c.name,
      fyStartMonth: c.fy_start_month,
      lifecycleState: c.lifecycle_state,
      currency: c.currency,
      currencySymbol: currencySymbol(c.currency),
      numberFormat: c.number_format,
      dateOrder: c.date_order,
    },
    redactionKey: key.toString("base64"),
    library: library.rows.map((l) => ({
      name: l.normalized_name,
      aliases: l.aliases,
      head: l.code,
    })),
    fuzzyThreshold: fuzzy,
    validation: {
      tbTolerancePaise: tb.toString(),
      reconciliationTolerancePaise: recon.toString(),
      signSanityHeads: heads,
      ageingBuckets: buckets,
    },
    memory: {
      blueprintVersion: blueprint?.version ?? null,
      mappingRules:
        blueprint === null
          ? null
          : mappingRulesSchema.parse(blueprint.parts.mappingRules),
      accountRules: (await loadAccountRules(pool, wrapper, accountId)).map(
        ({ pattern, head }) => ({ pattern, head }),
      ),
      latestPeriod: c.latest_period,
      latestVersion: snapshot?.version ?? null,
      priorBalances:
        snapshot?.ledgerBalances.map(({ ledgerKey, head, period, closing }) => ({
          ledgerKey,
          head,
          period,
          closing,
        })) ?? [],
      sourceFingerprints: fingerprints.rows[0]?.source_fingerprints ?? {},
      templateSpec:
        blueprint === null
          ? null
          : (templateSpecSchema.safeParse(blueprint.parts.templateSpec).data ?? null),
    },
  };
  key.fill(0);
  return session;
}

export async function companyForAccount(
  pool: Pool,
  accountId: string,
  companyId: string,
): Promise<boolean> {
  const r = await pool.query(
    `select 1 from public.companies where id = $1 and account_id = $2 and deleted_at is null`,
    [companyId, accountId],
  );
  return r.rowCount === 1;
}
