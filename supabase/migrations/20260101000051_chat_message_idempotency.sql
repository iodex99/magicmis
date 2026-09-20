-- GENERATED from packages/db/migrations/0051_chat_message_idempotency.sql. Do not edit.
-- 0051: one chat message per idempotency key (ADR 0053).
--
-- `sendMessage` inserted a fresh `chat_messages` row on every call while keying the credit hold
-- on the client's idempotency key. A retry — which the client makes whenever a slow Deep answer
-- looks stuck, and `api.idempotency_stale_seconds` is 120 against the chat route's own 120-second
-- ceiling — therefore inserted a second message and was handed the first message's reservation
-- back as a duplicate. Both ran the model: two answers in the thread, one charge, two lots of
-- vendor spend against one price cap, and the second capture throwing on a reservation the first
-- had already settled.
--
-- `jobs` has had `unique (account_id, idempotency_key)` from the start, which is exactly why the
-- same retry is harmless there. Chat now has it too.
alter table public.chat_messages add column if not exists idempotency_key text;

-- Only user messages carry one; assistant replies are written by the server in response.
create unique index if not exists chat_messages_idempotency_idx
  on public.chat_messages (account_id, idempotency_key)
  where idempotency_key is not null;
