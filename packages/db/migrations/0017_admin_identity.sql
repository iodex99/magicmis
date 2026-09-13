-- SPEC §26 admin identity (ADR 0015).

-- The TOTP secret is sealed under its own DEK (packages/crypto); the wrapped DEK and the
-- master key version sit beside it so the secret can be opened and the DEK re-wrapped.
alter table public.admin_users
  add column totp_key_wrapped bytea,
  add column totp_key_version text,
  -- RFC 6238 §5.2: a code is accepted once. The last accepted time step is remembered.
  add column totp_last_step bigint not null default 0;

update public.admin_users set totp_key_wrapped = '\x'::bytea, totp_key_version = 'none'
  where totp_key_wrapped is null;
alter table public.admin_users
  alter column totp_key_wrapped set not null,
  alter column totp_key_version set not null;

create index admin_sessions_active_idx on public.admin_sessions (token_hash)
  where revoked_at is null;

insert into public.app_config (key, value) values
  ('admin.login_max_failures', '5'::jsonb),
  ('admin.login_lockout_seconds', '900'::jsonb)
on conflict (key, version) do nothing;
