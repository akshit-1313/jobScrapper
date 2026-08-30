-- 028: Role rotation offset
--
-- PURPOSE
-- Remember where the last discovery run stopped in the user's Target Roles, so
-- the next run starts after it.
--
-- WHY IT IS NEEDED
-- A run can only afford a few queries (3 manual, 2 scheduled) while a user may
-- list any number of roles. Selection was a pure function of stored
-- configuration, so every run produced the same queries and any role past the
-- slot count was never searched — deterministically, so it was starved forever
-- rather than merely unlucky. A stored position is the smallest thing that
-- makes the window move.
--
-- DESIGN
-- One additive integer on candidate_preferences, which is already the single
-- source of truth for Search Parameters and already read by both the manual
-- path and the 04:00 UTC scheduled run. No new table, and no RLS change:
-- candidate_preferences carries owner-scoped CRUD from migration 006.
--
-- This mirrors the rotation pointer that already exists for sources
-- (job_sources.last_crawled_at) rather than introducing a new mechanism.
--
-- ONE SHARED OFFSET
-- Manual and scheduled discovery deliberately share it. Two pointers would let
-- both paths sit on the same roles; one pointer means they advance the same
-- rotation and between them cover the list faster.
--
-- DEFAULT PRESERVES BEHAVIOUR
-- 0 means "start at the first role", which is exactly what every user gets
-- today. Applying this changes nobody's results; the first run after deployment
-- starts deterministically at the top of the list.
--
-- SELF-CORRECTING
-- The value is folded into [0, N) at read time, so removing roles cannot leave
-- a stale offset pointing past the end, and no reset is ever required.
--
-- UNCHANGED
-- Query caps (3 manual, 2 scheduled), the 3-source cap, the 4-URL extraction
-- cap, the Firecrawl rate gate, the 6s spacing, the 55s budget and the 45s
-- reservation are all untouched. This only changes WHICH roles a run searches,
-- never how many.

ALTER TABLE public.candidate_preferences
  ADD COLUMN IF NOT EXISTS role_rotation_offset INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.candidate_preferences.role_rotation_offset IS
  'Starting index into desired_roles for the next discovery run. Shared by manual and scheduled discovery so every role is reached within ceil(roles / queries_per_run) runs. Normalised modulo the current role count on read, so removing roles needs no reset.';
