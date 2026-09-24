-- Thresholds for the two stages that had no eval at all (R-28).
--
-- `board_actions` and `dashboard_layout` are the two customer-facing buttons that still fail as
-- platform faults, because a stage with no threshold is refused at activation whatever it scores.
-- Both now have datasets, so both need a bar.
--
--   board_actions    0.98  the same standing as commentary and for the same reason: the score is
--                          a yes/no question the stage's own check already asked — every field
--                          the model wrote ran through the placeholder check, and each action
--                          carries a step. A stage either keeps that rule or breaks it. It is
--                          also the one place the product gives advice to a board, so "not tax,
--                          legal or audit advice" has to hold every time, not almost every time.
--
--   dashboard_layout 0.95  a miss costs less than the others: the run keeps DEFAULT_DASHBOARD
--                          rather than failing, and the customer can change any box by chatting
--                          (ADR 0056). But it is the first thing they see, and a board built on
--                          metrics the company does not hold reads as a broken product, so this
--                          sits above the mapping stages and below commentary's near-certainty.
--
-- TODO(review): R-28 — reasoned, not measured. Revisit against the first runs.
insert into public.app_config (key, value, version)
select 'ai.eval_thresholds',
       (select value from public.app_config where key = 'ai.eval_thresholds'
         order by version desc limit 1)
       || jsonb_build_object('board_actions', '0.98', 'dashboard_layout', '0.95'),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'ai.eval_thresholds';
