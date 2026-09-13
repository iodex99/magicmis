-- GENERATED from packages/db/migrations/0013_idempotency.sql. Do not edit.
-- 0013: request idempotency (SPEC §4: "API endpoints take an Idempotency-Key").
--
-- A retried POST with the same key must produce one effect and return the first
-- response. Keys are scoped (per account, or per IP before sign-in) so one tenant cannot
-- collide with, or probe, another's keys.
--
-- Responses that carry a secret -- freshly issued backup codes are the case today -- are
-- recorded WITHOUT a body (`body_stored = false`). Replaying such a request is refused
-- rather than re-served, so a plaintext secret is never persisted here: SPEC §8 requires
-- backup codes to be stored hashed, and this table must not become the exception.

create table public.idempotency_keys (
  scope           text not null,
  key             text not null check (length(key) between 8 and 200),
  -- SHA-256 of the canonical request body. Same key with a different body is a client
  -- bug, and must be rejected rather than silently answered with the first response.
  request_hash    text not null,
  status          text not null default 'in_progress'
                    check (status in ('in_progress', 'completed')),
  response_status integer,
  response_body   jsonb,
  body_stored     boolean not null default true,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,

  primary key (scope, key),
  constraint idempotency_completed_has_status
    check (status = 'in_progress' or response_status is not null)
);

create index idempotency_keys_created_idx on public.idempotency_keys (created_at);

alter table public.idempotency_keys enable row level security;
alter table public.idempotency_keys force row level security;
revoke all on public.idempotency_keys from anon, authenticated;
grant all on public.idempotency_keys to service_role;

-- Sign-in throttling for the product's own sign-in route, alongside Supabase's per-IP
-- auth limits. A new config version, not an edit of 0012's row: config is versioned.
insert into public.app_config (key, value, version)
select key,
       value || jsonb_build_object(
         'sign_in', jsonb_build_object('max_attempts', 10, 'window_seconds', 900, 'lockout_seconds', 900)
       ),
       2
from public.app_config
where key = 'auth.throttle' and version = 1
on conflict (key, version) do nothing;

insert into public.app_config (key, value) values
  ('api.idempotency_retention_hours', '48'::jsonb),
  -- An in-progress key older than this is assumed abandoned (the process died mid-request)
  -- and may be retried.
  ('api.idempotency_stale_seconds', '120'::jsonb)
on conflict (key, version) do nothing;
