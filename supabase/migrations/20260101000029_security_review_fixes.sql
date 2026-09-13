-- GENERATED from packages/db/migrations/0029_security_review_fixes.sql. Do not edit.
-- Phase 9 security review fixes (ADR 0024).

-- Break-glass reasons are capped where the customer notice template caps them, so a grant can never
-- exist whose notice would be rejected (and the account holder never told).
alter table public.break_glass_grants
  add constraint break_glass_reason_length check (char_length(reason) <= 500);

-- Rate-limit counters are pruned by window by a scheduled task (`ratelimit-prune`), not per request.
create index rate_limit_counters_window_idx on public.rate_limit_counters (window_start);
