/**
 * Account administration (SPEC §26): search, profile, wallet, lots, ledger, purchases,
 * invoices, login events; suspend or reactivate; credit adjustments with a reason.
 * Admins never see decrypted customer financial data here — only ids, names and billing.
 */

import { appendAudit } from "@magicmis/db/audit";
import { withTransaction, type Queryable } from "@magicmis/db/tx";
import type { Pool } from "pg";

export async function searchAccounts(db: Queryable, query: string) {
  const q = query.trim();
  const r = await db.query<{
    id: string;
    email: string;
    business_name: string;
    status: string;
    created_at: Date;
    balance: string | null;
  }>(
    `select a.id, a.email, a.business_name, a.status, a.created_at, w.balance_credits::text as balance
     from public.accounts a left join public.wallets w on w.account_id = a.id
     where $1 = '' or a.email ilike '%' || $1 || '%' or a.business_name ilike '%' || $1 || '%'
        or a.id::text = $1
     order by a.created_at desc limit 50`,
    [q.replace(/[%_\\]/gu, (c) => `\\${c}`)],
  );
  return r.rows;
}

export async function accountDetail(db: Queryable, accountId: string) {
  const account = await db.query<{
    id: string;
    email: string;
    business_name: string;
    gstin: string | null;
    state_code: string;
    status: string;
    created_at: Date;
  }>(
    `select id, email, business_name, gstin, state_code, status, created_at from public.accounts where id = $1`,
    [accountId],
  );
  const row = account.rows[0];
  if (row === undefined) return null;
  const [companies, logins, ledger] = await Promise.all([
    db.query<{ name: string; lifecycle_state: string }>(
      `select name, lifecycle_state from public.companies where account_id = $1 and deleted_at is null order by name`,
      [accountId],
    ),
    db.query<{
      event_type: string;
      ip: string | null;
      user_agent: string | null;
      created_at: Date;
    }>(
      `select event_type, host(ip) as ip, user_agent, created_at from public.login_events
       where account_id = $1 order by created_at desc limit 20`,
      [accountId],
    ),
    db.query<{
      seq_text: string;
      entry_type: string;
      amount: string;
      balance_after: string;
      held_after: string;
      created_at: Date;
    }>(
      `select seq::text as seq_text, entry_type, amount::text, balance_after::text, held_after::text, created_at
       from public.credit_ledger where account_id = $1 order by seq desc limit 100`,
      [accountId],
    ),
  ]);
  return {
    account: row,
    companies: companies.rows,
    logins: logins.rows,
    ledger: ledger.rows,
  };
}

export async function setAccountStatus(
  pool: Pool,
  input: {
    adminId: string;
    accountId: string;
    status: "active" | "suspended";
    reason: string;
    ip?: string | null;
  },
): Promise<void> {
  if (input.reason.trim().length < 5) throw new RangeError("a reason is required");
  await withTransaction(pool, async (tx) => {
    // Suspension also ends the customer's session (SPEC §8 single session).
    const r = await tx.query(
      `update public.accounts set status = $2,
         active_session_id = case when $2 = 'suspended' then null else active_session_id end
       where id = $1 and status <> 'deleted'`,
      [input.accountId, input.status],
    );
    if (r.rowCount === 0) throw new RangeError("account not found");
    await appendAudit(tx, {
      actorType: "admin",
      actorId: input.adminId,
      action: input.status === "suspended" ? "account.suspended" : "account.reactivated",
      targetType: "account",
      targetId: input.accountId,
      metadata: { reason: input.reason.trim() },
      ip: input.ip ?? null,
    });
  });
}

export async function pendingBankTransfers(db: Queryable) {
  const r = await db.query<{
    id: string;
    account_id: string;
    business_name: string;
    email: string;
    total_paise: string;
    credits: string;
    bonus_credits: string;
    bank_transfer_requested_at: Date | null;
    proforma_number: string | null;
  }>(
    `select p.id, p.account_id, a.business_name, a.email, p.total_paise::text, p.credits::text,
            p.bonus_credits::text, p.bank_transfer_requested_at, i.number as proforma_number
     from public.purchases p
     join public.accounts a on a.id = p.account_id
     left join public.invoices i on i.purchase_id = p.id and i.type = 'proforma'
     where p.method = 'bank_transfer' and p.status = 'pending'
     order by p.bank_transfer_requested_at`,
  );
  return r.rows;
}
