-- 007: Indexes for common queries

-- Jobs: full-text search (GIN on tsvector)
CREATE INDEX idx_jobs_search_vector ON public.jobs USING GIN (search_vector);

-- Jobs: status filtering
CREATE INDEX idx_jobs_status ON public.jobs (status);

-- Jobs: company filtering
CREATE INDEX idx_jobs_company_name ON public.jobs (company_name);

-- Jobs: work mode filtering
CREATE INDEX idx_jobs_work_mode ON public.jobs (work_mode);

-- Jobs: posted date sorting
CREATE INDEX idx_jobs_posted_at ON public.jobs (posted_at DESC NULLS LAST);

-- Jobs: discovered date sorting
CREATE INDEX idx_jobs_discovered_at ON public.jobs (discovered_at DESC);

-- Jobs: dedup by canonical_url
CREATE INDEX idx_jobs_canonical_url ON public.jobs (canonical_url) WHERE canonical_url IS NOT NULL;

-- Jobs: trigram index for fuzzy title search
CREATE INDEX idx_jobs_title_trgm ON public.jobs USING GIN (title public.gin_trgm_ops);

-- Job source mappings
CREATE INDEX idx_job_source_mappings_job_id ON public.job_source_mappings (job_id);
CREATE INDEX idx_job_source_mappings_source_id ON public.job_source_mappings (source_id);

-- Job locations
CREATE INDEX idx_job_locations_job_id ON public.job_locations (job_id);
CREATE INDEX idx_job_locations_country ON public.job_locations (country);
CREATE INDEX idx_job_locations_city ON public.job_locations (city) WHERE city IS NOT NULL;

-- Job skills
CREATE INDEX idx_job_skills_job_id ON public.job_skills (job_id);
CREATE INDEX idx_job_skills_skill_name ON public.job_skills (skill_name);

-- Job matches
CREATE INDEX idx_job_matches_user_id ON public.job_matches (user_id);
CREATE INDEX idx_job_matches_user_score ON public.job_matches (user_id, overall_score DESC NULLS LAST);
CREATE INDEX idx_job_matches_job_id ON public.job_matches (job_id);

-- Saved jobs
CREATE INDEX idx_saved_jobs_user_status ON public.saved_jobs (user_id, status);

-- Applications
CREATE INDEX idx_applications_user_status ON public.applications (user_id, status);
CREATE INDEX idx_applications_job_id ON public.applications (job_id);

-- Application events
CREATE INDEX idx_application_events_application_id ON public.application_events (application_id);

-- Saved searches
CREATE INDEX idx_saved_searches_user_id ON public.saved_searches (user_id);

-- Search runs
CREATE INDEX idx_search_runs_user_id ON public.search_runs (user_id);

-- Crawl runs
CREATE INDEX idx_crawl_runs_user_id ON public.crawl_runs (user_id);
CREATE INDEX idx_crawl_runs_search_run_id ON public.crawl_runs (search_run_id) WHERE search_run_id IS NOT NULL;

-- Profiles
CREATE INDEX idx_profiles_user_id ON public.profiles (user_id);

-- Candidate skills
CREATE INDEX idx_candidate_skills_user_id ON public.candidate_skills (user_id);

-- Candidate experience
CREATE INDEX idx_candidate_experience_user_id ON public.candidate_experience (user_id);
