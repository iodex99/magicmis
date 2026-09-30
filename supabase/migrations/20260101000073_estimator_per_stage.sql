-- GENERATED from packages/db/migrations/0073_estimator_per_stage.sql. Do not edit.
-- 0073: characters per token, per stage (R-30, ADR 0077).
--
-- 0072 set one figure, 2.0, the densest stage measured. Review found the cost of that: sheet
-- recognition is most of a company setup's estimate and tokenises at 2.76, so counting it at 2.0
-- over-stated a setup by about a third and moved the point where a setup asks for a quote from
-- about 45 sheets to 39. Each measured stage now has its own figure, rounded down so none is
-- under-counted; 1.9 covers any stage not yet measured.
--
--   sheet_classification 2.76 → 2.7 · commentary 2.29 → 2.2 · column_mapping 2.09 → 2.0
--   reference_layout 2.08 → 2.0 · ledger_mapping 2.00 → 1.9
--
-- Merged into the current value, so a setting an operator has changed since 0072 is kept.
insert into public.app_config (key, value, version)
select 'ai.estimator',
       (select value from public.app_config where key = 'ai.estimator'
         order by version desc limit 1)
       || jsonb_build_object(
            'chars_per_token', '1.9',
            'chars_per_token_by_stage', jsonb_build_object(
              'sheet_classification', '2.7',
              'commentary', '2.2',
              'column_mapping', '2.0',
              'reference_layout', '2.0',
              'ledger_mapping', '1.9'
            )
          ),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'ai.estimator';
