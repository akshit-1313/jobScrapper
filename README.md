# AI Job Discovery Platform

A private, AI-powered job discovery and matching platform designed to automate the process of finding highly relevant jobs without a mock user experience.

## Active Production Path — Phase 3 profile-targeted discovery

This is the **only** discovery path running in Production. It is **manual by design**:
nothing invokes it on page load, on a schedule, or from a cron route, because every
run spends Firecrawl credits.

```
/profile → "Find Matching Jobs"
  → findMatchingJobsAction              src/app/actions/discovery-actions.ts
  → runProfileTargetedDiscovery         src/lib/jobs/discovery-service.ts
      1. acquireDiscoveryLock           src/lib/jobs/discovery-lock.ts  (m8_cron_runs mutex)
      2. buildSearchStrategies          src/lib/jobs/profile-search-strategy.ts  (deterministic, no LLM)
      3. source rotation                job_sources ORDER BY last_crawled_at ASC NULLS FIRST, priority, id
      4. FirecrawlAdapter.searchJobs    rate gate (6s spacing) + domain allow-list, re-validated client-side
      5. extraction (scrape)            refused unless the wall-clock reservation still fits
      6. job persistence                jobs, job_source_mappings, crawl_runs  (empty extractions rejected)
      7. rotation stamp + releaseDiscoveryLock
  → triggerProfileMatching              src/app/actions/match-actions.ts  (M6)
      → job_matches                     written with the SERVICE-ROLE client (see note below)
```

### Vercel Hobby constraints

| Constraint | Value | Enforced in |
|---|---|---|
| Platform function limit | **60s** (hard kill) | Vercel Hobby |
| `maxDuration` | 60 | `vercel.json` |
| Phase 3 total budget | **55s** | `PROFILE_SEARCH_TIMEOUT_SECONDS` |
| Extraction reservation | **45s** | `PROFILE_EXTRACTION_RESERVATION_SECONDS` |
| Firecrawl search spacing | **6s** (10 req/min) | `FIRECRAWL_SEARCH_RPM`, adapter rate gate |
| Sources per run | **3** | `PROFILE_SEARCH_MAX_SOURCES` |
| Extraction URL cap | **4** (hard ceiling) | `PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN` |

The reservation is based on the **worst observed** extraction (43.3s over n=19 runs), not
an average or percentile: an extraction in flight is never cancelled, so the only safe
control is refusing to *start* one that cannot finish. Worst case is therefore
`10s + 43.3s = 53.3s`, leaving ~6.7s under the platform ceiling.

Both guards draw from **one** `ExecutionBudget` clock, so search time and extraction time
can never sum past the total budget.

### `job_matches` is written with the service-role client

Migration `006_rls_policies.sql` grants `authenticated` **SELECT only** on `job_matches`,
`search_runs` and `crawl_runs` — writes are reserved for the service role. `match-actions.ts`
therefore authenticates and reads with the request-scoped client, and performs only the
`job_matches` upsert with `createAdminClient()`. `user_id` always comes from the verified
session, never from an argument. Do not "fix" this by adding INSERT/UPDATE policies for
`authenticated`.

---

## M8 Background Discovery — DISABLED / FUTURE WORK

> **M8 is not production-ready and must remain dormant.** It has never run against
> Production data. Nothing in the product depends on it, and Phase 3 is unaffected by it.

| Component | File / object | State |
|---|---|---|
| Cron route | `src/app/api/cron/discovery/route.ts` | Present, **exports `POST` only** |
| Orchestrator | `executeBackgroundDiscovery()` | Present, never invoked in Production |
| Concurrency mutex | `m8_cron_runs` + partial unique index `m8_cron_runs_single_running` | **Active and shared with Phase 3** |
| Stale-lock recovery | `reclaim_stale_discovery_locks()` (migration 022) | **Active and shared with Phase 3** |
| Work queue | `saved_searches` | 0 rows |
| Budget grants | `user_firecrawl_allocations` | 0 rows, **no provisioning path exists** |
| Usage ledger | `firecrawl_usage_ledgers` | 0 rows |
| Vercel cron registration | `vercel.json` | `vercel.json` contains one daily cron for `/api/cron/daily-discovery`; the legacy M8 `/api/cron/discovery` route remains **intentionally unregistered and dormant**. |

The mutex and stale-lock recovery are the only M8 components in live use: Phase 3 reuses
them, which is why `m8_cron_runs` has rows. That is expected and must not be removed.

### Known defects and missing controls in M8

1. **HTTP method** — Vercel Cron invokes with `GET`; the route exports `POST` only, so a
   `crons` entry would 405 daily and never execute.
2. **`discover()` SDK incompatibility** — `FirecrawlAdapter.discover()` calls the deprecated
   v1 alias `mapUrl()`, which under `@mendable/firecrawl-js@4.32.0` returns
   `MapData.links: SearchResultWeb[]` (objects). The adapter treats links as strings, so
   `String(obj)` → `"[object Object]"` → every URL is silently skipped. M8 currently spends
   one map call per source and extracts nothing. There is no test coverage for `discover()`.
3. **No workload controls** — M8 passes neither `sourcesOverride`, `discoverOverride`, nor
   `extractionGuard`. Phase 3's 3-source cap, 4-URL cap and extraction reservation therefore
   do **not** apply. Fan-out ceiling: 10 sources x 3 pages x 5 saved searches =
   **150 extractions per invocation**.
4. **No rate gate** — `acquireSearchSlot()` is called only by `searchJobs()`. `discover()`
   bypasses it entirely, so M8 issues unspaced map calls against a ~10 req/min ceiling.
5. **No in-loop wall-clock protection** — `WORKLOAD_LIMITS.timeout_seconds` (55s) is checked
   only *between* saved searches. Once inside `runJobDiscoveryForUser` there is no time
   check, so a single call can run far past the 60s platform ceiling and be hard-killed.
6. **Ledger accounting is not crash-safe** — `firecrawl_usage_ledgers` is written only after
   `runJobDiscoveryForUser` returns. A platform kill loses the credit record entirely while
   the credits have already been spent. `crawl_runs` rows are written incrementally and do
   survive.
7. **Under-counted budget pre-check** — the per-search guard uses
   `conservativeWorstCase = max_pages_per_search` (3 credits), while a single search can fan
   out to 30 extractions.

### Why M8 is deferred

- Phase 3 already provides a working, validated manual discovery experience in Production.
- M8 has **zero eligible users** and no way to create one through the product.
- M8's `discover()` path is incompatible with the current Firecrawl SDK response shape.
- Repairing `discover()` **before** adding workload controls would activate the
  150-extraction fan-out that is currently dormant only because `discover()` is broken.
- Vercel Hobby's 60s ceiling makes the existing M8 design unsafe without extra safeguards,
  and the safeguards that would make it safe reduce it to roughly one extraction per
  invocation — which Phase 3 already delivers on demand.

### Prerequisites before M8 can ever be enabled

1. Make the cron route respond to Vercel's `GET` invocation while preserving `CRON_SECRET`
   authentication, fail-closed behaviour, and auth-before-any-work ordering. Keep `POST`
   (`tests/cron.test.ts` depends on it).
2. Fix `discover()` for the Firecrawl SDK v2 response shape, with test coverage.
3. Add M8-specific rate limiting for map/discover calls.
4. Add M8-specific extraction/workload limits (source cap and run-wide URL cap).
5. Add M8 wall-clock protection — the optional `extractionGuard` hook on
   `runJobDiscoveryForUser` already exists and needs no shared-code change.
6. Make Firecrawl usage/ledger accounting survive partial execution and platform termination.
7. Establish a legitimate provisioning path for `user_firecrawl_allocations`.
8. Establish the intended `saved_searches` lifecycle.
9. Validate the resulting workload against the selected Vercel plan.
10. Run controlled Preview and Production tests before enabling cron.

> Note: one **unrelated** `pg_cron` job is active in the database —
> `daily-notifications-cron` (`0 0 * * *`, `generate_automated_notifications()`) from
> migration 010. It is M7 notification generation, runs entirely in Postgres, and does not
> touch `/api/cron/discovery`, Firecrawl, or M8.

---

## Phase 1 Architecture
*Historical — describes the original foundation, not the current stack or migration set.*
This repository represents the Phase 1 implementation (Foundation).

### Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4, Lucide Icons
- **Database**: Supabase PostgreSQL with `pgvector`
- **Auth**: Supabase Auth (SSR configured)

---

## Local Development Setup

### 1. Environment Variables
Create a `.env.local` file in the root based on `.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

### 2. Database Schema
Ensure all local or remote Supabase instances are updated with the migrations in `supabase/migrations/`:
1. `001_enable_extensions.sql` - Enables vectors and triggers
2. `002_profiles_and_resumes.sql` - Core candidate entities
3. `003_jobs_and_sources.sql` - Core job entities
4. `004_matching_and_applications.sql` - App pipeline tracking
5. `005_search_and_crawl_tracking.sql` - Sourcing telemetry
6. `006_rls_policies.sql` - Secure row-level access rules
7. `007_indexes.sql` - Optimization
8. `008_seed_shared_data.sql` - 25 mock jobs for dashboard dev

> **Note**: These files must be run strictly in this order to establish the necessary dependencies (extensions -> tables -> FKs -> RLS -> indexes).

### 3. Run the App
```bash
npm install
npm run dev
```

Navigate to `http://localhost:3000` to access the login page. Since real users don't exist yet, simply enter any email and click "Sign In / Register". A user will be securely provisioned out of the box.

---

## Deployment (Vercel)
This project is configured out of the box for immediate deployment to Vercel:

1. Push this repository to GitHub.
2. Import the project into Vercel.
3. Supply the Production environment variables in `Settings -> Environment Variables`.
4. Deploy.

The middleware protects `/dashboard/*` endpoints by ensuring active session cookies via Supabase SSR, ensuring zero unauthenticated leaks of any private data on the edge.
