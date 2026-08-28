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
    PROFILE_SEARCH_DEFAULT_TIMEOUT_SECONDS,
    PG_UNIQUE_VIOLATION,
} from '@/lib/jobs/discovery-lock'

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
