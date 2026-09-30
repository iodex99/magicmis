-- 0070: the operating exchange rate (R-14).
--
-- `ai.fx` converts what the AI vendor bills in dollars into rupees for the margin report and the
-- cost cap. It never touches a customer's price: prices are set per currency and never converted
-- (ADR 0030). Seeded at 95.00; the RBI reference rate was 95.968 on 2026-09-28 and the market
-- traded near 96.15 the next day, so the operating rate is 96.00. The 3% buffer stays, which puts
-- the effective rate at 98.88: vendor cost is read slightly high, so a margin figure errs on the
-- side of caution. Every AI call records the rate it used (`ai_calls.fx_rate_used`), so this
-- changes new calls only. An operator moves it from the admin console as the rupee moves.

insert into public.app_config (key, value, version)
select 'ai.fx',
       jsonb_build_object('inr_per_usd', '96.00', 'buffer_percent', '3'),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'ai.fx';
