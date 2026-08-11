-- 006: Row Level Security policies
--
-- Design principles:
--   Shared entities (jobs, job_sources, etc.) → authenticated read-only; writes via service-role
--   User-owned entities (profiles, preferences, etc.) → full CRUD restricted to auth.uid() = user_id
--   Server-generated data (job_matches, search_runs, crawl_runs) → authenticated read-only; writes via service-role
--   Child entities (resume_versions, application_events) → access through parent ownership

-- Enable RLS on ALL tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_source_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawl_runs ENABLE ROW LEVEL SECURITY;

-------------------------------------------------------
-- SHARED ENTITIES: authenticated read, service-role write
-- (No INSERT/UPDATE/DELETE policies for authenticated role = denied)
-------------------------------------------------------

CREATE POLICY "Authenticated users can read job sources"
  ON public.job_sources FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read jobs"
  ON public.jobs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read job source mappings"
  ON public.job_source_mappings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read job locations"
  ON public.job_locations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read job skills"
  ON public.job_skills FOR SELECT TO authenticated USING (true);

-------------------------------------------------------
-- USER-OWNED: full CRUD restricted to owner
-------------------------------------------------------

-- Profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can create own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own profile"
  ON public.profiles FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Resumes
CREATE POLICY "Users can view own resumes"
  ON public.resumes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can create own resumes"
  ON public.resumes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own resumes"
  ON public.resumes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own resumes"
  ON public.resumes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Resume versions (access through parent resume ownership)
-- UPDATE has explicit WITH CHECK to prevent reassigning to another user's resume
CREATE POLICY "Users can view own resume versions"
  ON public.resume_versions FOR SELECT TO authenticated
  USING (resume_id IN (SELECT id FROM public.resumes WHERE user_id = auth.uid()));
CREATE POLICY "Users can create own resume versions"
  ON public.resume_versions FOR INSERT TO authenticated
  WITH CHECK (resume_id IN (SELECT id FROM public.resumes WHERE user_id = auth.uid()));
CREATE POLICY "Users can update own resume versions"
  ON public.resume_versions FOR UPDATE TO authenticated
  USING (resume_id IN (SELECT id FROM public.resumes WHERE user_id = auth.uid()))
  WITH CHECK (resume_id IN (SELECT id FROM public.resumes WHERE user_id = auth.uid()));
CREATE POLICY "Users can delete own resume versions"
  ON public.resume_versions FOR DELETE TO authenticated
  USING (resume_id IN (SELECT id FROM public.resumes WHERE user_id = auth.uid()));

-- Candidate skills
CREATE POLICY "Users can view own skills"
  ON public.candidate_skills FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can create own skills"
  ON public.candidate_skills FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own skills"
  ON public.candidate_skills FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own skills"
  ON public.candidate_skills FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Candidate experience
CREATE POLICY "Users can view own experience"
  ON public.candidate_experience FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can create own experience"
  ON public.candidate_experience FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own experience"
  ON public.candidate_experience FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own experience"
  ON public.candidate_experience FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Candidate preferences
CREATE POLICY "Users can view own preferences"
  ON public.candidate_preferences FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can create own preferences"
  ON public.candidate_preferences FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own preferences"
  ON public.candidate_preferences FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own preferences"
  ON public.candidate_preferences FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-------------------------------------------------------
-- SERVER-GENERATED DATA: authenticated read-only, writes via service-role
-- (No INSERT/UPDATE/DELETE policies for authenticated role)
-------------------------------------------------------

-- Job matches (server-generated scoring data)
CREATE POLICY "Users can view own matches"
  ON public.job_matches FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Saved jobs (user-owned, full CRUD)
CREATE POLICY "Users can view own saved jobs"
  ON public.saved_jobs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can create own saved jobs"
  ON public.saved_jobs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own saved jobs"
  ON public.saved_jobs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own saved jobs"
  ON public.saved_jobs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Applications (user-owned, full CRUD)
CREATE POLICY "Users can view own applications"
  ON public.applications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can create own applications"
  ON public.applications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own applications"
  ON public.applications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own applications"
  ON public.applications FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Application events (through application ownership)
CREATE POLICY "Users can view own application events"
  ON public.application_events FOR SELECT TO authenticated
  USING (application_id IN (SELECT id FROM public.applications WHERE user_id = auth.uid()));
CREATE POLICY "Users can create own application events"
  ON public.application_events FOR INSERT TO authenticated
  WITH CHECK (application_id IN (SELECT id FROM public.applications WHERE user_id = auth.uid()));

-- Saved searches (user-owned, full CRUD)
CREATE POLICY "Users can view own saved searches"
  ON public.saved_searches FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can create own saved searches"
  ON public.saved_searches FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own saved searches"
  ON public.saved_searches FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own saved searches"
  ON public.saved_searches FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-------------------------------------------------------
-- SEARCH/CRAWL RUNS: authenticated read-only, writes via service-role
-------------------------------------------------------

CREATE POLICY "Users can view own search runs"
  ON public.search_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own crawl runs"
  ON public.crawl_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
