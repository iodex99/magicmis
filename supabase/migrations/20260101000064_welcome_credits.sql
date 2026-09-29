-- GENERATED from packages/db/migrations/0064_welcome_credits.sql. Do not edit.
-- 0064: every new account starts with welcome credits (ADR 0068).
--
-- Locked decision 3 said nothing is free. The owner amended it: a new account gets a one-time
-- grant of credits when it is first signed in to, enough to set up one company on its own books
-- and ask a few questions. Every action is still held and captured like any other; the credits
-- simply did not come from a purchase.
--
-- The decision is made once per account and recorded here, whether it was granted or withheld,
-- so it can never be made twice and an operator can see why an account started with nothing.

alter table public.credit_lots drop constraint credit_lots_source_check;
alter table public.credit_lots add constraint credit_lots_source_check
  check (source in ('purchase', 'bonus', 'admin_grant', 'goodwill', 'welcome'));

create table public.welcome_credits (
  account_id  uuid primary key references public.accounts (id),
  outcome     text not null check (outcome in ('granted', 'withheld')),
  -- Why it was withheld: an account that existed before the offer, the offer switched off,
  -- a throwaway email address, or too many new accounts from one network.
  reason      text check (
                reason in ('existing_account', 'offer_off', 'disposable_email', 'network_limit')),
  credits     bigint not null default 0 check (credits >= 0),
  lot_id      uuid references public.credit_lots (id),
  decided_at  timestamptz not null default now(),
  constraint welcome_credits_reason_iff_withheld
    check ((outcome = 'withheld') = (reason is not null)),
  constraint welcome_credits_granted_has_credits
    check ((outcome = 'granted' and credits > 0) or (outcome = 'withheld' and credits = 0))
);

comment on table public.welcome_credits is
  'One welcome-credit decision per account, made at its first sign-in (ADR 0068).';

-- Internal: nothing customer-facing reads it (the customer sees the lot in their wallet).
alter table public.welcome_credits enable row level security;
alter table public.welcome_credits force row level security;
revoke all on public.welcome_credits from anon, authenticated;
grant all on public.welcome_credits to service_role;

-- Accounts that exist today were not offered welcome credits when they signed up. They are
-- recorded as decided, so the offer reaches new accounts only.
insert into public.welcome_credits (account_id, outcome, reason, credits)
select id, 'withheld', 'existing_account', 0 from public.accounts
on conflict (account_id) do nothing;

-- The grant, in credits. Zero switches the offer off. Admin-editable (the wallet. prefix).
insert into public.app_config (key, value) values
  ('wallet.welcome_credits', '1500'::jsonb)
on conflict (key, version) do nothing;

-- Throwaway-address services. An address at one of these, or at a subdomain of one, gets no
-- welcome credits; the account itself works as normal. Admin-editable.
insert into public.app_config (key, value) values
  ('wallet.welcome_blocked_email_domains', '[
     "10minutemail.com", "10minutemail.net", "burnermail.io", "crazymailing.com",
     "discard.email", "dispostable.com", "emailfake.com", "emailondeck.com", "fakeinbox.com",
     "getnada.com", "grr.la", "guerrillamail.com", "guerrillamail.info", "guerrillamail.net",
     "inboxkitten.com", "mailcatch.com", "maildrop.cc", "mailinator.com", "mailnesia.com",
     "mailpoof.com", "mintemail.com", "mohmal.com", "moakt.com", "mytemp.email", "nada.email",
     "sharklasers.com", "spam4.me", "spamgourmet.com", "temp-mail.org", "tempinbox.com",
     "tempmail.com", "tempmail.net", "tempmailo.com", "tempr.email", "throwawaymail.com",
     "trashmail.com", "trashmail.de", "yopmail.com", "yopmail.fr"
   ]'::jsonb)
on conflict (key, version) do nothing;

-- At most three grants per network in thirty days, counted by the same throttle that guards
-- sign-up. A new version on top of whichever is current: config is versioned.
insert into public.app_config (key, value, version)
select key,
       value || jsonb_build_object(
         'welcome',
         jsonb_build_object('max_attempts', 3, 'window_seconds', 2592000, 'lockout_seconds', 2592000)
       ),
       version + 1
from public.app_config
where key = 'auth.throttle'
  and version = (select max(version) from public.app_config where key = 'auth.throttle')
on conflict (key, version) do nothing;
