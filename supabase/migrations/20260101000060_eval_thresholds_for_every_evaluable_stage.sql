-- GENERATED from packages/db/migrations/0060_eval_thresholds_for_every_evaluable_stage.sql. Do not edit.
-- Eval thresholds for every stage the harness can score (R-28).
--
-- `activatePromptVersion` refuses a stage with no threshold, so five of the seven evaluable
-- stages could not have been activated at any accuracy: reference_layout, commentary,
-- chat_quick, chat_edit and thread_summary had no entry at all. This adds them, and leaves the
-- three that were already set alone.
--
-- A threshold is not a round number picked for comfort. Each one below is set from what the
-- stage costs when it is wrong, and from whether anything downstream catches the mistake:
--
--   sheet_classification 0.95  unchanged. A misread sheet is set aside, not silently wrong.
--   column_mapping       0.90  unchanged. Header rules do most of it; AI sees the remainder.
--   ledger_mapping       0.85  unchanged. The customer reviews every mapped row before use.
--
--   reference_layout     0.85  the same standing as ledger_mapping and for the same reason:
--                              the customer reviews every bound row in the recreated MIS
--                              before a figure is published, so a miss costs a correction
--                              rather than a wrong report.
--
--   commentary           0.98  scored by the V12 post-check, which asks a yes/no question:
--                              did every quantity come through a placeholder. That is a rule
--                              the model either follows or breaks, not a judgement, so the bar
--                              is near the top. Locked decision 7 is the product's whole
--                              claim; 2% is the room left for a run to be retried, not for
--                              prose to be wrong. Prose quality is a person's call (R-38).
--
--   chat_edit            0.95  a wrong pointer edits the wrong box on a customer's own saved
--                              layout, and the layout is kept for good (ADR 0045). Undo exists
--                              but the damage is visible first, so this sits high.
--
--   chat_quick           0.92  the scope call. An in-scope question wrongly refused is a
--                              charged non-answer; an out-of-scope one answered is the product
--                              giving tax advice. Both are bad, and neither is caught
--                              downstream — but the set deliberately includes questions the
--                              facts pack cannot answer, where the right reply is "the facts
--                              do not cover this", and a model may reasonably read a few of
--                              those as refusals. 0.92 leaves room for that without leaving
--                              room for an injection to land.
--
--   thread_summary       0.90  the summary only carries history forward under the round cap.
--                              A weak one costs context on later turns; it never reaches a
--                              customer as a figure, because it is scored on the same
--                              placeholder rule and is never itself an answer.
--
-- TODO(review): R-28 — these are reasoned, not measured. Revisit each against the first live
-- run: a stage that clears its bar by a wide margin on every tier is set too low.
insert into public.app_config (key, value, version)
select 'ai.eval_thresholds',
       jsonb_build_object(
         'sheet_classification', '0.95',
         'column_mapping', '0.90',
         'ledger_mapping', '0.85',
         'reference_layout', '0.85',
         'commentary', '0.98',
         'chat_edit', '0.95',
         'chat_quick', '0.92',
         'thread_summary', '0.90'
       ),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'ai.eval_thresholds';
