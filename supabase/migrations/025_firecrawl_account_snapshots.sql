-- 025: Firecrawl account snapshots
--
-- PURPOSE
-- Show real Firecrawl account state in the product without calling the provider
-- on every page render.
--
-- WHY A TABLE IS NEEDED
-- Nothing existing can hold this. firecrawl_usage_ledgers records OUR usage,
-- not the provider's balance. search_runs and crawl_runs have no credits
-- column at all. m8_system_config is admin-only global configuration. Any
-- in-process cache is per-lambda and lost on redeploy, so it cannot be a
-- snapshot.
--
-- CONSERVATIVE BY DESIGN
-- The SDK exposes GET /v2/team/credit-usage, but whether that endpoint consumes
-- credits or counts against the provider's request limit is NOT established.
-- Treating both as unknown, the dashboard reads this table and the provider is
-- only contacted on an explicit refresh, after a manual run, or after a cron
-- run — never on render.
--
-- HISTORY
-- Rows are append-only and the dashboard reads the newest by fetched_at. Keeping
-- the history costs almost nothing (a handful of rows a day) and makes the
-- balance delta across a run measurable later without a schema change. No
-- retention logic is added until there is a reason for it.
--
-- SECURITY
-- Contains only sanitised numbers and timestamps — never the API key. Follows
-- the same RLS pattern as other server-generated tables (job_matches,
-- search_runs, crawl_runs): authenticated may read, writes are service-role
-- only, so the browser can never forge a balance.

CREATE TABLE IF NOT EXISTS public.firecrawl_account_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remaining_credits    INTEGER NOT NULL CHECK (remaining_credits >= 0),
  plan_credits         INTEGER CHECK (plan_credits IS NULL OR plan_credits >= 0),
  billing_period_start TIMESTAMPTZ,
  billing_period_end   TIMESTAMPTZ,
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The dashboard only ever wants the newest row.
CREATE INDEX IF NOT EXISTS idx_firecrawl_snapshots_fetched_at
  ON public.firecrawl_account_snapshots (fetched_at DESC);

ALTER TABLE public.firecrawl_account_snapshots ENABLE ROW LEVEL SECURITY;

-- Read-only for signed-in users; no INSERT/UPDATE/DELETE policy, so writes are
-- reachable only by the service role.
DROP POLICY IF EXISTS "Authenticated users can read firecrawl snapshots"
  ON public.firecrawl_account_snapshots;
CREATE POLICY "Authenticated users can read firecrawl snapshots"
  ON public.firecrawl_account_snapshots FOR SELECT TO authenticated
  USING (true);

COMMENT ON TABLE public.firecrawl_account_snapshots IS
  'Cached Firecrawl account balance. Written by the server only, after an explicit refresh or a discovery run. The dashboard renders from the newest row so page loads never call the provider.';
