-- 0043: credits never expire (ADR 0040).
--
-- Expiry made a prepaid balance a wasting asset, which is a reason not to buy a larger pack
-- — the opposite of what prepaid credits are for. It is removed rather than lengthened: a
-- validity period that is merely long still has to be explained, chased with notices, and
-- defended when someone loses credits to it.
--
-- `expires_at` is kept and made nullable rather than dropped. Lots already written stay
-- addressable, and the `expire` entries already in `credit_ledger` remain valid rows — the
-- ledger is append-only and hash-chained, so rewriting its history is not available to us
-- and would not be desirable if it were. Every lot, past and future, now carries null.

alter table public.credit_lots alter column expires_at drop not null;

update public.credit_lots set expires_at = null where expires_at is not null;

-- Nothing reads these any more: the sweeper and the notice job are gone.
delete from public.app_config
 where key in ('wallet.lot_validity_months', 'wallet.lot_expiry_notice_days');

-- The FIFO index existed to serve "earliest expiry first". The order is now simply age,
-- which is what both the wallet screen and the terms have always promised.
drop index if exists public.credit_lots_fifo_idx;
create index credit_lots_fifo_idx on public.credit_lots (account_id, created_at)
  where credits_remaining > 0;
