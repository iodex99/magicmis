-- Phase 8 (SPEC §27): chat message pricing and the Deep query loop.

-- A user message records the tier and exact price it was sold at; the assistant reply points back.
alter table public.chat_messages
  add column tier           text check (tier in ('efficient', 'professional', 'expert')),
  add column price_credits  bigint check (price_credits is null or price_credits >= 0),
  add column reply_to       uuid references public.chat_messages(id) on delete cascade,
  add column failure_reason text;

create index chat_messages_reply_idx on public.chat_messages (reply_to) where reply_to is not null;

-- A capped thread continues in a new one, seeded with a summary of the old (SPEC §27).
alter table public.chat_threads
  add column continues_thread_id uuid references public.chat_threads(id) on delete set null;

-- One row per `run_query` round. SQL, purpose and the redacted result are sealed under the
-- company key; the result is kept so `{{q:…}}` placeholders resolve with lineage.
alter table public.chat_query_steps
  add column step_ref    text check (step_ref ~ '^q[0-9]{1,2}$'),
  add column tool_use_id text,
  add column purpose     bytea,
  add column result      bytea,
  add column status      text not null default 'pending'
    check (status in ('pending', 'ok', 'rejected', 'error'));

-- Chat max_tokens sized to each message's AI cost cap (price × max_ai_cost_ratio). The runtime
-- cap projects input at full price plus max_tokens at the output price; with the 0019 values a
-- professional Quick call (Sonnet 5, 8000 tokens) projected about ₹8 against a ₹3.80 cap and could
-- never run. Answers are a few short paragraphs; a Deep round is one tool call.
-- TODO(review): R-42 — chat prices against worst-case Deep cost.
insert into public.tier_routing (tier, stage, model_id, effort, max_tokens, fallback_chain, prompt_version, version)
select tier, stage, model_id, effort,
       case stage when 'chat_quick' then 1500 when 'chat_deep' then 1500 when 'chat_edit' then 2000 else 1000 end,
       fallback_chain, prompt_version, version + 1
from public.tier_routing r
where stage in ('chat_quick', 'chat_deep', 'chat_edit', 'thread_summary')
  and version = (select max(version) from public.tier_routing x where x.tier = r.tier and x.stage = r.stage)
on conflict (tier, stage, version) do nothing;

insert into public.app_config (key, value) values
  -- Tool rounds per Deep message, enforced on the server; at the cap the model must answer.
  ('chat.max_rounds', '5'::jsonb),
  -- Messages per thread before it is capped and a new thread starts from a summary.
  ('chat.thread_message_cap', '20'::jsonb),
  -- Facts the Quick retriever may send.
  ('chat.quick_max_facts', '60'::jsonb),
  -- Browser query timeout for Deep rounds.
  ('chat.query_timeout_ms', '10000'::jsonb),
  -- Longest user question accepted.
  ('chat.max_question_chars', '2000'::jsonb)
on conflict (key, version) do nothing;
