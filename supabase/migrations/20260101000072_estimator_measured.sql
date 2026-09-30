-- GENERATED from packages/db/migrations/0072_estimator_measured.sql. Do not edit.
-- 0072: the job cost estimator's constants, measured rather than guessed (R-30, ADR 0077).
--
-- The estimator turns a job's size into tokens and prices them at the routed model; the p90 of
-- that decides whether a job runs at its standard price or asks for a quote. Its seeds (migration
-- 0019) were guesses. The live-eval recordings hold the exact usage of real requests, and
-- replaying the datasets rebuilds those requests locally, so both constants can be measured
-- without a call:
--
--   characters per token (prompt, payload, schema)   measured      was 3.2 / 1.30 = 2.46
--     sheet_classification                            2.76
--     commentary                                      2.29
--     column_mapping                                  2.09
--     reference_layout                                2.08
--     ledger_mapping                                  2.00
--   → 2.0 with no separate inflation: the densest stage, so no stage is under-counted. At 2.46
--     column and ledger mapping were under-counted by 15-19% and commentary by 7%.
--
--   output tokens per input token (mean over every recorded call)      was 0.35 for all
--     sheet_classification 0.047 · column_mapping 0.098 · reference_layout 0.114
--     ledger_mapping 0.410 · commentary 0.453
--   → per stage, rounded up; 0.35 stays for a stage not yet measured.
--
-- The p90 multiplier stays at 1.6: the measured p90 of each stage's output ratio sits 1.2 to 1.5
-- times its mean, inside it. Nightly calibration from real jobs still raises any p90 it finds
-- higher (`recalibrateEstimator`).
insert into public.app_config (key, value, version)
select 'ai.estimator',
       jsonb_build_object(
         'chars_per_token', '2.0',
         'tokenizer_inflation', '1.00',
         'output_tokens_ratio', '0.35',
         'output_tokens_ratio_by_stage', jsonb_build_object(
           'sheet_classification', '0.05',
           'column_mapping', '0.10',
           'reference_layout', '0.12',
           'ledger_mapping', '0.42',
           'commentary', '0.46'
         ),
         'p90_multiplier', '1.6',
         'calibration_window_days', 90
       ),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'ai.estimator';
