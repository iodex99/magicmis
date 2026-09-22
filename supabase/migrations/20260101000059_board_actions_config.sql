-- GENERATED from packages/db/migrations/0059_board_actions_config.sql. Do not edit.
-- How many suggestions "Where to act" asks for (ADR 0062).
--
-- A limit, so it lives in config rather than in code (SPEC §0.5). Five is what a board reads in
-- one sitting; the stage refuses fewer than three and more than eight whatever this says, because
-- those are the schema's bounds and the schema is what the model is held to.
insert into public.app_config (key, value) values
  ('board_actions.max_actions', '5'::jsonb)
on conflict (key, version) do nothing;
