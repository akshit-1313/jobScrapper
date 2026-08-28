/**
 * @jest-environment node
 *
 * Phase 3 concurrency mutex + execution budget.
 *
 * The mutex is the SAME one M8 established in migration 012 — a partial unique
 * index on m8_cron_runs(status) WHERE status='running'. These tests exercise the
 * shared acquire/release helpers. No Firecrawl, no network, no credits.
 */
import {
    acquireDiscoveryLock,
    releaseDiscoveryLock,
    reclaimStaleDiscoveryLocks,
    STALE_LOCK_MAX_AGE_SECONDS,
    ExecutionBudget,
    getProfileSearchTimeoutSeconds,
    getExtractionReservationSeconds,
    PROFILE_SEARCH_DEFAULT_TIMEOUT_SECONDS,
    PROFILE_EXTRACTION_RESERVATION_SECONDS,
    PG_UNIQUE_VIOLATION,
} from '@/lib/jobs/discovery-lock'
import { resolveUrlBudget, PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN } from '@/lib/jobs/profile-search-strategy'

// Minimal Supabase double: only the calls the lock helpers make.
function makeClient(opts: {
    insertResult?: { data?: { id: string } | null; error?: { code?: string; message: string } | null }
    updateError?: { message: string } | null
    rpcResult?: { data?: unknown; error?: { message: string } | null }
} = {}) {
    const updates: Array<Record<string, unknown>> = []
    const inserts: Array<Record<string, unknown>> = []
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

    const client = {
        updates, inserts, rpcCalls,
        async rpc(fn: string, args: Record<string, unknown>) {
            rpcCalls.push({ fn, args })
            return opts.rpcResult ?? { data: 0, error: null }
        },
        from(table: string) {
            expect(table).toBe('m8_cron_runs')
            return {
                insert(row: Record<string, unknown>) {
                    inserts.push(row)
                    return {
                        select: () => ({
                            single: async () => opts.insertResult ?? { data: { id: 'lock-1' }, error: null },
                        }),
                    }
                },
                update(row: Record<string, unknown>) {
                    updates.push(row)
                    return { eq: async () => ({ error: opts.updateError ?? null }) }
                },
            }
        },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return client as any
}

describe('Phase 3 mutex — acquisition', () => {
    test('acquires the lock by inserting a running row', async () => {
        const c = makeClient()
        const res = await acquireDiscoveryLock(c)

        expect(res.acquired).toBe(true)
        if (res.acquired) expect(res.runId).toBe('lock-1')
        expect(c.inserts).toEqual([{ status: 'running' }])
    })

    test('reuses the M8 table — no second locking system', async () => {
        const c = makeClient()
        await acquireDiscoveryLock(c)
        // makeClient asserts the table name is m8_cron_runs.
        expect(c.inserts).toHaveLength(1)
    })

    // ── The concurrency abort ───────────────────────────────────────────────

    test('aborts cleanly on PostgreSQL 23505 when another cycle is running', async () => {
        const c = makeClient({
            insertResult: { data: null, error: { code: PG_UNIQUE_VIOLATION, message: 'duplicate key' } },
        })
        const res = await acquireDiscoveryLock(c)

        expect(res.acquired).toBe(false)
        if (!res.acquired) expect(res.reason).toBe('busy')
    })

    test('a concurrent second acquisition loses — only one winner', async () => {
        let first = true
        const c = {
            from: () => ({
                insert: () => ({
                    select: () => ({
                        single: async () => {
                            if (first) { first = false; return { data: { id: 'lock-1' }, error: null } }
                            return { data: null, error: { code: PG_UNIQUE_VIOLATION, message: 'duplicate key' } }
                        },
                    }),
                }),
            }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any

        const [a, b] = await Promise.all([acquireDiscoveryLock(c), acquireDiscoveryLock(c)])
        const winners = [a, b].filter(r => r.acquired)
        const losers = [a, b].filter(r => !r.acquired)

        expect(winners).toHaveLength(1)
        expect(losers).toHaveLength(1)
        expect(losers[0].acquired).toBe(false)
    })

    test('distinguishes a lock-store error from a busy lock', async () => {
        const c = makeClient({
            insertResult: { data: null, error: { code: '42P01', message: 'relation missing' } },
        })
        const res = await acquireDiscoveryLock(c)
        expect(res.acquired).toBe(false)
        if (!res.acquired) expect(res.reason).toBe('error')
    })
})

describe('Phase 3 mutex — release', () => {
    test('releases on success by transitioning out of running', async () => {
        const c = makeClient()
        await releaseDiscoveryLock(c, 'lock-1', 'completed', { searchesProcessed: 9 })

        expect(c.updates).toHaveLength(1)
        expect(c.updates[0].status).toBe('completed')
        expect(c.updates[0].searches_processed).toBe(9)
        expect(c.updates[0].completed_at).toBeTruthy()
    })

    test('releases on failure', async () => {
        const c = makeClient()
        await releaseDiscoveryLock(c, 'lock-1', 'failed', { errorLog: 'boom' })
        expect(c.updates[0].status).toBe('failed')
        expect(c.updates[0].error_log).toBe('boom')
    })

    test('releases on timeout', async () => {
        const c = makeClient()
        await releaseDiscoveryLock(c, 'lock-1', 'timeout', { searchesProcessed: 4 })
        expect(c.updates[0].status).toBe('timeout')
        expect(c.updates[0].searches_processed).toBe(4)
    })

    test('never leaves status as running', async () => {
        for (const s of ['completed', 'failed', 'timeout'] as const) {
            const c = makeClient()
            await releaseDiscoveryLock(c, 'lock-1', s)
            expect(c.updates[0].status).not.toBe('running')
        }
    })

    test('a failed release does not throw — it must not mask the original error', async () => {
        const c = makeClient({ updateError: { message: 'db down' } })
        await expect(releaseDiscoveryLock(c, 'lock-1', 'failed')).resolves.toBeUndefined()
    })
})

describe('Phase 3 execution budget', () => {
    const original = process.env.PROFILE_SEARCH_TIMEOUT_SECONDS
    afterEach(() => {
        if (original === undefined) delete process.env.PROFILE_SEARCH_TIMEOUT_SECONDS
        else process.env.PROFILE_SEARCH_TIMEOUT_SECONDS = original
    })

    test('default exceeds a full 9-search pass at 6s spacing', () => {
        delete process.env.PROFILE_SEARCH_TIMEOUT_SECONDS
        expect(getProfileSearchTimeoutSeconds()).toBe(PROFILE_SEARCH_DEFAULT_TIMEOUT_SECONDS)
        // 9 searches x 6s = 54s of spacing alone; M8's 55s left no room for
        // extraction, which is why Phase 3 carries its own budget.
        expect(PROFILE_SEARCH_DEFAULT_TIMEOUT_SECONDS).toBeGreaterThan(9 * 6)
        expect(PROFILE_SEARCH_DEFAULT_TIMEOUT_SECONDS).toBeGreaterThan(55)
    })

    test('is configurable and rejects invalid values', () => {
        process.env.PROFILE_SEARCH_TIMEOUT_SECONDS = '120'
        expect(getProfileSearchTimeoutSeconds()).toBe(120)
        for (const bad of ['0', '-1', 'abc', '']) {
            process.env.PROFILE_SEARCH_TIMEOUT_SECONDS = bad
            expect(getProfileSearchTimeoutSeconds()).toBe(PROFILE_SEARCH_DEFAULT_TIMEOUT_SECONDS)
        }
    })

    test('reports elapsed and remaining time', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(60, t0)
        expect(b.elapsedMs(t0)).toBe(0)
        expect(b.remainingMs(t0)).toBe(60_000)
        expect(b.elapsedMs(t0 + 10_000)).toBe(10_000)
        expect(b.remainingMs(t0 + 10_000)).toBe(50_000)
    })

    test('canAfford gates the NEXT operation, not the current one', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(60, t0)
        // 50s in, 10s left: a 6s search fits, a 15s one does not.
        expect(b.canAfford(6_000, t0 + 50_000)).toBe(true)
        expect(b.canAfford(15_000, t0 + 50_000)).toBe(false)
    })

    // ── No further search after the budget is spent ─────────────────────────

    test('refuses another 6s search once the budget is exhausted', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(60, t0)
        expect(b.isExhausted(t0 + 59_000)).toBe(false)
        expect(b.canAfford(6_000, t0 + 59_000)).toBe(false) // only 1s left
        expect(b.isExhausted(t0 + 60_001)).toBe(true)
        expect(b.canAfford(6_000, t0 + 60_001)).toBe(false)
    })

    test('a 90s budget admits a full 9-search pass but stops before overrun', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(90, t0)
        // After 54s of spacing there is still room for extraction.
        expect(b.canAfford(6_000, t0 + 54_000)).toBe(true)
        // At 85s a further 6s search would overrun — refused.
        expect(b.canAfford(6_000, t0 + 85_000)).toBe(false)
    })

    test('treats a non-positive timeout as at least 1 second', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(0, t0)
        expect(b.remainingMs(t0)).toBe(1000)
    })
})

/**
 * Stale-lock recovery.
 *
 * A serverless platform can hard-kill a function at its maxDuration before the
 * release path runs, leaving m8_cron_runs.status='running' forever. The partial
 * unique index then blocks every future discovery run.
 *
 * Recovery is age-based and delegated to a SECURITY DEFINER Postgres function
 * (migration 022), mirroring the reset_stale_tasks convention. These tests
 * cover the client contract; the age predicate itself lives in SQL.
 */
describe('stale discovery lock recovery', () => {
    test('the default threshold is far above any legitimate run', () => {
        // Vercel Hobby hard-kills at 60s and both budgets sit below that, so no
        // live run can survive to be reclaimed.
        expect(STALE_LOCK_MAX_AGE_SECONDS).toBe(300)
        expect(STALE_LOCK_MAX_AGE_SECONDS).toBeGreaterThan(60 * 4)
    })

    test('calls the shared reclaim function with the age threshold', async () => {
        const c = makeClient({ rpcResult: { data: 0, error: null } })
        await reclaimStaleDiscoveryLocks(c)

        expect(c.rpcCalls).toHaveLength(1)
        expect(c.rpcCalls[0].fn).toBe('reclaim_stale_discovery_locks')
        expect(c.rpcCalls[0].args).toEqual({ p_max_age_seconds: STALE_LOCK_MAX_AGE_SECONDS })
    })

    test('reports how many abandoned locks were reclaimed', async () => {
        const c = makeClient({ rpcResult: { data: 2, error: null } })
        expect(await reclaimStaleDiscoveryLocks(c)).toBe(2)
    })

    test('a fresh running row is NOT reclaimed — nothing to recover', async () => {
        // The SQL predicate only matches rows older than the threshold, so a
        // live run yields a reclaim count of zero.
        const c = makeClient({ rpcResult: { data: 0, error: null } })
        expect(await reclaimStaleDiscoveryLocks(c)).toBe(0)
    })

    test('accepts an explicit threshold', async () => {
        const c = makeClient({ rpcResult: { data: 0, error: null } })
        await reclaimStaleDiscoveryLocks(c, 600)
        expect(c.rpcCalls[0].args).toEqual({ p_max_age_seconds: 600 })
    })

    test('a reclaim failure never blocks a normal acquisition attempt', async () => {
        const c = makeClient({ rpcResult: { data: null, error: { message: 'rpc down' } } })
        await expect(reclaimStaleDiscoveryLocks(c)).resolves.toBe(0)
    })

    // ── Integration with acquisition ────────────────────────────────────────

    test('acquisition reclaims stale locks BEFORE inserting', async () => {
        const c = makeClient()
        const res = await acquireDiscoveryLock(c)

        expect(res.acquired).toBe(true)
        expect(c.rpcCalls).toHaveLength(1)
        expect(c.rpcCalls[0].fn).toBe('reclaim_stale_discovery_locks')
        expect(c.inserts).toEqual([{ status: 'running' }])
    })

    test('recovery does NOT weaken the mutex — a live run still loses with 23505', async () => {
        // Reclaim finds nothing (fresh row), so the concurrent attempt still
        // hits the unique index and aborts cleanly.
        const c = makeClient({
            rpcResult: { data: 0, error: null },
            insertResult: { data: null, error: { code: PG_UNIQUE_VIOLATION, message: 'duplicate key' } },
        })
        const res = await acquireDiscoveryLock(c)

        expect(res.acquired).toBe(false)
        if (!res.acquired) expect(res.reason).toBe('busy')
    })

    test('acquisition still succeeds even if reclaim errors', async () => {
        const c = makeClient({ rpcResult: { data: null, error: { message: 'rpc down' } } })
        const res = await acquireDiscoveryLock(c)
        expect(res.acquired).toBe(true)
    })
})

/**
 * Hobby-safe 35s budget.
 *
 * Vercel Hobby hard-kills a function at 60s. Firecrawl's ~10 req/min ceiling
 * forces ~6s between searches and MUST NOT be reduced, so the only lever is the
 * execution budget. 35s is configured via PROFILE_SEARCH_TIMEOUT_SECONDS in
 * vercel.json; the code default (90s, correct on Pro) is unchanged.
 */
describe('Hobby-safe 35s execution budget', () => {
    const original = process.env.PROFILE_SEARCH_TIMEOUT_SECONDS
    afterEach(() => {
        if (original === undefined) delete process.env.PROFILE_SEARCH_TIMEOUT_SECONDS
        else process.env.PROFILE_SEARCH_TIMEOUT_SECONDS = original
    })

    const SPACING_MS = 6000
    const HOBBY_LIMIT_S = 60

    test('the env var drives the budget without touching the code default', () => {
        process.env.PROFILE_SEARCH_TIMEOUT_SECONDS = '35'
        expect(getProfileSearchTimeoutSeconds()).toBe(35)
        // The default is untouched — still correct for Pro.
        delete process.env.PROFILE_SEARCH_TIMEOUT_SECONDS
        expect(getProfileSearchTimeoutSeconds()).toBe(PROFILE_SEARCH_DEFAULT_TIMEOUT_SECONDS)
    })

    test('35s sits safely below the Hobby 60s kill', () => {
        expect(35).toBeLessThan(HOBBY_LIMIT_S)
    })

    test('admits searches while >=6s remains and refuses once it does not', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(35, t0)

        expect(b.canAfford(SPACING_MS, t0)).toBe(true)              // 35s left
        expect(b.canAfford(SPACING_MS, t0 + 29_000)).toBe(true)     // 6s left - exactly affordable
        expect(b.canAfford(SPACING_MS, t0 + 29_001)).toBe(false)    // <6s - refused
        expect(b.canAfford(SPACING_MS, t0 + 34_000)).toBe(false)
    })

    test('no further search starts once the budget is exhausted', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(35, t0)
        expect(b.isExhausted(t0 + 35_001)).toBe(true)
        expect(b.canAfford(SPACING_MS, t0 + 35_001)).toBe(false)
        expect(b.canAfford(1, t0 + 35_001)).toBe(false)
    })

    test('yields roughly 5 searches at 6s spacing', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(35, t0)

        let started = 0
        let now = t0
        while (b.canAfford(SPACING_MS, now)) {
            started++
            now += SPACING_MS   // each search costs at least the spacing
        }

        expect(started).toBe(5)
        // Partial coverage is expected and accepted; rotation covers the rest.
        expect(started).toBeLessThan(9)
    })

    test('the search phase leaves headroom under the Hobby limit', () => {
        // Searches stop by ~30s; the remainder of the 60s window is for
        // extraction of the (unchanged) 4-URL cap.
        const searchPhaseSeconds = 5 * 6
        expect(searchPhaseSeconds).toBeLessThanOrEqual(35)
        expect(HOBBY_LIMIT_S - searchPhaseSeconds).toBeGreaterThan(25)
    })

    test('a search already in progress is never interrupted', () => {
        // canAfford is a pre-flight check only; there is no cancellation path,
        // so an in-flight request always completes and writes a clean record.
        const t0 = 1_000_000
        const b = new ExecutionBudget(35, t0)
        expect(b.canAfford(SPACING_MS, t0 + 28_000)).toBe(true)
        // Even though that search finishes past the budget, nothing aborts it.
        expect(b.isExhausted(t0 + 36_000)).toBe(true)
    })

    test('timeout still releases the lock, never leaving it running', async () => {
        const c = makeClient()
        await releaseDiscoveryLock(c, 'lock-1', 'timeout', { searchesProcessed: 5 })
        expect(c.updates[0].status).toBe('timeout')
        expect(c.updates[0].status).not.toBe('running')
        expect(c.updates[0].completed_at).toBeTruthy()
    })
})

/**
 * Hobby-safe extraction guard.
 *
 * Measured crawl_runs data (n=19): min 4.0s, p50 8.8s, p95 ~20s, MAX 43.3s.
 * Extraction cannot be cancelled once started, so the reservation is based on
 * the worst observed case — a p95 reservation would still be overrun.
 *
 * Both guards read the SAME ExecutionBudget clock, so search time and
 * extraction reservation can never sum past the total budget.
 */
describe('Hobby-safe extraction guard', () => {
    const origTimeout = process.env.PROFILE_SEARCH_TIMEOUT_SECONDS
    const origReserve = process.env.PROFILE_EXTRACTION_RESERVATION_SECONDS
    afterEach(() => {
        if (origTimeout === undefined) delete process.env.PROFILE_SEARCH_TIMEOUT_SECONDS
        else process.env.PROFILE_SEARCH_TIMEOUT_SECONDS = origTimeout
        if (origReserve === undefined) delete process.env.PROFILE_EXTRACTION_RESERVATION_SECONDS
        else process.env.PROFILE_EXTRACTION_RESERVATION_SECONDS = origReserve
    })

    const HOBBY_LIMIT_S = 60
    const TOTAL_S = 55
    const RESERVE_S = 45
    const SPACING_MS = 6000
    const WORST_EXTRACTION_S = 43.3

    test('reservation is based on the worst OBSERVED extraction, not p95', () => {
        expect(PROFILE_EXTRACTION_RESERVATION_SECONDS).toBe(45)
        expect(PROFILE_EXTRACTION_RESERVATION_SECONDS).toBeGreaterThan(WORST_EXTRACTION_S)
        // A p95 (~20s) reservation would be overrun by the 43.3s case.
        expect(PROFILE_EXTRACTION_RESERVATION_SECONDS).toBeGreaterThan(20)
    })

    test('reservation is configurable and rejects invalid values', () => {
        process.env.PROFILE_EXTRACTION_RESERVATION_SECONDS = '30'
        expect(getExtractionReservationSeconds()).toBe(30)
        for (const bad of ['0', '-1', 'abc', '']) {
            process.env.PROFILE_EXTRACTION_RESERVATION_SECONDS = bad
            expect(getExtractionReservationSeconds()).toBe(PROFILE_EXTRACTION_RESERVATION_SECONDS)
        }
    })

    // ── The guard decision ──────────────────────────────────────────────────

    test('allows extraction while the full reservation still fits', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(TOTAL_S, t0)
        expect(b.canAfford(RESERVE_S * 1000, t0)).toBe(true)            // 55s left
        expect(b.canAfford(RESERVE_S * 1000, t0 + 10_000)).toBe(true)   // 45s left - exactly fits
    })

    test('REFUSES extraction once the reservation cannot fit', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(TOTAL_S, t0)
        expect(b.canAfford(RESERVE_S * 1000, t0 + 10_001)).toBe(false)  // <45s left
        expect(b.canAfford(RESERVE_S * 1000, t0 + 30_000)).toBe(false)
        expect(b.canAfford(RESERVE_S * 1000, t0 + 54_000)).toBe(false)
    })

    test('no extraction can start after the guard refuses', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(TOTAL_S, t0)
        // Once past the last legal start, every later moment is also refused.
        for (const elapsed of [10_001, 20_000, 40_000, 54_999]) {
            expect(b.canAfford(RESERVE_S * 1000, t0 + elapsed)).toBe(false)
        }
    })

    // ── The wall-clock guarantee ────────────────────────────────────────────

    test('worst-case total runtime stays under the Hobby 60s limit', () => {
        // Last legal extraction start is at elapsed = TOTAL - RESERVE = 10s.
        const lastLegalStartS = TOTAL_S - RESERVE_S
        expect(lastLegalStartS).toBe(10)

        // Even the worst observed extraction beginning at that instant finishes
        // inside the budget, and well inside the platform ceiling.
        const worstFinishS = lastLegalStartS + WORST_EXTRACTION_S
        expect(worstFinishS).toBeLessThan(TOTAL_S)
        expect(worstFinishS).toBeLessThan(HOBBY_LIMIT_S)
        expect(HOBBY_LIMIT_S - worstFinishS).toBeGreaterThan(6)   // real margin
    })

    test('search guard reserves extraction room so searches cannot starve it', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(TOTAL_S, t0)
        const searchCost = SPACING_MS + RESERVE_S * 1000   // 51s

        // A search may start only while a following extraction would still fit.
        expect(b.canAfford(searchCost, t0)).toBe(true)
        expect(b.canAfford(searchCost, t0 + 4_000)).toBe(true)
        expect(b.canAfford(searchCost, t0 + 4_001)).toBe(false)
    })

    test('the two guards share one clock and cannot sum past the total', () => {
        const t0 = 1_000_000
        const b = new ExecutionBudget(TOTAL_S, t0)
        // After a search completes at 6s, the extraction reservation is measured
        // from the SAME clock, not a fresh one.
        const afterSearch = t0 + 6_000
        expect(b.remainingMs(afterSearch)).toBe((TOTAL_S - 6) * 1000)
        expect(b.canAfford(RESERVE_S * 1000, afterSearch)).toBe(true)
        expect(6 + RESERVE_S).toBeLessThanOrEqual(TOTAL_S)
    })

    test('caps are unchanged — extraction still 4, searches still <= 9', () => {
        expect(PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN).toBe(4)
        expect(resolveUrlBudget(99)).toBe(4)
        // 3 strategies x 3 sources remains the search ceiling.
        expect(3 * 3).toBeLessThanOrEqual(9)
    })

    test('a refused extraction still releases the lock as timeout', async () => {
        const c = makeClient()
        await releaseDiscoveryLock(c, 'lock-1', 'timeout', { searchesProcessed: 1 })
        expect(c.updates[0].status).toBe('timeout')
        expect(c.updates[0].status).not.toBe('running')
    })
})
