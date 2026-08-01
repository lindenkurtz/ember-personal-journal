-- Push RLS backfill.
--
-- push_subscriptions and push_settings were created (see README) with RLS
-- implied but no explicit anon policies — every other table has them via the
-- finance/tracking_v2 migrations. With RLS on and no INSERT policy, the SPA's
-- publishable key (which authenticates as `anon`) can create a browser push
-- subscription but silently fails to write the row into push_subscriptions:
-- the Settings toggle never flips on (the persist throws) and the cron Worker
-- finds no subscription to send to. This makes both tables match the documented
-- pattern in CLAUDE.md: anon gets SELECT + INSERT + UPDATE (+ DELETE where the
-- SPA deletes). The cron Worker uses the secret key and bypasses RLS.
--
-- Idempotent and safe to re-run.

-- push_subscriptions — SPA upserts on subscribe and deletes on unsubscribe.
alter table public.push_subscriptions enable row level security;
drop policy if exists "anon read push_subscriptions"   on public.push_subscriptions;
drop policy if exists "anon insert push_subscriptions" on public.push_subscriptions;
drop policy if exists "anon update push_subscriptions" on public.push_subscriptions;
drop policy if exists "anon delete push_subscriptions" on public.push_subscriptions;
create policy "anon read push_subscriptions"   on public.push_subscriptions for select to anon using (true);
create policy "anon insert push_subscriptions" on public.push_subscriptions for insert to anon with check (true);
create policy "anon update push_subscriptions" on public.push_subscriptions for update to anon using (true) with check (true);
create policy "anon delete push_subscriptions" on public.push_subscriptions for delete to anon using (true);

-- push_settings — SPA upserts the singleton row (with .select() return, so the
-- post-write SELECT needs a SELECT policy too — see the CLAUDE.md RLS gotcha).
alter table public.push_settings enable row level security;
drop policy if exists "anon read push_settings"   on public.push_settings;
drop policy if exists "anon insert push_settings" on public.push_settings;
drop policy if exists "anon update push_settings" on public.push_settings;
create policy "anon read push_settings"   on public.push_settings for select to anon using (true);
create policy "anon insert push_settings" on public.push_settings for insert to anon with check (true);
create policy "anon update push_settings" on public.push_settings for update to anon using (true) with check (true);
