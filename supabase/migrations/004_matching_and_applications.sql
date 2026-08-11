-- 004: Matching, saved jobs, applications, application events

-- Application status enum
CREATE TYPE public.application_status AS ENUM (
  'not_applied', 'interested', 'applied', 'recruiter_contacted',
  'interview', 'technical_round', 'offer', 'rejected', 'withdrawn', 'closed'
);

-- Saved job status enum
CREATE TYPE public.saved_job_status AS ENUM (
  'saved', 'ignored', 'archived'
);

-- Match recommendation enum
CREATE TYPE public.match_recommendation AS ENUM (
  'strong_match', 'good_match', 'possible_match', 'weak_match', 'skip'
);

-- Job matches (user-owned)
CREATE TABLE public.job_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  overall_score NUMERIC(5,2) CHECK (overall_score BETWEEN 0 AND 100),
  skills_score NUMERIC(5,2) CHECK (skills_score BETWEEN 0 AND 100),
  experience_score NUMERIC(5,2) CHECK (experience_score BETWEEN 0 AND 100),
  role_score NUMERIC(5,2) CHECK (role_score BETWEEN 0 AND 100),
  location_score NUMERIC(5,2) CHECK (location_score BETWEEN 0 AND 100),
  work_mode_score NUMERIC(5,2) CHECK (work_mode_score BETWEEN 0 AND 100),
  seniority_score NUMERIC(5,2) CHECK (seniority_score BETWEEN 0 AND 100),
  matching_skills JSONB DEFAULT '[]'::jsonb,
  missing_required_skills JSONB DEFAULT '[]'::jsonb,
  missing_preferred_skills JSONB DEFAULT '[]'::jsonb,
  positive_reasons JSONB DEFAULT '[]'::jsonb,
  concerns JSONB DEFAULT '[]'::jsonb,
  recommendation public.match_recommendation,
  matching_version TEXT NOT NULL DEFAULT 'v1',
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, job_id)
);

-- Saved jobs (user-owned)
CREATE TABLE public.saved_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  status public.saved_job_status NOT NULL DEFAULT 'saved',
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, job_id)
);

-- Applications (user-owned)
CREATE TABLE public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  status public.application_status NOT NULL DEFAULT 'not_applied',
  applied_at TIMESTAMPTZ,
  notes TEXT,
  recruiter_name TEXT,
  recruiter_email TEXT,
  offer_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, job_id)
);

-- Application events (history)
CREATE TABLE public.application_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  from_status public.application_status,
  to_status public.application_status NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Triggers
CREATE TRIGGER job_matches_updated_at
  BEFORE UPDATE ON public.job_matches
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER saved_jobs_updated_at
  BEFORE UPDATE ON public.saved_jobs
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER applications_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
