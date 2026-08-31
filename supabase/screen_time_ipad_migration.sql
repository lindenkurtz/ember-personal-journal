-- Ember — screen_time iPad split (August 2026).
-- Mac time is now tracked in a separate system, so the weekly entry asks for iPad
-- minutes alone instead of a combined Mac + iPad number. `computer_minutes` is
-- RETIRED, not dropped: the column and its rows stay put (same treatment as the
-- deep_work_* columns), the app just stops reading and writing it. The two are
-- not comparable, so nothing is backfilled — ipad_minutes starts null on every
-- historical row on purpose.
-- Idempotent: safe to paste into the Supabase SQL editor more than once.

alter table public.screen_time
  add column if not exists ipad_minutes integer check (ipad_minutes between 0 and 1440);
