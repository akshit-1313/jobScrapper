-- 022: Stale discovery lock recovery
--
-- PROBLEM
-- m8_cron_runs carries a partial unique index:
--     m8_cron_runs_single_running ON m8_cron_runs (status) WHERE status = 'running'
-- which is the global discovery mutex. The application releases it in a
-- finally-style path, but a serverless platform can hard-kill a function before
-- that runs (Vercel terminates at the plan's maxDuration). The row then stays
-- 'running' forever and the unique index blocks EVERY future discovery run —
-- both /api/cron/discovery (M8) and the profile-targeted path.
--
-- APPROACH
-- Mirrors the existing reset_stale_tasks convention from migration 016:
-- an age-based SECURITY DEFINER reclaim function, service_role only.
--
-- The mutex itself is NOT replaced or weakened: the unique index stays exactly
-- as it is, and this only transitions rows that are provably abandoned.
--
-- SAFETY OF THE THRESHOLD
-- A legitimate run cannot outlive the platform's function limit:
--   * Vercel Hobby hard-kills at 60s
--   * M8's WORKLOAD_LIMITS.timeout_seconds is 55s
--   * the profile-targeted budget is likewise below the platform limit
-- so no live run can still be executing after ~60s. The default threshold of
-- 300s (5 minutes) is five times that ceiling, making it impossible to reclaim
-- a genuinely active run while still unblocking a killed one promptly.
--
-- Rows are transitioned to 'timeout' (already permitted by the table's CHECK
-- constraint) rather than deleted, so abandoned runs remain auditable.

CREATE OR REPLACE FUNCTION public.reclaim_stale_discovery_locks(
    p_max_age_seconds INTEGER DEFAULT 300
)
RETURNS INTEGER AS $$
DECLARE
    reclaimed_count INTEGER;
BEGIN
    -- Guard against a caller passing an unsafely small age, which could reclaim
    -- a live run. 120s is still double the platform's 60s ceiling.
    IF p_max_age_seconds IS NULL OR p_max_age_seconds < 120 THEN
        p_max_age_seconds := 120;
    END IF;

    -- Single atomic statement: concurrent callers on different instances
    -- serialise on row locks, so a row can only be reclaimed once.
    UPDATE public.m8_cron_runs
    SET status = 'timeout',
        completed_at = now(),
        error_log = COALESCE(error_log || ' | ', '')
                    || 'Reclaimed by stale-lock recovery: exceeded '
                    || p_max_age_seconds || 's without completing'
    WHERE status = 'running'
      AND started_at <= now() - make_interval(secs => p_max_age_seconds);

    GET DIAGNOSTICS reclaimed_count = ROW_COUNT;
    RETURN reclaimed_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.reclaim_stale_discovery_locks(INTEGER) IS
  'Transitions abandoned m8_cron_runs rows (status=running past the max age) to timeout so the single-running mutex cannot deadlock after a platform kill. Does not modify the mutex itself.';

REVOKE EXECUTE ON FUNCTION public.reclaim_stale_discovery_locks(INTEGER) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_stale_discovery_locks(INTEGER) TO service_role;
