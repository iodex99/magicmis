-- 0071: the bar a chat_deep prompt must clear before it can be switched on (R-44, ADR 0077).
--
-- Deep had no eval, so it had no threshold, and the activation gate refuses a stage without one:
-- every Deep and Investigate message failed as a platform fault and released its hold. The eval
-- now exists (packages/ai/evals/deep.ts): each item is a whole query-and-answer conversation over
-- synthetic books, scored on whether the answer cites the right figure as the customer would see
-- it — the right scope, and every expected amount, count or name among the cells it cites.
--
--   chat_deep   0.90   set before any run, and not to be moved to fit one. Lower than Quick
--                      (0.92) because an item needs a correct query as well as a correct answer.
--                      Every figure is a cell of a query the customer can open, so a wrong one can
--                      be traced to the rows it came from; it is still a wrong figure.
insert into public.app_config (key, value, version)
select 'ai.eval_thresholds',
       (select value from public.app_config where key = 'ai.eval_thresholds'
         order by version desc limit 1)
       || jsonb_build_object('chat_deep', '0.90'),
       coalesce(max(version), 0) + 1
  from public.app_config where key = 'ai.eval_thresholds';
