/**
 * Firecrawl usage model.
 *
 * Pure and framework-free so every formula is unit-testable. Nothing here calls
 * a provider or a database.
 *
 * The central rule: what the provider told us and what we calculated are never
 * mixed. `actual` comes from a stored provider snapshot; everything derived is
 * an ESTIMATE and is labelled as one wherever it is shown.
 */

/** Provider-reported account state, exactly as stored in a snapshot row. */
export interface ProviderSnapshot {
    remainingCredits: number;
    planCredits: number | null;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
    fetchedAt: string;
}

/** Inclusive credit range. Used wherever a single number would be false precision. */
export interface CreditRange {
    low: number;
    high: number;
}

/**
 * The newest ledger row for one kind of run.
 *
 * Read from the existing `firecrawl_usage_ledgers` table — no new storage. The
 * reconciliation status travels with it because an unreconciled figure is
 * extraction only, and the panel must not present a lower bound as a total.
 */
export interface LastRunRecord {
    at: string;
    creditsConsumed: number;
    pagesScraped: number;
    reconciliation: string;
}

/** True when a recorded cost is a whole-run figure rather than a lower bound. */
export function isWholeRunCost(run: LastRunRecord | null): boolean {
    return run?.reconciliation === 'reconciled';
}

/**
 * Fallback per-run cost when no observed history exists.
 *
 * From the measured model `credits ≈ 4 + 5 × URLs extracted`: one search plus
 * one extraction is 9; one search plus the 4-URL cap is 24.
 */
export const FALLBACK_PER_RUN: CreditRange = { low: 9, high: 24 };

/** Held back so a forecast miss cannot drain the account. */
export const DEFAULT_SAFETY_RESERVE_FRACTION = 0.05;
export const MIN_SAFETY_RESERVE = 25;

/** A snapshot older than this is shown as stale. */
export const SNAPSHOT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export function normaliseProviderResponse(raw: unknown, fetchedAt: string): ProviderSnapshot | null {
    if (raw === null || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    const remaining = r.remainingCredits ?? r.remaining_credits;
    if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0) return null;

    const plan = r.planCredits ?? r.plan_credits;
    const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

    return {
        remainingCredits: Math.floor(remaining),
        planCredits: typeof plan === 'number' && Number.isFinite(plan) && plan >= 0 ? Math.floor(plan) : null,
        billingPeriodStart: asText(r.billingPeriodStart ?? r.billing_period_start),
        billingPeriodEnd: asText(r.billingPeriodEnd ?? r.billing_period_end),
        fetchedAt,
    };
}

/** Credits consumed so far. Only derivable when the plan size is known. */
export function actualUsed(snapshot: ProviderSnapshot): number | null {
    if (snapshot.planCredits === null) return null;
    return Math.max(0, snapshot.planCredits - snapshot.remainingCredits);
}

export function isSnapshotStale(snapshot: ProviderSnapshot, now: Date = new Date()): boolean {
    const age = now.getTime() - new Date(snapshot.fetchedAt).getTime();
    return !Number.isFinite(age) || age > SNAPSHOT_STALE_AFTER_MS;
}

/**
 * Per-run cost range, preferring observed history over the model.
 *
 * A single observation is not enough to claim precision, so the fallback range
 * is kept until at least two runs have been recorded.
 */
export function estimatePerRun(observedRunCosts: number[]): CreditRange {
    const valid = observedRunCosts.filter(c => typeof c === 'number' && Number.isFinite(c) && c > 0);
    if (valid.length < 2) return FALLBACK_PER_RUN;
    return { low: Math.min(...valid), high: Math.max(...valid) };
}

/**
 * Scheduled runs left in the billing period.
 *
 * The cron fires once daily, so this counts remaining days. Returns 0 when
 * daily discovery is off — a disabled schedule reserves nothing.
 */
export function remainingCronRuns(
    dailyDiscoveryEnabled: boolean,
    billingPeriodEnd: string | null,
    now: Date = new Date()
): number {
    if (!dailyDiscoveryEnabled) return 0;

    const end = billingPeriodEnd ? new Date(billingPeriodEnd) : endOfMonth(now);
    if (Number.isNaN(end.getTime())) return 0;

    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.floor((end.getTime() - now.getTime()) / msPerDay);
    return Math.max(0, days);
}

function endOfMonth(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
}

export function estimatedCronReserve(perRun: CreditRange, runsRemaining: number): CreditRange {
    const runs = Math.max(0, Math.floor(runsRemaining));
    return { low: perRun.low * runs, high: perRun.high * runs };
}

export function safetyReserve(planCredits: number | null): number {
    if (planCredits === null) return MIN_SAFETY_RESERVE;
    return Math.max(MIN_SAFETY_RESERVE, Math.floor(planCredits * DEFAULT_SAFETY_RESERVE_FRACTION));
}

/**
 * Credits that can be spent manually without eating into the scheduled runs.
 *
 *   low  = remaining − cronReserveHigh − safety   (assume runs cost their most)
 *   high = remaining − cronReserveLow  − safety   (assume they cost their least)
 *
 * Never negative: an over-committed forecast reports zero, not a deficit.
 */
export function estimatedManualAvailable(
    actualRemaining: number,
    cronReserve: CreditRange,
    reserve: number
): CreditRange {
    return {
        low: Math.max(0, actualRemaining - cronReserve.high - reserve),
        high: Math.max(0, actualRemaining - cronReserve.low - reserve),
    };
}

/** "9" for an exact range, "9–24" otherwise. Never invents decimals. */
export function formatRange(range: CreditRange): string {
    const low = Math.round(range.low);
    const high = Math.round(range.high);
    return low === high ? `${low}` : `${low}–${high}`;
}

export interface UsageSummary {
    actual: ProviderSnapshot | null;
    stale: boolean;
    usedCredits: number | null;
    perRun: CreditRange;
    runsRemaining: number;
    cronReserve: CreditRange;
    safetyReserve: number;
    manualAvailable: CreditRange;
    /** Newest manual run from the ledger, or null when none has been recorded. */
    lastManualRun: LastRunRecord | null;
}

/**
 * Assemble everything the panel renders.
 *
 * With no snapshot the actual block is absent and the derived figures are
 * zeroed rather than guessed — the UI then says the balance is unknown instead
 * of showing a fabricated number.
 */
export function buildUsageSummary(input: {
    snapshot: ProviderSnapshot | null;
    dailyDiscoveryEnabled: boolean;
    observedRunCosts: number[];
    lastManualRun?: LastRunRecord | null;
    now?: Date;
}): UsageSummary {
    const now = input.now ?? new Date();
    const lastManualRun = input.lastManualRun ?? null;
    const perRun = estimatePerRun(input.observedRunCosts);
    const runsRemaining = remainingCronRuns(
        input.dailyDiscoveryEnabled,
        input.snapshot?.billingPeriodEnd ?? null,
        now
    );
    const cronReserve = estimatedCronReserve(perRun, runsRemaining);

    if (!input.snapshot) {
        return {
            actual: null, stale: true, usedCredits: null, perRun, runsRemaining,
            cronReserve, safetyReserve: MIN_SAFETY_RESERVE,
            manualAvailable: { low: 0, high: 0 },
            lastManualRun,
        };
    }

    const reserve = safetyReserve(input.snapshot.planCredits);

    return {
        actual: input.snapshot,
        stale: isSnapshotStale(input.snapshot, now),
        usedCredits: actualUsed(input.snapshot),
        perRun,
        runsRemaining,
        cronReserve,
        safetyReserve: reserve,
        manualAvailable: estimatedManualAvailable(input.snapshot.remainingCredits, cronReserve, reserve),
        lastManualRun,
    };
}
