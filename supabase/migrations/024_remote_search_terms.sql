-- 024: Remote search terms
--
-- PURPOSE
-- Search Parameters (what the user wants to search for) live in
-- candidate_preferences, which already holds desired_roles, excluded_roles,
-- desired_skills, excluded_skills, work_modes and geographic_preferences. Six
-- of the seven fields the profile Search Parameters panel needs already exist
-- with the right names and semantics; only the remote-intent wording is
-- missing.
--
-- DESIGN
-- One additive column. No new table: a second Search Parameters store would put
-- work_modes and geographic_preferences in two places, with M6 reading one and
-- discovery the other, which is exactly the duplication a single source of
-- truth forbids.
--
-- No RLS change: candidate_preferences already carries owner-scoped CRUD from
-- migration 006 ("Users can update own preferences", auth.uid() = user_id).
--
-- EMPTY MEANS EMPTY
-- Defaults to '{}', and the query builder adds no remote wording when the array
-- is empty. Applying this migration cannot change any existing user's generated
-- queries, and no user is silently opted into remote/worldwide search.

ALTER TABLE public.candidate_preferences
  ADD COLUMN IF NOT EXISTS remote_search_terms TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.candidate_preferences.remote_search_terms IS
  'Remote-intent phrases rotated across generated search queries (e.g. remote, work from anywhere, remote-first). Empty means no remote wording is added to any query.';
