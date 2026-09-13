-- Phase 3 ingestion limits (SPEC §15) and outbound payload caps (SPEC §14). Admin-editable.
insert into public.app_config (key, value) values
  ('ingest.limits', '{
     "max_file_bytes": 104857600,
     "max_session_bytes": 262144000,
     "max_files_per_job": 30,
     "zip_max_entries": 10000,
     "zip_max_uncompressed_bytes": 1073741824,
     "zip_max_ratio": 200
   }'::jsonb),
  ('ai.payload_caps', '{
     "sample_rows_per_sheet": 15,
     "distinct_values_per_column": 500,
     "chat_rows_per_round": 50,
     "chat_bytes_per_round": 16384,
     "snapshot_upload_bytes": 5242880
   }'::jsonb)
on conflict (key, version) do nothing;
