/**
 * Firecrawl usage model and run accounting.
 *
 * The dashboard must never present a calculation as a provider figure. These
 * tests pin that separation, the forecast formulas, the staleness rules, and
 * the honesty of the ledger's reconciliation status.
 *
 * No provider call is made anywhere: the model is pure, and the accounting
 * helper is exercised against a stub client.
 *
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('server-only', () => ({}), { virtual: true });

import {
    normaliseProviderResponse,
    actualUsed,
    isSnapshotStale,
    estimatePerRun,
    remainingCronRuns,
    estimatedCronReserve,
    safetyReserve,
    estimatedManualAvailable,
    formatRange,
    buildUsageSummary,
    FALLBACK_PER_RUN,
    MIN_SAFETY_RESERVE,
    SNAPSHOT_STALE_AFTER_MS,
    type ProviderSnapshot,
} from '@/lib/firecrawl/usage-model';
import { recordRunUsage, resolveReconciliation, billingMonth } from '@/lib/firecrawl/run-accounting';

const NOW = new Date('2026-08-29T12:00:00Z');

const SNAPSHOT: ProviderSnapshot = {
    remainingCredits: 935,
    planCredits: 1000,
    billingPeriodStart: '2026-08-01T00:00:00Z',
    billingPeriodEnd: '2026-09-23T00:00:00Z',
    fetchedAt: '2026-08-29T11:45:00Z',
};

describe('Provider response normalization', () => {
    it('maps the documented camelCase shape', () => {
        const s = normaliseProviderResponse({
            remainingCredits: 935, planCredits: 1000,
            billingPeriodStart: '2026-08-01T00:00:00Z', billingPeriodEnd: '2026-09-01T00:00:00Z',
        }, NOW.toISOString());

        expect(s).toEqual({
            remainingCredits: 935, planCredits: 1000,
            billingPeriodStart: '2026-08-01T00:00:00Z', billingPeriodEnd: '2026-09-01T00:00:00Z',
            fetchedAt: NOW.toISOString(),
        });
    });

    it('accepts the v1 snake_case shape', () => {
        const s = normaliseProviderResponse({ remaining_credits: 500, plan_credits: 1000 }, NOW.toISOString());
        expect(s?.remainingCredits).toBe(500);
        expect(s?.planCredits).toBe(1000);
    });

    it('tolerates a missing plan size', () => {
        const s = normaliseProviderResponse({ remainingCredits: 42 }, NOW.toISOString());
        expect(s?.planCredits).toBeNull();
        expect(s?.billingPeriodStart).toBeNull();
    });

    it('rejects unusable payloads rather than inventing a balance', () => {
        for (const bad of [null, undefined, 'x', 42, {}, { remainingCredits: 'lots' }, { remainingCredits: -5 }, { remainingCredits: NaN }]) {
            expect(normaliseProviderResponse(bad, NOW.toISOString())).toBeNull();
        }
    });
});

describe('Actual figures', () => {
    it('derives used credits only when the plan size is known', () => {
        expect(actualUsed(SNAPSHOT)).toBe(65);
        expect(actualUsed({ ...SNAPSHOT, planCredits: null })).toBeNull();
    });

    it('never reports negative usage', () => {
        expect(actualUsed({ ...SNAPSHOT, remainingCredits: 1200 })).toBe(0);
    });
});

describe('Staleness', () => {
    it('a fresh snapshot is not stale', () => {
        expect(isSnapshotStale(SNAPSHOT, NOW)).toBe(false);
    });

    it('an old snapshot is stale', () => {
        const old = { ...SNAPSHOT, fetchedAt: new Date(NOW.getTime() - SNAPSHOT_STALE_AFTER_MS - 1000).toISOString() };
        expect(isSnapshotStale(old, NOW)).toBe(true);
    });

    it('an unparseable timestamp counts as stale', () => {
        expect(isSnapshotStale({ ...SNAPSHOT, fetchedAt: 'not-a-date' }, NOW)).toBe(true);
    });
});

describe('Per-run estimate', () => {
    it('uses the measured model until there is real history', () => {
        expect(estimatePerRun([])).toEqual(FALLBACK_PER_RUN);
        expect(estimatePerRun([13])).toEqual(FALLBACK_PER_RUN);
    });

    it('narrows to the observed range once two runs exist', () => {
        expect(estimatePerRun([13, 9, 24])).toEqual({ low: 9, high: 24 });
    });

    it('ignores zero and malformed observations', () => {
        expect(estimatePerRun([0, -3, NaN as any, 11, 15])).toEqual({ low: 11, high: 15 });
    });
});

describe('Cron reserve', () => {
    it('counts remaining daily runs to the billing period end', () => {
        expect(remainingCronRuns(true, '2026-09-23T00:00:00Z', NOW)).toBe(24);
    });

    it('reserves nothing when daily discovery is off', () => {
        expect(remainingCronRuns(false, '2026-09-23T00:00:00Z', NOW)).toBe(0);
    });

    it('falls back to month end when the period is unknown', () => {
        expect(remainingCronRuns(true, null, NOW)).toBeGreaterThan(0);
    });

    it('never goes negative past the period end', () => {
        expect(remainingCronRuns(true, '2026-08-01T00:00:00Z', NOW)).toBe(0);
    });

    it('multiplies the per-run range by the run count', () => {
        expect(estimatedCronReserve({ low: 9, high: 14 }, 25)).toEqual({ low: 225, high: 350 });
        expect(estimatedCronReserve({ low: 9, high: 14 }, 0)).toEqual({ low: 0, high: 0 });
    });
});

describe('Manual available budget', () => {
    it('subtracts the cron reserve and the safety reserve', () => {
        // 935 − 350 − 50 = 535 ; 935 − 225 − 50 = 660
        expect(estimatedManualAvailable(935, { low: 225, high: 350 }, 50))
            .toEqual({ low: 535, high: 660 });
    });

    it('reports zero rather than a deficit when over-committed', () => {
        expect(estimatedManualAvailable(100, { low: 500, high: 900 }, 50))
            .toEqual({ low: 0, high: 0 });
    });

    it('scales the safety reserve with the plan, with a floor', () => {
        expect(safetyReserve(1000)).toBe(50);
        expect(safetyReserve(100)).toBe(MIN_SAFETY_RESERVE);
        expect(safetyReserve(null)).toBe(MIN_SAFETY_RESERVE);
    });
});

describe('Range formatting avoids false precision', () => {
    it('shows a single number only when the range is exact', () => {
        expect(formatRange({ low: 9, high: 9 })).toBe('9');
        expect(formatRange({ low: 9, high: 24 })).toBe('9–24');
    });
});

describe('Usage summary', () => {
    it('combines actual and estimated without mixing them', () => {
        const s = buildUsageSummary({
            snapshot: SNAPSHOT, dailyDiscoveryEnabled: true, observedRunCosts: [9, 14], now: NOW,
        });

        expect(s.actual).toEqual(SNAPSHOT);          // provider figures, untouched
        expect(s.usedCredits).toBe(65);
        expect(s.perRun).toEqual({ low: 9, high: 14 });
        expect(s.runsRemaining).toBe(24);
        expect(s.cronReserve).toEqual({ low: 216, high: 336 });
        expect(s.manualAvailable.low).toBeLessThan(s.manualAvailable.high);
    });

    it('shows no balance and no fabricated budget when nothing is stored', () => {
        const s = buildUsageSummary({
            snapshot: null, dailyDiscoveryEnabled: true, observedRunCosts: [], now: NOW,
        });

        expect(s.actual).toBeNull();
        expect(s.usedCredits).toBeNull();
        expect(s.stale).toBe(true);
        expect(s.manualAvailable).toEqual({ low: 0, high: 0 });
    });

    it('reserves nothing for cron when the schedule is off', () => {
        const s = buildUsageSummary({
            snapshot: SNAPSHOT, dailyDiscoveryEnabled: false, observedRunCosts: [9, 14], now: NOW,
        });
        expect(s.runsRemaining).toBe(0);
        expect(s.cronReserve).toEqual({ low: 0, high: 0 });
    });
});

describe('Run accounting honesty', () => {
    it('never calls an extraction-only figure a reconciled total', () => {
        expect(resolveReconciliation({
            userId: 'u', runId: 'r', creditsUsed: 9, pagesScraped: 1,
            unknownUsage: false, operation: 'manual_discovery',
        })).toBe('provider_usage_unknown');
    });

    it('only a measured balance delta counts as reconciled', () => {
        expect(resolveReconciliation({
            userId: 'u', runId: 'r', creditsUsed: 9, pagesScraped: 1,
            unknownUsage: false, operation: 'manual_discovery', measuredTotal: 13,
        })).toBe('reconciled');
    });

    it('marks a failed run with no attributable usage', () => {
        expect(resolveReconciliation({
            userId: 'u', runId: 'r', creditsUsed: 0, pagesScraped: 0,
            unknownUsage: true, runError: true, operation: 'manual_discovery',
        })).toBe('failed_unverified');
    });

    it('writes a manual run keyed for idempotency', async () => {
        const upserts: any[] = [];
        const admin = {
            from: () => ({
                upsert: (payload: any, options: any) => {
                    upserts.push({ payload, options });
                    return Promise.resolve({ error: null });
                },
            }),
        } as any;

        await recordRunUsage(admin, {
            userId: 'user-1', runId: 'run-9', creditsUsed: 5, pagesScraped: 1,
            unknownUsage: false, operation: 'manual_discovery',
        }, NOW);

        expect(upserts[0].payload).toMatchObject({
            user_id: 'user-1',
            operation_type: 'manual_discovery',
            credits_consumed: 5,
            pages_scraped: 1,
            reference_id: 'run-9',
            reconciliation_status: 'provider_usage_unknown',
            idempotency_key: 'manual_discovery_run_run-9',
            billing_month: '2026-08',
        });
        expect(upserts[0].options).toEqual({ onConflict: 'idempotency_key' });
    });

    it('distinguishes manual and scheduled ledger keys', async () => {
        const keys: string[] = [];
        const admin = {
            from: () => ({
                upsert: (payload: any) => { keys.push(payload.idempotency_key); return Promise.resolve({ error: null }); },
            }),
        } as any;

        const base = { userId: 'u', runId: 'r1', creditsUsed: 1, pagesScraped: 1, unknownUsage: false };
        await recordRunUsage(admin, { ...base, operation: 'manual_discovery' }, NOW);
        await recordRunUsage(admin, { ...base, operation: 'background_discovery' }, NOW);

        expect(keys).toEqual(['manual_discovery_run_r1', 'background_discovery_run_r1']);
    });

    it('never throws when the ledger write fails', async () => {
        const admin = {
            from: () => ({ upsert: () => Promise.resolve({ error: { message: 'denied' } }) }),
        } as any;
        const spy = jest.spyOn(console, 'error').mockImplementation(() => { });

        await expect(recordRunUsage(admin, {
            userId: 'u', runId: 'r', creditsUsed: 1, pagesScraped: 1,
            unknownUsage: false, operation: 'manual_discovery',
        })).resolves.toBeUndefined();

        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('derives the billing month in UTC', () => {
        expect(billingMonth(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01');
        expect(billingMonth(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
    });
});

describe('No credential exposure', () => {
    const read = (p: string) =>
        require('fs').readFileSync(require('path').join(__dirname, '..', 'src', ...p.split('/')), 'utf8');

    it('the model is pure and never touches the API key', () => {
        const code = read('lib/firecrawl/usage-model.ts');
        expect(code).not.toContain('FIRECRAWL_API_KEY');
        expect(code).not.toContain('process.env');
    });

    it('the client panel never references any credential', () => {
        const code = read('components/firecrawl/firecrawl-usage-panel.tsx');
        expect(code).not.toContain('FIRECRAWL_API_KEY');
        expect(code).not.toContain('SERVICE_ROLE');
        expect(code).not.toContain('process.env');
    });

    it('the service is server-only and does not route through the search rate gate', () => {
        const code = read('lib/firecrawl/usage-service.ts');
        expect(code).toContain("import 'server-only'");
        expect(code).not.toContain('acquireSearchSlot');
    });

    it('the refresh action returns no provider payload to the browser', () => {
        const code = read('app/actions/usage-actions.ts');
        expect(code).not.toContain('remainingCredits');
        expect(code).not.toContain('FIRECRAWL_API_KEY');
    });
});
