-- Ember — check-in v3 migration (Nov 2026).
-- Adds a one-tap workout type to the evening gym step and an optional weekly
-- reflection asked only on Sunday evenings.
-- Idempotent: safe to paste into the Supabase SQL editor more than once.
-- Run it BEFORE deploying the matching app version: the evening save writes these
-- columns from WORKOUT_TYPE_START / WEEKLY_REFLECTION_START, and an upsert naming
-- a column that doesn't exist fails the whole save.

alter table public.entries add column if not exists workout_type text
  check (workout_type in ('upper', 'lower', 'run', 'other'));
-- Asked only when gym_actual = 'yes', from WORKOUT_TYPE_START in src/lib/entries.ts.
-- Null on a gym day before that date = untracked; null on a 'no' day = not
-- applicable. Nullable, no default — same rule as every tracked field.

alter table public.entries add column if not exists week_best text;
alter table public.entries add column if not exists week_struggle text;
-- Free text on the Sunday row only (the Mon–Sun week that day closes), from
-- WEEKLY_REFLECTION_START. Both optional: null means skipped or not a Sunday.
