import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Record what one discovery run consumed.
 *
 * Shared by the manual and scheduled paths so both write an identical row — the
 * manual path previously wrote nothing at all, which is why no manual run has
 * ever appeared in the ledger.
 *
 * HONESTY ABOUT WHAT THIS NUMBER IS
 * `creditsUsed` comes from the provider's per-scrape `metadata.creditsUsed`.
 * It is genuine, but it is EXTRACTION ONLY: `searchJobs()` reports no credits,
 * so the search portion of a run (~4 credits by the measured model) is invisible
 * to us. A run's recorded figure is therefore a LOWER BOUND, never the total.
 *
 * That is reflected in reconciliation_status rather than hidden:
 *   provider_usage_unknown — the provider reported nothing, or reported only
 *                            extraction credits while search cost is unknown
 *   reconciled             — the figure is a whole-run cost (a balance delta)
 *   failed_unverified      — the run errored and no usage could be attributed
 *
 * Only `reconciled` rows feed the forecast, so a partial figure cannot bias it
 * downward.
 */
export type RunReconciliation = 'reconciled' | 'provider_usage_unknown' | 'failed_unverified';

export interface RunUsageInput {
    userId: string;
    runId: string;
    /** Provider-reported extraction credits. Extraction only — see above. */
    creditsUsed: number;
    pagesScraped: number;
    /** True when the provider reported no usage figure at all. */
    unknownUsage: boolean;
    /** True when the run itself failed. */
    runError?: boolean;
    /** Distinguishes the manual and scheduled ledger keys. */
    operation: 'manual_discovery' | 'background_discovery';
    /**
     * Whole-run cost measured from a provider balance delta, when available.
     * Only this can be called `reconciled`.
     */
    measuredTotal?: number | null;
}

export function billingMonth(now: Date = new Date()): string {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function resolveReconciliation(input: RunUsageInput): RunReconciliation {
    if (typeof input.measuredTotal === 'number' && input.measuredTotal >= 0) return 'reconciled';
    if (input.runError && input.creditsUsed === 0) return 'failed_unverified';
    // Extraction-only figures are never a complete run cost.
    return 'provider_usage_unknown';
}

/**
 * Write the usage row.
 *
 * Keyed on the search run id so a retry cannot double-count. Never throws: the
 * run already succeeded and crawl_runs already record the pages, so losing the
 * ledger row must not fail the invocation.
 */
export async function recordRunUsage(
    admin: SupabaseClient,
    input: RunUsageInput,
    now: Date = new Date()
): Promise<void> {
    const credits = typeof input.measuredTotal === 'number' && input.measuredTotal >= 0
        ? input.measuredTotal
        : Math.max(0, input.creditsUsed);

    const { error } = await admin.from('firecrawl_usage_ledgers').upsert({
        user_id: input.userId,
        billing_month: billingMonth(now),
        operation_type: input.operation,
        credits_consumed: credits,
        pages_scraped: Math.max(0, input.pagesScraped),
        reference_id: input.runId,
        reconciliation_status: resolveReconciliation(input),
        idempotency_key: `${input.operation}_run_${input.runId}`,
    }, { onConflict: 'idempotency_key' });

    if (error) {
        console.error(`[RunAccounting] usage ledger write failed: ${error.message}`);
    }
}
