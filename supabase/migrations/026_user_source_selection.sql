-- 026: User job-source selection
--
-- PURPOSE
-- Let a user choose WHICH job boards enter the discovery rotation, without
-- weakening the global allow-list.
--
-- TWO DIFFERENT THINGS
--   job_sources.active = true   → SECURITY BOUNDARY. Global, admin-controlled.
--   selected_source_ids         → PREFERENCE. Per user, may only narrow.
--
-- The eligible pool is the INTERSECTION, and `active = true` is always part of
-- the predicate, so a stored id for a source that was later deactivated or
-- deleted simply matches nothing. A user can never reach a domain outside the
-- allow-list, even with a stale or hand-crafted id.
--
-- DESIGN
-- One additive column on candidate_preferences, which is already the single
-- source of truth for Search Parameters and is already read by both the manual
-- Find Matching Jobs path and the 04:00 UTC scheduled run. No new table, and no
-- RLS change: candidate_preferences carries owner-scoped CRUD from migration
-- 006.
--
-- DEFAULT PRESERVES CURRENT BEHAVIOUR
-- '{}' means "all globally active sources", which is exactly what every user
-- gets today. Applying this migration cannot change anyone's source coverage,
-- and nobody is forced to choose. Only an explicit non-empty selection narrows
-- the pool.
--
-- UNCHANGED
-- The 3-source cap, the 9-search cap, the 4-URL extraction cap, the Firecrawl
-- rate gate, the 6s spacing and the deterministic
-- (last_crawled_at, priority, id) rotation are all untouched. This only changes
-- which rows are eligible to enter that rotation.

ALTER TABLE public.candidate_preferences
  ADD COLUMN IF NOT EXISTS selected_source_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.candidate_preferences.selected_source_ids IS
  'Job sources the user wants searched. Empty means all globally active sources. Intersected with job_sources.active = true, which remains the security boundary and is always applied.';
