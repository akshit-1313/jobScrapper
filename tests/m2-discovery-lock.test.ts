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
    ExecutionBudget,
    getProfileSearchTimeoutSeconds,
    PROFILE_SEARCH_DEFAULT_TIMEOUT_SECONDS,
    PG_UNIQUE_VIOLATION,
} from '@/lib/jobs/discovery-lock'

// Minimal Supabase double: only the calls the lock helpers make.
function makeClient(opts: {
    insertResult?: { data?: { id: string } | null; error?: { code?: string; message: string } | null }
    updateError?: { message: string } | null
} = {}) {
    const updates: Array<Record<string, unknown>> = []
    const inserts: Array<Record<string, unknown>> = []

    const client = {
        updates, inserts,
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
