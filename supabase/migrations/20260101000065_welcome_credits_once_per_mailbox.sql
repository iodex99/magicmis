-- GENERATED from packages/db/migrations/0065_welcome_credits_once_per_mailbox.sql. Do not edit.
-- 0065: welcome credits once per mailbox, and a pace that defers rather than refuses (ADR 0068).
--
-- Review of 0064 found three ways the offer could be collected again or denied unfairly:
--  - a person could delete their account and sign up again with the same address, or use
--    `name+1@gmail.com`, `n.ame@gmail.com` and the like, each a new account reaching one inbox;
--  - a network over its monthly share was withheld for good, so a real customer who first signed
--    in behind a crowded office or mobile address lost the offer permanently;
--  - accounts created but never signed in to when 0064 ran were marked as existing customers.

-- A one-way fingerprint of the mailbox an address reaches, kept with the decision. Accounts are
-- never hard-deleted, so it outlives an account's deletion and the overwriting of its address.
alter table public.welcome_credits add column mailbox_digest text;

-- One grant per mailbox, whatever races. The decision also takes a lock on the mailbox, so this
-- is the guarantee behind it rather than the usual path.
create unique index welcome_credits_one_grant_per_mailbox
  on public.welcome_credits (mailbox_digest)
  where outcome = 'granted' and mailbox_digest is not null;

-- A network over its share is now deferred and recorded nowhere, so `network_limit` is no longer
-- a reason a decision can carry; a mailbox that already had its grant is. An account withheld for
-- it until now is undecided again, and its next sign-in decides, as it would have under this rule.
delete from public.welcome_credits where reason = 'network_limit';
alter table public.welcome_credits drop constraint welcome_credits_reason_check;
alter table public.welcome_credits add constraint welcome_credits_reason_check
  check (reason in ('existing_account', 'offer_off', 'disposable_email', 'mailbox_already_granted'));

-- An account nobody has ever signed in to was not a customer when 0064 ran: its first sign-in
-- decides, as for any other new account.
delete from public.welcome_credits w
 where w.outcome = 'withheld' and w.reason = 'existing_account'
   and not exists (
     select 1 from public.login_events e where e.account_id = w.account_id and e.event_type = 'login'
   );

-- No more than this many grants across the whole platform in a day, whatever the addresses: a
-- ceiling on what the offer can cost if every other check is got around. Past it, grants wait.
insert into public.app_config (key, value, version)
select key,
       value || jsonb_build_object(
         'welcome_global',
         jsonb_build_object('max_attempts', 300, 'window_seconds', 86400, 'lockout_seconds', 86400)
       ),
       version + 1
from public.app_config
where key = 'auth.throttle'
  and version = (select max(version) from public.app_config where key = 'auth.throttle')
on conflict (key, version) do nothing;
