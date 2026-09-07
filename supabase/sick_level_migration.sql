-- Ember — sick_level migration (Sept 2026).
-- Splits the `sick` boolean into an ordinal so a mild illness and a major one stop
-- being the same observation. They are not one severity axis — they are different
-- states that happen to be ordered by impact — and collapsing them hid the milder
-- one entirely.
-- Idempotent: safe to paste into the Supabase SQL editor more than once.
--
-- The existing `sick` boolean is deliberately NOT touched, dropped, or backfilled.
-- From the cutover the evening flow keeps writing it as (sick_level >= 2), so it
-- goes on meaning what it has always meant — a major day — and light days do not
-- retroactively inflate the series. Earlier rows are undifferentiated by nature;
-- that limit is recorded in analysis/CONTEXT.md rather than papered over here.

alter table public.entries add column if not exists sick_level smallint
  check (sick_level between 0 and 2);
-- 0 = not sick
-- 1 = light (off, but the day still worked)
-- 2 = major (the day was lost to it)
--
-- Written from 2026-09-06 (SICK_LEVEL_START in src/lib/entries.ts). 0 is written
-- explicitly from that date, exactly like the confound flags: null means untracked,
-- not "not sick".
