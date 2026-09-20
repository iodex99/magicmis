-- GENERATED from packages/db/migrations/0050_download_rate_limit.sql. Do not edit.
-- 0050: downloading your own files gets its own rate-limit bucket (ADR 0053).
--
-- `GET /api/uploads/:id` counted against `ai_per_account`, the bucket that limits how often an
-- account may start AI work. Downloading a stored file spends none of that budget, so a handful
-- of downloads could throttle the customer's own chat, and a burst of chat could stop them
-- fetching a file they had already paid to keep. The two are unrelated and now have unrelated
-- limits. The schema defaults this to 30 so an operator who has already edited the key is not
-- broken by the new field; this row makes it explicit.
insert into public.app_config (key, value, version)
select 'ratelimit.limits',
       (select value from public.app_config a
         where a.key = 'ratelimit.limits'
         order by a.version desc limit 1)
         || jsonb_build_object('download_per_account', 30),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'ratelimit.limits'
on conflict (key, version) do nothing;
