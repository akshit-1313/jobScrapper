-- 012_m8_phase_a_infrastructure.sql

-- 1. Create Admins Tracking Table
CREATE TABLE IF NOT EXISTS public.m8_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Note: The m8_admins table is strictly private. Normal clients MUST NOT query it.
ALTER TABLE public.m8_admins ENABLE ROW LEVEL SECURITY;
-- No "FOR SELECT TO PUBLIC" policy here to prevent any exposure.

-- 2. Authorization Function
CREATE OR REPLACE FUNCTION public.m8_is_admin(user_uuid UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM m8_admins WHERE user_id = user_uuid);
END;
$$;

-- 3. System Configuration
CREATE TABLE IF NOT EXISTS public.m8_system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert Default Configs Safely
INSERT INTO public.m8_system_config (key, value)
VALUES
  ('GLOBAL_FIRECRAWL_SAFE_BUDGET', '{"budget": 800}'::jsonb),
  ('WARNING_THRESHOLDS', '{"warning": 80, "critical": 90, "paused": 100}'::jsonb),
  ('SYSTEM_GEO_DEFAULTS', '{"india": 50, "global": 50}'::jsonb),
  ('WORKLOAD_LIMITS', '{"searches_per_invoke": 5, "max_pages_per_search": 3, "timeout_seconds": 55}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4. User Firecrawl Allocations
CREATE TABLE IF NOT EXISTS public.user_firecrawl_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  billing_month TEXT NOT NULL,
  allocated_credits INTEGER NOT NULL CHECK (allocated_credits >= 0),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, billing_month)
);

-- 5. Global Budget Concurrency Trigger
CREATE OR REPLACE FUNCTION public.m8_validate_global_budget()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  global_safe_budget INTEGER;
  active_total INTEGER;
BEGIN
  -- We strictly lock the config table for this transaction to guarantee concurrency safety
  -- ensuring two admins cannot bypass the ceiling simultaneously.
  SELECT (value->>'budget')::INTEGER INTO global_safe_budget
  FROM public.m8_system_config
  WHERE key = 'GLOBAL_FIRECRAWL_SAFE_BUDGET'
  FOR UPDATE;

  IF global_safe_budget IS NULL THEN
     RAISE EXCEPTION 'M8_ERR_MISSING_GLOBAL_BUDGET: GLOBAL_FIRECRAWL_SAFE_BUDGET is not properly configured. Failing transaction safely.';
  END IF;

  -- Calculate existing total for the month, explicitly avoiding this transaction's changes
  SELECT COALESCE(SUM(allocated_credits), 0) INTO active_total
  FROM public.user_firecrawl_allocations
  WHERE billing_month = NEW.billing_month
    AND is_enabled = true
    AND id != NEW.id;

  IF active_total + NEW.allocated_credits > global_safe_budget AND NEW.is_enabled = true THEN
    RAISE EXCEPTION 'Global Firecrawl budget exceeded. Max: %, Requested active total evaluates to %', global_safe_budget, active_total + NEW.allocated_credits;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_m8_enforce_global_budget ON public.user_firecrawl_allocations;
CREATE TRIGGER trg_m8_enforce_global_budget
  BEFORE INSERT OR UPDATE ON public.user_firecrawl_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.m8_validate_global_budget();

-- 6. Usage Ledgers
CREATE TABLE IF NOT EXISTS public.firecrawl_usage_ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  billing_month TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  credits_consumed INTEGER NOT NULL CHECK (credits_consumed >= 0),
  pages_scraped INTEGER NOT NULL CHECK (pages_scraped >= 0),
  reference_id UUID REFERENCES public.search_runs(id) ON DELETE SET NULL,
  provider_reference_id TEXT,
  reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('pending', 'reconciled', 'failed_unverified', 'provider_usage_unknown')),
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_firecrawl_usage_user_month ON public.firecrawl_usage_ledgers(user_id, billing_month);

-- 7. Geographic Preferences
CREATE TABLE IF NOT EXISTS public.user_geographic_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  india_discovery_percent INTEGER NOT NULL DEFAULT 50 CHECK (india_discovery_percent BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Cron Orchestration Runs
CREATE TABLE IF NOT EXISTS public.m8_cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'timeout')),
  searches_processed INTEGER NOT NULL DEFAULT 0,
  error_log TEXT
);
CREATE INDEX IF NOT EXISTS idx_m8_cron_started_at ON public.m8_cron_runs(started_at DESC);

-- Concurrency Safety Boundary: Strictly enforces exactly ONE running orchestration cycle natively 
CREATE UNIQUE INDEX IF NOT EXISTS m8_cron_runs_single_running 
ON public.m8_cron_runs (status) 
WHERE status = 'running';

-- 9. Setup basic RLS & Enable Rules

ALTER TABLE public.m8_system_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "m8_config_select_auth" ON public.m8_system_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "m8_config_insert_admin" ON public.m8_system_config FOR INSERT TO authenticated WITH CHECK (m8_is_admin(auth.uid()));
CREATE POLICY "m8_config_update_admin" ON public.m8_system_config FOR UPDATE TO authenticated USING (m8_is_admin(auth.uid())) WITH CHECK (m8_is_admin(auth.uid()));
CREATE POLICY "m8_config_delete_admin" ON public.m8_system_config FOR DELETE TO authenticated USING (m8_is_admin(auth.uid()));

ALTER TABLE public.user_firecrawl_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "m8_allocations_select_auth" ON public.user_firecrawl_allocations FOR SELECT TO authenticated USING (auth.uid() = user_id OR m8_is_admin(auth.uid()));
CREATE POLICY "m8_allocations_insert_admin" ON public.user_firecrawl_allocations FOR INSERT TO authenticated WITH CHECK (m8_is_admin(auth.uid()));
CREATE POLICY "m8_allocations_update_admin" ON public.user_firecrawl_allocations FOR UPDATE TO authenticated USING (m8_is_admin(auth.uid())) WITH CHECK (m8_is_admin(auth.uid()));
CREATE POLICY "m8_allocations_delete_admin" ON public.user_firecrawl_allocations FOR DELETE TO authenticated USING (m8_is_admin(auth.uid()));

ALTER TABLE public.firecrawl_usage_ledgers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "m8_ledgers_select_auth" ON public.firecrawl_usage_ledgers FOR SELECT TO authenticated USING (auth.uid() = user_id OR m8_is_admin(auth.uid()));

ALTER TABLE public.user_geographic_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "m8_geo_select_own" ON public.user_geographic_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "m8_geo_insert_own" ON public.user_geographic_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "m8_geo_update_own" ON public.user_geographic_preferences FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.m8_cron_runs ENABLE ROW LEVEL SECURITY;
-- No client policies permitted natively.

-- 10. Auto Update Timestamps using the verified `extensions.moddatetime` definition.
DROP TRIGGER IF EXISTS trg_m8_config_updated_at ON public.m8_system_config;
CREATE TRIGGER trg_m8_config_updated_at BEFORE UPDATE ON public.m8_system_config FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

DROP TRIGGER IF EXISTS trg_m8_allocations_updated_at ON public.user_firecrawl_allocations;
CREATE TRIGGER trg_m8_allocations_updated_at BEFORE UPDATE ON public.user_firecrawl_allocations FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

DROP TRIGGER IF EXISTS trg_m8_geo_updated_at ON public.user_geographic_preferences;
CREATE TRIGGER trg_m8_geo_updated_at BEFORE UPDATE ON public.user_geographic_preferences FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
