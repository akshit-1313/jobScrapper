-- 023: Daily discovery opt-in
--
-- PURPOSE
-- The scheduled daily discovery run needs a way to know WHICH users want it.
-- M8's own eligibility model (saved_searches + user_firecrawl_allocations) is
-- deferred and has no provisioning path, so the scheduled path instead reuses
-- the validated Phase 3 profile-targeted flow and selects users from an
-- explicit per-user opt-in.
--
-- DESIGN
-- Two additive columns on the existing profiles table. No new table, no new
-- RLS policy: profiles already carries full owner-scoped CRUD from migration
-- 006 ("Users can update own profile" USING/WITH CHECK auth.uid() = user_id),
-- so a user can toggle their own flag and cannot touch anyone else's.
--
-- OPT-IN BY DEFAULT-OFF
-- daily_discovery_enabled defaults to FALSE, so applying this migration cannot
-- enable scheduled discovery for anyone. Existing rows stay disabled until the
-- user turns it on themselves. Nothing is provisioned implicitly and no
-- Firecrawl credits can be spent as a result of this migration.
--
-- ROTATION
-- last_daily_discovery_at records when the scheduled run last processed this
-- user. The cron selects the least-recently-run enabled user so that, with more
-- than one opted-in user, coverage rotates across days instead of always
-- serving the same account. It is written by the service role from the cron
-- path only; users never set it.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS daily_discovery_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_daily_discovery_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.daily_discovery_enabled IS
  'User opt-in for the scheduled daily profile-targeted discovery run. Defaults to false; only the owner can change it (profiles RLS).';

COMMENT ON COLUMN public.profiles.last_daily_discovery_at IS
  'When the scheduled daily run last processed this user. Set by the cron path (service role) and used to rotate fairly between opted-in users.';

-- Selection index for the cron: enabled users, least recently run first.
CREATE INDEX IF NOT EXISTS idx_profiles_daily_discovery
  ON public.profiles (last_daily_discovery_at NULLS FIRST)
  WHERE daily_discovery_enabled = true;
