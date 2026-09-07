-- Ember — focused_work scale migration (Sept 2026).
-- Splits the open-ended top bucket. `deep` meant "3h+", so an evening of homework
-- and a pre-exam day were the same observation — the compression this field exists
-- to measure. `deep` is now 3–5h and a new `heavy` carries 5h+.
-- Idempotent: safe to paste into the Supabase SQL editor more than once.
--
-- Existing rows are deliberately NOT rewritten. The 1h and 3h cut points are
-- unchanged, so every `none` / `light` / `solid` row is still exactly correct on
-- the new scale. Pre-cutover `deep` rows stay truthful too — they mean "≥3h,
-- unresolved above 3", never a claim of 3–5h. That is why the new level went on
-- top: reusing `deep` for 5h+ would have made every older row assert a 5h+ day it
-- was never rated as. Splitting those rows across the new boundary by any rule
-- would manufacture observations that were never made (same rule as social_level
-- and sick_level); the limit is recorded in analysis/CONTEXT.md instead.

do $$
declare c text;
begin
  -- Drop by lookup rather than by name: the original constraint was created
  -- inline by `add column`, so its name is Postgres's choice, not ours.
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'entries'
      and con.contype = 'c'
      and pg_get_constraintdef(con) like '%focused_work%'
  loop
    execute format('alter table public.entries drop constraint %I', c);
  end loop;
end $$;

alter table public.entries add constraint entries_focused_work_check
  check (focused_work in ('none', 'light', 'solid', 'deep', 'heavy'));
-- none  = no focused work
-- light = under 1h
-- solid = 1–3h
-- deep  = 3–5h   (meant 3h+ on rows before 2026-09-06)
-- heavy = 5h+    (written from 2026-09-06)
--
-- Still nullable, and null still means untracked: the evening flow only asks from
-- FOCUSED_WORK_START (2026-08-15) in src/lib/entries.ts.
