-- 0085: share links kept in bounds (ADR 0091).
--
-- 1. The opening log is a fact the owner reads, so it is append-only as `source_upload_reads` is
--    (migration 0055): no role a server query runs as may edit, delete or truncate it. Deleting a
--    link still takes its openings with it, because a cascade runs as the table's owner.
revoke update, delete, truncate on public.share_link_views from anon, authenticated, service_role;

-- 2. How many links a company may have live at once, each a sealed copy of its whole board made
--    at no charge; and how long a link that has expired or been withdrawn is kept, with its
--    openings, before it is deleted. Admin-editable (SPEC §0.5).
insert into public.app_config (key, value) values
  ('share.max_active_links', '20'::jsonb),
  ('share.retention_days', '90'::jsonb)
on conflict (key, version) do nothing;
