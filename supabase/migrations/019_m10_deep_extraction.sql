-- 019_m10_deep_extraction.sql

-- 1. Create email_extractions table
CREATE TABLE public.email_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    thread_id TEXT,
    task_id UUID NOT NULL REFERENCES public.integration_tasks(id) ON DELETE CASCADE,
    extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider TEXT NOT NULL,
    model TEXT,
    tokens_used INTEGER,
    matched_application_id UUID REFERENCES public.applications(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Enforce idempotent extraction per message per user
    UNIQUE(user_id, message_id)
);

-- 2. Enable RLS
ALTER TABLE public.email_extractions ENABLE ROW LEVEL SECURITY;

-- 3. Add explicit RLS Policies
-- Users can only SELECT their own records.
CREATE POLICY "Users view own extractions"
    ON public.email_extractions
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- There are explicit NO insert/update/delete policies for authenticated users.
-- Service Role will bypass RLS.

-- 4. Create Indexes
CREATE INDEX idx_email_extractions_user_id ON public.email_extractions(user_id);
CREATE INDEX idx_email_extractions_task_id ON public.email_extractions(task_id);

-- 5. Extend integration_tasks claiming logic safely
-- Drop the single-string version to replace with array version,
-- preserving behavior but supporting generic queue consumption.
DROP FUNCTION IF EXISTS public.claim_next_integration_task(TEXT);

CREATE OR REPLACE FUNCTION public.claim_next_integration_task(p_task_types TEXT[] DEFAULT NULL)
RETURNS SETOF public.integration_tasks AS $$
BEGIN
    RETURN QUERY
    UPDATE public.integration_tasks
    SET status = 'executing', started_at = now(), attempt_count = attempt_count + 1
    WHERE id = (
        SELECT id FROM public.integration_tasks
        WHERE status = 'pending' 
          AND (p_task_types IS NULL OR task_type = ANY(p_task_types))
          AND scheduled_at <= now()
        ORDER BY scheduled_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.claim_next_integration_task(TEXT[]) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_integration_task(TEXT[]) TO service_role;
