/**
 * Cross-instance mutual exclusion for discovery runs.
 *
 * This is NOT a new locking system. It reuses the mutex M8 established in
 * migration 012:
 *
 *   CREATE UNIQUE INDEX m8_cron_runs_single_running
 *     ON public.m8_cron_runs (status) WHERE status = 'running';
 *
 * Only one row may hold status='running', so a second concurrent attempt fails
 * with PostgreSQL unique-violation 23505. Because the constraint lives in the
 * database, it holds across processes, server instances and serverless
 * invocations — unlike the adapter's in-process rate gate, which only spaces
 * requests within a single Node process.
 *
 * `executeBackgroundDiscovery` (M8) already uses this pattern; its behaviour is
 * unchanged. These helpers exist so the Phase 3 profile-targeted path can use
 * the SAME lock without duplicating the acquire/release logic.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** PostgreSQL unique_violation — another cycle already holds the lock. */
export const PG_UNIQUE_VIOLATION = '23505';

export type DiscoveryLockStatus = 'completed' | 'failed' | 'timeout';

export interface LockAcquired {
    acquired: true;
    runId: string;
}

export interface LockRejected {
    acquired: false;
    /** 'busy' = another cycle running. 'error' = the lock store itself failed. */
    reason: 'busy' | 'error';
    error?: string;
}

export type LockResult = LockAcquired | LockRejected;

/**
 * Attempt to take the global discovery lock.
 *
 * Returns `{ acquired: false, reason: 'busy' }` on 23505 — the caller must
 * abort WITHOUT performing any external work (no Firecrawl call, no credits).
 */
export async function acquireDiscoveryLock(
    supabase: SupabaseClient
): Promise<LockResult> {
    const { data, error } = await supabase
        .from('m8_cron_runs')
        .insert({ status: 'running' })
        .select('id')
        .single();

    if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
            console.warn('[DISCOVERY_LOCK] Another discovery cycle is running; aborting cleanly.');
            return { acquired: false, reason: 'busy' };
        }
        console.error('[DISCOVERY_LOCK] Lock acquisition failed:', error.message);
        return { acquired: false, reason: 'error', error: error.message };
    }

    if (!data?.id) {
        return { acquired: false, reason: 'error', error: 'Lock insert returned no id' };
    }

    return { acquired: true, runId: data.id };
}

/**
 * Release the lock by transitioning it out of 'running'.
 *
 * MUST be called on every exit path — success, failure and timeout — or the
 * partial unique index will block all future runs. Never throws: a failure to
 * release is logged, because it must not mask the original error.
 */
export async function releaseDiscoveryLock(
    supabase: SupabaseClient,
    lockRunId: string,
    status: DiscoveryLockStatus,
    details?: { searchesProcessed?: number; errorLog?: string }
): Promise<void> {
    try {
        const { error } = await supabase
            .from('m8_cron_runs')
            .update({
                status,
                completed_at: new Date().toISOString(),
                searches_processed: details?.searchesProcessed ?? 0,
                error_log: details?.errorLog ?? null,
            })
            .eq('id', lockRunId);

        if (error) {
            console.error(`[DISCOVERY_LOCK] Failed to release lock ${lockRunId}:`, error.message);
        }
    } catch (e) {
        console.error('[DISCOVERY_LOCK] Unexpected error releasing lock:', e);
    }
}

// ── Execution time budget ───────────────────────────────────────────────────
//
// M8's WORKLOAD_LIMITS.timeout_seconds is 55s, tuned for M8's own workload
// (5 searches per invoke, no enforced inter-request spacing).
//
// The profile-targeted path has fundamentally different timing: Firecrawl's
// ~10 req/min ceiling forces ~6s between searches, so a full 9-search pass
// spends ~54s on spacing ALONE before any extraction. Measured live runs took
// 57s (9 searches, 0 extractions) and 55s (1 search, 4 extractions).
//
// Reusing M8's 55s here would abort the run before its searches could finish,
// so Phase 3 carries its own budget. M8's configuration is left untouched.

export const PROFILE_SEARCH_DEFAULT_TIMEOUT_SECONDS = 90;

/** Configurable via PROFILE_SEARCH_TIMEOUT_SECONDS. */
export function getProfileSearchTimeoutSeconds(): number {
    const raw = process.env.PROFILE_SEARCH_TIMEOUT_SECONDS;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return PROFILE_SEARCH_DEFAULT_TIMEOUT_SECONDS;
}

/**
 * Tracks the remaining execution budget for one run.
 *
 * Checks happen BEFORE starting an expensive operation, never during one: an
 * in-flight search or extraction is always allowed to finish, so the budget
 * never interrupts work destructively or leaves a half-written record.
 */
export class ExecutionBudget {
    private readonly startedAt: number;
    private readonly budgetMs: number;

    constructor(timeoutSeconds: number = getProfileSearchTimeoutSeconds(), now: number = Date.now()) {
        this.startedAt = now;
        this.budgetMs = Math.max(1, timeoutSeconds) * 1000;
    }

    elapsedMs(now: number = Date.now()): number {
        return now - this.startedAt;
    }

    remainingMs(now: number = Date.now()): number {
        return this.budgetMs - this.elapsedMs(now);
    }

    /** True once the budget is spent. */
    isExhausted(now: number = Date.now()): boolean {
        return this.remainingMs(now) <= 0;
    }

    /**
     * True when there is room to start another operation costing ~costMs.
     *
     * Callers pass the realistic cost of the NEXT step (for a search, at least
     * the rate-gate spacing) so a run stops before overrunning rather than
     * being killed mid-flight by the platform.
     */
    canAfford(costMs: number, now: number = Date.now()): boolean {
        return this.remainingMs(now) >= costMs;
    }
}
