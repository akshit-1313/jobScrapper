import 'server-only';
import FirecrawlApp from '@mendable/firecrawl-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    normaliseProviderResponse,
    buildUsageSummary,
    type ProviderSnapshot,
    type UsageSummary,
} from './usage-model';

/**
 * Firecrawl account usage — server only.
 *
 * The API key is read here and never leaves the server; callers receive only
 * sanitised numbers and timestamps.
 *
 * CONSERVATIVE BY DESIGN. The SDK exposes `GET /v2/team/credit-usage`, but
 * whether that endpoint consumes credits or counts against the provider's
 * request limit has NOT been established — the SDK carries no cost model and
 * ships no statement about it. Both are therefore treated as unknown:
 *
 *   - page renders NEVER call the provider; they read the newest stored snapshot
 *   - the provider is contacted only on an explicit refresh, after a manual run,
 *     or after a cron run
 *   - a server-side TTL collapses repeated refreshes
 *   - it does NOT go through the search rate gate, because consuming that
 *     budget would delay real discovery searches by 6s each
 *
 * If the endpoint later proves free and unthrottled, the TTL can be relaxed
 * without touching anything else.
 */

/** Repeated refreshes inside this window reuse the stored snapshot. */
export const REFRESH_TTL_MS = 60_000;

export interface UsagePanelData extends UsageSummary {
    /** True when the last provider fetch failed and a stored snapshot is shown. */
    lastRefreshFailed: boolean;
}

async function readLatestSnapshot(): Promise<ProviderSnapshot | null> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('firecrawl_account_snapshots')
        .select('remaining_credits, plan_credits, billing_period_start, billing_period_end, fetched_at')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !data) return null;

    return {
        remainingCredits: data.remaining_credits,
        planCredits: data.plan_credits ?? null,
        billingPeriodStart: data.billing_period_start ?? null,
        billingPeriodEnd: data.billing_period_end ?? null,
        fetchedAt: data.fetched_at,
    };
}

/**
 * Ask the provider for the current balance and store it.
 *
 * Returns null on any failure — including a 429, which the SDK does not retry —
 * so the caller keeps the previous snapshot and reports its real age rather
 * than showing a gap or a fabricated number.
 */
async function fetchAndStoreSnapshot(): Promise<ProviderSnapshot | null> {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
        console.error('[FirecrawlUsage] FIRECRAWL_API_KEY is not configured.');
        return null;
    }

    try {
        const app = new FirecrawlApp({ apiKey });
        const raw = await (app as unknown as { getCreditUsage: () => Promise<unknown> }).getCreditUsage();

        const snapshot = normaliseProviderResponse(raw, new Date().toISOString());
        if (!snapshot) {
            console.error('[FirecrawlUsage] Provider returned an unusable credit-usage payload.');
            return null;
        }

        const admin = createAdminClient();
        const { error } = await admin.from('firecrawl_account_snapshots').insert({
            remaining_credits: snapshot.remainingCredits,
            plan_credits: snapshot.planCredits,
            billing_period_start: snapshot.billingPeriodStart,
            billing_period_end: snapshot.billingPeriodEnd,
            fetched_at: snapshot.fetchedAt,
        });

        // Non-fatal: a failed write must not lose the value we just read.
        if (error) console.error('[FirecrawlUsage] Snapshot write failed:', error.message);

        return snapshot;
    } catch (err) {
        // Never log the key or the raw error object.
        const message = err instanceof Error ? err.message : 'unknown provider error';
        console.error(`[FirecrawlUsage] Credit-usage lookup failed: ${message}`);
        return null;
    }
}

/** True when the stored snapshot is fresh enough to skip a provider call. */
function withinTtl(snapshot: ProviderSnapshot | null, now: Date): boolean {
    if (!snapshot) return false;
    const age = now.getTime() - new Date(snapshot.fetchedAt).getTime();
    return Number.isFinite(age) && age >= 0 && age < REFRESH_TTL_MS;
}

/**
 * Refresh the stored balance, subject to the TTL.
 *
 * Called after an explicit user refresh, after a manual discovery run, and
 * after a cron run — never on render.
 */
export async function refreshUsageSnapshot(now: Date = new Date()): Promise<ProviderSnapshot | null> {
    const existing = await readLatestSnapshot();
    if (withinTtl(existing, now)) return existing;

    const fresh = await fetchAndStoreSnapshot();
    return fresh ?? existing;
}

/** Observed per-run costs, newest first, used to narrow the forecast range. */
async function readObservedRunCosts(limit = 20): Promise<number[]> {
    const admin = createAdminClient();
    const { data } = await admin
        .from('firecrawl_usage_ledgers')
        .select('credits_consumed, reconciliation_status')
        .order('created_at', { ascending: false })
        .limit(limit);

    // Only fully reconciled rows describe a whole run; a partial figure would
    // bias the forecast downward.
    return (data ?? [])
        .filter(r => r.reconciliation_status === 'reconciled')
        .map(r => r.credits_consumed)
        .filter((c): c is number => typeof c === 'number' && c > 0);
}

/**
 * Everything the panel renders. Reads stored data only — no provider call.
 */
export async function getUsagePanelData(
    dailyDiscoveryEnabled: boolean,
    now: Date = new Date()
): Promise<UsagePanelData> {
    const [snapshot, observedRunCosts] = await Promise.all([
        readLatestSnapshot(),
        readObservedRunCosts(),
    ]);

    return {
        ...buildUsageSummary({ snapshot, dailyDiscoveryEnabled, observedRunCosts, now }),
        lastRefreshFailed: false,
    };
}
