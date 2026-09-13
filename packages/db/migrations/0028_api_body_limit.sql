-- SPEC §7, §30: JSON request bodies are refused above this size before they are read into memory or
-- parsed. It sits above the largest AI stage input (512 KB). Job completion, which carries the
-- snapshot and workbook, has its own limit derived from the snapshot and output caps.
-- TODO(review): R-48 — tune with the rate limits after load tests.
insert into public.app_config (key, value) values
  ('api.max_json_body_bytes', '2097152'::jsonb)
on conflict (key, version) do nothing;
