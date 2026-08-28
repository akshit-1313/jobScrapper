-- 021: M5 Client Engagements
--
-- Consultancy/services resumes list per-client work beneath a parent employer:
--
--   Work Experience
--     <Employer> / <Title> <Dates>
--   Client Engagements
--     <Client> | <Dates>
--       • client-specific work
--
-- Flattening client engagements into the employer's description destroys the
-- per-client technology, responsibility and achievement signal that job
-- discovery needs. They are stored as their own structured records.
--
-- ALL CHANGES ARE ADDITIVE. No existing column is dropped or altered.
-- No M6 / M7 / M8 object is touched. applications and application_events untouched.

CREATE TABLE public.candidate_engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The client the work was delivered for.
  client_name TEXT NOT NULL,
  -- The employer under which the engagement was performed, when determinable.
  parent_company TEXT,
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN NOT NULL DEFAULT false,
  responsibilities TEXT[] NOT NULL DEFAULT '{}',
  achievements TEXT[] NOT NULL DEFAULT '{}',
  -- Technologies literally named in the engagement text (dictionary-bounded).
  technologies TEXT[] NOT NULL DEFAULT '{}',
  -- Domain/business-context terms literally named in the engagement text.
  domains TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.candidate_engagements IS
  'Client engagements performed under a parent employer. Distinct from candidate_experience so per-client signal is preserved.';

CREATE INDEX idx_candidate_engagements_user_id ON public.candidate_engagements(user_id);

ALTER TABLE public.candidate_engagements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own engagements"
  ON public.candidate_engagements FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can create own engagements"
  ON public.candidate_engagements FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own engagements"
  ON public.candidate_engagements FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own engagements"
  ON public.candidate_engagements FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER candidate_engagements_updated_at
  BEFORE UPDATE ON public.candidate_engagements
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
