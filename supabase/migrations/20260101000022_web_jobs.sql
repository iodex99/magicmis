-- GENERATED from packages/db/migrations/0022_web_jobs.sql. Do not edit.
-- Phase 6 web job flow (SPEC §23, §24.1): upload caps for completion payloads.

insert into public.app_config (key, value) values
  -- Largest workbook the browser may upload at job completion (sealed before storage).
  ('outputs.max_upload_bytes', '26214400'::jsonb)
on conflict (key, version) do nothing;
