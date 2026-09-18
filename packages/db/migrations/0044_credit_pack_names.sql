-- 0044: credit packs have names (ADR 0041).
--
-- The pricing page sells packs as tiers, and a tier needs something to be called. The name
-- lives with the pack, admin-editable like everything else about it, rather than in a
-- lookup keyed on credit counts in application code (SPEC §0.5).
--
-- Nullable: a pack created before this, or without one, is shown by its credit count.

alter table public.credit_packs add column name text
  constraint credit_packs_name_length check (name is null or char_length(name) between 1 and 40);

update public.credit_packs
   set name = case credits_granted
     when   2000 then 'Starter'
     when   5000 then 'Plus'
     when  10000 then 'Growth'
     when  25000 then 'Practice'
     when  50000 then 'Firm'
     when 100000 then 'Scale'
   end
 where credits_granted in (2000, 5000, 10000, 25000, 50000, 100000) and name is null;
