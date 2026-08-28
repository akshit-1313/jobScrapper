-- 020: M5 Structured Resume Intelligence
--
-- Purpose: make resume parsing a first-class source of structured job-search data.
-- Education and certifications were previously extracted by the parser and then
-- flattened into profiles.professional_summary as prose, discarding their structure.
-- Skills had no category, so "programming language" vs "cloud platform" was unknowable.
--
-- ALL CHANGES ARE ADDITIVE. No column is dropped, altered, or re-typed.
-- No M6 / M7 / M8 object is touched. applications and application_events are untouched.

-- 1. Skill categorisation ----------------------------------------------------
-- Nullable: existing rows remain valid and unclassified.
ALTER TABLE public.candidate_skills
  ADD COLUMN category TEXT
  CHECK (category IN ('language','framework','library','database','cloud','tool','domain','other'));

COMMENT ON COLUMN public.candidate_skills.category IS
  'Deterministically derived skill category. NULL = not classified (e.g. pre-existing row).';

-- 2. Experience: separate responsibilities from achievements -----------------
-- description is intentionally RETAINED for backward compatibility.
ALTER TABLE public.candidate_experience
  ADD COLUMN responsibilities TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.candidate_experience
  ADD COLUMN achievements TEXT[] NOT NULL DEFAULT '{}';

-- 3. Preserve extracted resume text separately from the binary file ----------
-- The original uploaded file in storage is unchanged; this is the extracted text.
ALTER TABLE public.resume_versions
  ADD COLUMN raw_text TEXT;

COMMENT ON COLUMN public.resume_versions.raw_text IS
  'Plain text extracted from the uploaded resume. Never logged. Binary file remains in storage.';

-- 4. Structured education ----------------------------------------------------
CREATE TABLE public.candidate_education (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  degree TEXT,
  field_of_study TEXT,
  start_date DATE,
  end_date DATE,
  grade TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Structured certifications -----------------------------------------------
CREATE TABLE public.candidate_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  issuer TEXT,
  issue_date DATE,
  expiry_date DATE,
  credential_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Indexes -----------------------------------------------------------------
CREATE INDEX idx_candidate_education_user_id ON public.candidate_education(user_id);
CREATE INDEX idx_candidate_certifications_user_id ON public.candidate_certifications(user_id);
CREATE INDEX idx_candidate_skills_category ON public.candidate_skills(category);

-- 7. RLS — mirrors the user-owned entity pattern established in 006 ----------
ALTER TABLE public.candidate_education ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_certifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own education"
  ON public.candidate_education FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can create own education"
  ON public.candidate_education FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own education"
  ON public.candidate_education FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own education"
  ON public.candidate_education FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own certifications"
  ON public.candidate_certifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can create own certifications"
  ON public.candidate_certifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own certifications"
  ON public.candidate_certifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own certifications"
  ON public.candidate_certifications FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 8. updated_at triggers -----------------------------------------------------
CREATE TRIGGER candidate_education_updated_at
  BEFORE UPDATE ON public.candidate_education
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER candidate_certifications_updated_at
  BEFORE UPDATE ON public.candidate_certifications
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
