-- GENERATED from packages/db/migrations/0045_accounts_has_password.sql. Do not edit.
-- 0045: an account may have no password (ADR 0043).
--
-- An account created through Google or Apple has nothing to type when a sensitive action asks
-- for the password again (SPEC §8). Rather than weaken that check for them, the product says
-- so and offers the emailed link that sets one. It needs to know which accounts those are,
-- and the identity provider does not expose whether a password exists — so the fact is kept
-- here, set false when such an account is provisioned and true the moment a password is set.
--
-- Every existing account signed up with a password.

alter table public.accounts add column has_password boolean not null default true;

-- Asking for a reset link is throttled like signing in (SPEC §8): it sends an email, and an
-- unthrottled endpoint that emails anyone on request is a way to harass them. A new config
-- version on top of whichever is current, not an edit: config is versioned.
insert into public.app_config (key, value, version)
select key,
       value || jsonb_build_object(
         'password_reset',
         jsonb_build_object('max_attempts', 5, 'window_seconds', 3600, 'lockout_seconds', 3600)
       ),
       version + 1
from public.app_config
where key = 'auth.throttle'
  and version = (select max(version) from public.app_config where key = 'auth.throttle')
on conflict (key, version) do nothing;
