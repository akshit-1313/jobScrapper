-- 003: Job sources, jobs, job_source_mappings, job_locations, job_skills

-- Job status enum
CREATE TYPE public.job_status AS ENUM (
  'discovered', 'active', 'stale', 'expired', 'closed', 'archived'
);

-- Job source types
CREATE TYPE public.source_type AS ENUM (
  'company_careers', 'ats', 'job_board', 'search_engine', 'recruiter', 'other'
);

-- Work mode enum
CREATE TYPE public.work_mode AS ENUM (
  'remote', 'hybrid', 'office', 'unknown'
);

-- Employment type enum
CREATE TYPE public.employment_type AS ENUM (
  'full_time', 'part_time', 'contract', 'freelance', 'internship', 'unknown'
);

-- Job sources (shared, no user_id)
CREATE TABLE public.job_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT,
  source_type public.source_type NOT NULL DEFAULT 'other',
  base_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  crawl_frequency TEXT DEFAULT 'daily',
  last_crawled_at TIMESTAMPTZ,
  crawl_status TEXT DEFAULT 'pending',
  restriction_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Jobs (shared canonical entities, no user_id)
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id TEXT UNIQUE,
  title TEXT NOT NULL,
  normalized_title TEXT,
  company_name TEXT NOT NULL,
  company_domain TEXT,
  description TEXT,
  employment_type public.employment_type NOT NULL DEFAULT 'unknown',
  experience_min INTEGER,
  experience_max INTEGER,
  salary_min INTEGER,
  salary_max INTEGER,
  salary_currency TEXT,
  salary_period TEXT CHECK (salary_period IN ('hourly', 'monthly', 'yearly', NULL)),
  work_mode public.work_mode NOT NULL DEFAULT 'unknown',
  remote_scope TEXT,
  visa_sponsorship TEXT CHECK (visa_sponsorship IN ('yes', 'no', 'unknown', NULL)),
  relocation_support TEXT CHECK (relocation_support IN ('yes', 'no', 'unknown', NULL)),
  job_url TEXT,
  canonical_url TEXT,
  external_job_id TEXT,
  posted_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  status public.job_status NOT NULL DEFAULT 'discovered',
  raw_content_hash TEXT,
  search_vector TSVECTOR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Job source mappings (tracks all sources where a canonical job was found)
CREATE TABLE public.job_source_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.job_sources(id) ON DELETE CASCADE,
  source_url TEXT,
  external_job_id TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id, source_id, external_job_id)
);

-- Job locations (shared, tied to job)
CREATE TABLE public.job_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  country TEXT,
  state TEXT,
  city TEXT,
  region TEXT,
  remote_allowed BOOLEAN DEFAULT false,
  remote_region TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Job skills (shared, tied to job)
CREATE TABLE public.job_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT true,
  proficiency_level TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Search vector auto-update function
CREATE OR REPLACE FUNCTION public.jobs_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.company_name, '') || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(NEW.normalized_title, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, company_name, description, normalized_title
  ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_search_vector_update();

-- Auto-update triggers
CREATE TRIGGER job_sources_updated_at
  BEFORE UPDATE ON public.job_sources
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER job_source_mappings_updated_at
  BEFORE UPDATE ON public.job_source_mappings
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
