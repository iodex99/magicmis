/**
 * Price book and credit pack administration (SPEC §12, §26). Prices are never edited in
 * place: a change is a new price book version with its own effective date, so every past
 * charge still resolves to the version that priced it. Every change is audit-logged.
 */

import { appendAudit } from "@magicmis/db/audit";
import { withTransaction, type Queryable } from "@magicmis/db/tx";
import { ACTION_KEYS } from "@magicmis/wallet";
import type { Pool } from "pg";
import { z } from "zod";

const decimal = z.string().regex(/^\d+(\.\d{1,4})?$/u, "Use a plain decimal, e.g. 0.8");

export const priceBookVersionSchema = z
  .object({
    actionKey: z.enum(ACTION_KEYS),
    baseCredits: z.coerce.bigint().refine((v) => v >= 0n, "Must be zero or more"),
    efficient: decimal,
    professional: decimal,
    expert: decimal,
    instantSurchargeCredits: z.coerce
      .bigint()
      .refine((v) => v >= 0n, "Must be zero or more"),
    maxAiCostRatio: z
      .string()
      .regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/u, "Between 0 and 1, up to 4 decimals")
      .refine((v) => /[1-9]/u.test(v), "Must be greater than 0"),
    reservationMode: z.enum(["fixed", "capped"]),
    priceFromActionKey: z.enum(ACTION_KEYS).nullable(),
    enabled: z.boolean(),
    effectiveFrom: z.coerce.date(),
  })
  .refine((v) => v.priceFromActionKey !== v.actionKey, {
    message: "An action cannot price from itself",
    path: ["priceFromActionKey"],
  });

export type PriceBookVersionInput = z.infer<typeof priceBookVersionSchema>;

export async function publishPriceBookVersion(
  pool: Pool,
  input: {
    adminId: string;
    version: PriceBookVersionInput;
    now?: Date;
    ip?: string | null;
  },
): Promise<{ version: number }> {
  const now = input.now ?? new Date();
  const v = input.version;
  // A price may take effect now or later, never retroactively: past charges keep the
  // version that priced them. One minute of tolerance for form latency.
  if (v.effectiveFrom.getTime() < now.getTime() - 60_000) {
    throw new RangeError("effective date must not be in the past");
  }
  return withTransaction(pool, async (tx) => {
    // Serialise versions per action.
    await tx.query(`select pg_advisory_xact_lock(hashtext('price_book:' || $1))`, [
      v.actionKey,
    ]);
    const next = await tx.query<{ n: number }>(
      `select coalesce(max(version), 0) + 1 as n from public.price_book where action_key = $1`,
      [v.actionKey],
    );
    const version = next.rows[0]?.n ?? 1;
    const inserted = await tx.query<{ id: string }>(
      `insert into public.price_book
         (action_key, base_credits, tier_multipliers, instant_surcharge_credits, max_ai_cost_ratio,
          reservation_mode, price_from_action_key, enabled, version, effective_from, created_by_admin_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [
        v.actionKey,
        v.baseCredits.toString(),
        JSON.stringify({
          efficient: v.efficient,
          professional: v.professional,
          expert: v.expert,
        }),
        v.instantSurchargeCredits.toString(),
        v.maxAiCostRatio,
        v.reservationMode,
        v.priceFromActionKey,
        v.enabled,
        version,
        v.effectiveFrom,
        input.adminId,
      ],
    );
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "pricing.price_book_version_published",
      targetType: "price_book",
      targetId: inserted.rows[0]?.id ?? null,
      metadata: {
        actionKey: v.actionKey,
        version,
        effectiveFrom: v.effectiveFrom.toISOString(),
      },
      ip: input.ip ?? null,
    });
    return { version };
  });
}

export interface PriceBookRowView {
  actionKey: string;
  version: number;
  baseCredits: string;
  multipliers: { efficient: string; professional: string; expert: string };
  instantSurchargeCredits: string;
  maxAiCostRatio: string;
  reservationMode: string;
  priceFromActionKey: string | null;
  enabled: boolean;
  effectiveFrom: Date;
  status: "in_effect" | "scheduled" | "superseded";
}

export async function listPriceBook(
  db: Queryable,
  now = new Date(),
): Promise<PriceBookRowView[]> {
  const r = await db.query<{
    action_key: string;
    version: number;
    base_credits: string;
    tier_multipliers: { efficient: string; professional: string; expert: string };
    instant_surcharge_credits: string;
    max_ai_cost_ratio: string;
    reservation_mode: string;
    price_from_action_key: string | null;
    enabled: boolean;
    effective_from: Date;
    in_effect_version: number | null;
  }>(
    `select p.action_key, p.version, p.base_credits::text, p.tier_multipliers,
            p.instant_surcharge_credits::text, p.max_ai_cost_ratio::text, p.reservation_mode,
            p.price_from_action_key, p.enabled, p.effective_from,
            (select max(version) from public.price_book q
              where q.action_key = p.action_key and q.effective_from <= $1) as in_effect_version
     from public.price_book p
     order by p.action_key, p.version desc`,
    [now],
  );
  return r.rows.map((x) => ({
    actionKey: x.action_key,
    version: x.version,
    baseCredits: x.base_credits,
    multipliers: x.tier_multipliers,
    instantSurchargeCredits: x.instant_surcharge_credits,
    maxAiCostRatio: x.max_ai_cost_ratio,
    reservationMode: x.reservation_mode,
    priceFromActionKey: x.price_from_action_key,
    enabled: x.enabled,
    effectiveFrom: x.effective_from,
    status:
      x.effective_from > now
        ? "scheduled"
        : x.version === x.in_effect_version
          ? "in_effect"
          : "superseded",
  }));
}

export const packSchema = z.object({
  /** Integer paise. Required: every pack is sold in India. */
  priceInrMinor: z.coerce.bigint().refine((v) => v >= 100n, "At least ₹1"),
  /**
   * Integer cents, optional. A pack with no dollar price is simply not offered outside
   * India — a state the price table expresses by having no row (ADR 0030). Prices are set
   * per currency and never converted from one another.
   */
  priceUsdMinor: z.coerce
    .bigint()
    .refine((v) => v >= 100n, "At least $1")
    .optional(),
  credits: z.coerce.bigint().refine((v) => v > 0n, "Must be positive"),
  bonusCredits: z.coerce.bigint().refine((v) => v >= 0n, "Must be zero or more"),
  sortOrder: z.coerce.number().int().min(0).max(1000),
});

export async function createPack(
  pool: Pool,
  input: { adminId: string; pack: z.infer<typeof packSchema>; ip?: string | null },
): Promise<string> {
  return withTransaction(pool, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `insert into public.credit_packs (credits_granted, bonus_credits, sort_order)
       values ($1, $2, $3) returning id`,
      [
        input.pack.credits.toString(),
        input.pack.bonusCredits.toString(),
        input.pack.sortOrder,
      ],
    );
    const id = r.rows[0]?.id ?? "";
    // One row per currency the pack is offered in. A pack with no USD price is simply not
    // sold abroad, which is a state worth being able to express (ADR 0030).
    await tx.query(
      `insert into public.credit_pack_prices (pack_id, currency, price_minor_ex_tax)
       values ($1, 'INR', $2)`,
      [id, input.pack.priceInrMinor.toString()],
    );
    if (input.pack.priceUsdMinor !== undefined) {
      await tx.query(
        `insert into public.credit_pack_prices (pack_id, currency, price_minor_ex_tax)
         values ($1, 'USD', $2)`,
        [id, input.pack.priceUsdMinor.toString()],
      );
    }
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: "pricing.pack_created",
      targetType: "credit_pack",
      targetId: id,
      metadata: {
        priceInrMinor: input.pack.priceInrMinor.toString(),
        priceUsdMinor: input.pack.priceUsdMinor?.toString() ?? null,
        credits: input.pack.credits.toString(),
        bonusCredits: input.pack.bonusCredits.toString(),
      },
      ip: input.ip ?? null,
    });
    return id;
  });
}

/** Packs are never edited: deactivate and create a replacement. Purchases snapshot the pack. */
export async function setPackActive(
  pool: Pool,
  input: { adminId: string; packId: string; active: boolean; ip?: string | null },
): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const r = await tx.query(`update public.credit_packs set active = $2 where id = $1`, [
      input.packId,
      input.active,
    ]);
    if (r.rowCount === 0) throw new RangeError("pack not found");
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: input.active ? "pricing.pack_activated" : "pricing.pack_deactivated",
      targetType: "credit_pack",
      targetId: input.packId,
      ip: input.ip ?? null,
    });
  });
}

export async function listPacks(db: Queryable) {
  const r = await db.query<{
    id: string;
    price_inr_minor: string | null;
    price_usd_minor: string | null;
    credits_granted: string;
    bonus_credits: string;
    active: boolean;
    sort_order: number;
  }>(
    // One row per pack with a column per currency: the console lists packs, and a
    // pack offered in one currency and not the other is a real and visible state.
    `select p.id,
            max(pp.price_minor_ex_tax) filter (where pp.currency = 'INR')::text as price_inr_minor,
            max(pp.price_minor_ex_tax) filter (where pp.currency = 'USD')::text as price_usd_minor,
            p.credits_granted::text, p.bonus_credits::text, p.active, p.sort_order
       from public.credit_packs p
       left join public.credit_pack_prices pp on pp.pack_id = p.id
      group by p.id
      order by p.active desc, p.sort_order, price_inr_minor`,
  );
  return r.rows;
}
