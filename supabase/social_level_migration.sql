-- Ember — social_level migration (Sept 2026).
-- Adds an ordinal social scale alongside the existing `social` boolean. A yes/no
-- carries too little resolution to work as a predictor, so it is superseded here.
-- Idempotent: safe to paste into the Supabase SQL editor more than once.
--
-- The existing `social` boolean is deliberately NOT touched, dropped, or
-- backfilled. Those rows were never rated at this resolution, and deriving a level
-- from a boolean would manufacture ~110 days of observations that were never made
-- (same rule as mac_minutes' 0-vs-null). Null here means untracked, exactly as it
-- does for the confound flags.

alter table public.entries add column if not exists social_level smallint
  check (social_level between 0 and 3);
-- 0 = none
-- 1 = passing (roommates around, someone in class)
-- 2 = a real hang
-- 3 = most of the day
--
-- Written from 2026-09-06 (SOCIAL_LEVEL_START in src/lib/entries.ts). From that
-- date the evening flow also keeps writing `social` = (social_level > 0) so the
-- binary series stays continuous across the transition.
