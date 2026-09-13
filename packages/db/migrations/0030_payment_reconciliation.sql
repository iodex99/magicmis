-- R-51: Razorpay purchases still unpaid after `after_minutes` are checked against Razorpay directly
-- (worker `billing-reconcile`) and credited through the webhook path when a captured payment exists.
-- Orders older than `max_age_days` are left to a person (docs/runbooks/payment-webhook-outage.md).
-- TODO(review): R-51 — confirm the window with the Razorpay settlement and refund policy.
insert into public.app_config (key, value) values
  ('billing.reconcile', '{"after_minutes": 30, "max_age_days": 7, "batch_size": 50}'::jsonb)
on conflict (key, version) do nothing;
