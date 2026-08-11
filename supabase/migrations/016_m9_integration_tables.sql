-- 016_m9_integration_tables.sql

CREATE TYPE public.integration_provider AS ENUM ('gmail', 'playwright');
CREATE TYPE public.integration_task_status AS ENUM ('pending', 'executing', 'failed', 'completed');

-- user_integrations
CREATE TABLE public.user_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider public.integration_provider NOT NULL,
    provider_account_id TEXT, 
    status TEXT NOT NULL DEFAULT 'active',
    scopes TEXT[] DEFAULT '{}',
    secret_id UUID, 
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, provider, provider_account_id),
    UNIQUE(id, user_id) 
);

-- integration_tasks
CREATE TABLE public.integration_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    integration_id UUID NOT NULL,
    task_type TEXT NOT NULL,
    status public.integration_task_status NOT NULL DEFAULT 'pending',
    idempotency_key TEXT NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_error TEXT,
    payload JSONB DEFAULT '{}'::jsonb,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (integration_id, user_id) REFERENCES public.user_integrations(id, user_id) ON DELETE CASCADE,
    UNIQUE(integration_id, idempotency_key)
);

-- Triggers
CREATE TRIGGER user_integrations_updated_at 
    BEFORE UPDATE ON public.user_integrations 
    FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TRIGGER integration_tasks_updated_at 
    BEFORE UPDATE ON public.integration_tasks 
    FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- RLS
ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own integrations" 
    ON public.user_integrations 
    FOR SELECT TO authenticated 
    USING (auth.uid() = user_id);

CREATE POLICY "Users view own tasks" 
    ON public.integration_tasks 
    FOR SELECT TO authenticated 
    USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_user_integrations_user_id ON public.user_integrations(user_id);
CREATE INDEX idx_integration_tasks_user_id ON public.integration_tasks(user_id);
CREATE INDEX idx_integration_tasks_status_scheduled_at ON public.integration_tasks(status, scheduled_at);

-- claim_next_integration_task RPC
CREATE OR REPLACE FUNCTION public.claim_next_integration_task(p_task_type TEXT)
RETURNS SETOF public.integration_tasks AS $$
BEGIN
    RETURN QUERY
    UPDATE public.integration_tasks
    SET status = 'executing', started_at = now(), attempt_count = attempt_count + 1
    WHERE id = (
        SELECT id FROM public.integration_tasks
        WHERE status = 'pending' AND task_type = p_task_type AND scheduled_at <= now()
        ORDER BY scheduled_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.claim_next_integration_task(TEXT) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_integration_task(TEXT) TO service_role;

-- reset_stale_tasks RPC
CREATE OR REPLACE FUNCTION public.reset_stale_tasks()
RETURNS INTEGER AS $$
DECLARE
    stale_count INTEGER;
BEGIN
    UPDATE public.integration_tasks
    SET status = 'failed',
        last_error = 'Worker timeout exceeded',
        started_at = NULL,
        scheduled_at = now() + (attempt_count * interval '5 minutes')
    WHERE status = 'executing' 
      AND started_at <= now() - interval '30 minutes'
      AND attempt_count < 3;
      
    GET DIAGNOSTICS stale_count = ROW_COUNT;
    RETURN stale_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.reset_stale_tasks() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_stale_tasks() TO service_role;
