-- GENERATED from packages/db/migrations/0035_password_only_sign_in.sql. Do not edit.
-- Customer sign-in becomes password-only (ADR 0028), directed by the product owner.
--
-- The customer's second factor and everything that existed to recover it go with it:
-- backup codes, and the admin-operated account-recovery flow whose only purpose was
-- resetting a lost authenticator. Nothing here touches the ADMIN console, which keeps its
-- own TOTP: that is the operator surface with break-glass access to customer data.
--
-- The tables are dropped rather than left in place. Neither can be written to again, and a
-- table nobody can add a row to is a worse record than none: it invites the reader to think
-- the feature still exists. Both are pre-launch and hold no customer data.

drop table if exists public.backup_codes;
drop table if exists public.account_recoveries;

-- Config the recovery flow read. `admin.break_glass_*` keys stay: break-glass is unrelated.
delete from public.app_config
 where key in ('admin.recovery_hold_hours', 'admin.recovery_second_admin');
