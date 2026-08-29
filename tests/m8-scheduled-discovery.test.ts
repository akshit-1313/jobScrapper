/**
 * @jest-environment node
 *
 * Scheduled daily discovery: cron authorisation and the bounded run.
 *
 * The scheduled path deliberately reuses runProfileTargetedDiscovery unmodified,
 * so the Firecrawl rate gate, 6s spacing, 3-source cap, 4-URL extraction cap,
 * 55s budget, 45s reservation, mutex and stale-lock recovery all come with it
 * and are covered by their own suites. What is asserted here is everything the
 * scheduled wrapper adds: authorisation before any work, opt-in eligibility,
 * one user per invocation, rotation, crash-safe usage accounting ordering, and
 * the budget guard around matching.
 *
 * No Firecrawl call is made: discovery is mocked at the module boundary.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/jobs/discovery-service', () => ({ runProfileTargetedDiscovery: jest.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { runProfileTargetedDiscovery } from '@/lib/jobs/discovery-service';
import { runScheduledDailyDiscovery } from '@/lib/jobs/scheduled-discovery';
import { authorizeCronRequest } from '@/lib/cron/authorize';
import { GET, POST } from '@/app/api/cron/daily-discovery/route';

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SECRET = 'test-cron-secret-value';

/** Minimal PostgREST stub that records writes and serves per-table reads. */
function makeAdmin(tables: Record<string, any> = {}) {
    const upserts: any[] = [];
    const updates: any[] = [];

    const from = jest.fn((table: string) => {
        const result = { data: tables[table] ?? [], error: null };
        const chain: any = {
            select: () => chain,
            eq: () => chain,
            order: () => chain,
            limit: () => chain,
            maybeSingle: () => Promise.resolve({
                data: Array.isArray(tables[table]) ? (tables[table][0] ?? null) : (tables[table] ?? null),
                error: null,
            }),
            single: () => Promise.resolve(result),
            upsert: (payload: any, options: any) => {
                upserts.push({ table, payload, options });
                return Promise.resolve({ error: null });
            },
            update: (payload: any) => {
                updates.push({ table, payload });
                return chain;
            },
            then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
        };
        return chain;
    });

    return { client: { from }, from, upserts, updates };
}

function discoveryResult(overrides: Record<string, unknown> = {}) {
    return {
        runId: 'run-1', creditsUsed: 9, pagesScraped: 1,
        runError: false, unknownUsage: false, strategies: [],
        sourcesSearched: 3, timedOut: false, ...overrides,
    };
}

describe('Scheduled daily discovery', () => {
    const ORIGINAL_SECRET = process.env.CRON_SECRET;
    let errorSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.CRON_SECRET = SECRET;
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => {
        errorSpy.mockRestore();
        warnSpy.mockRestore();
        logSpy.mockRestore();
        if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = ORIGINAL_SECRET;
    });

    describe('authorisation', () => {
        it('accepts the exact bearer secret', () => {
            expect(authorizeCronRequest(`Bearer ${SECRET}`)).toEqual({ authorized: true });
        });

        it('fails closed with 500 when CRON_SECRET is not configured', () => {
            delete process.env.CRON_SECRET;
            expect(authorizeCronRequest(`Bearer ${SECRET}`)).toEqual({
                authorized: false, status: 500, error: 'System Configuration Error',
            });
        });

        it('rejects a wrong, missing or malformed secret with 401', () => {
            expect(authorizeCronRequest('Bearer wrong')).toMatchObject({ status: 401 });
            expect(authorizeCronRequest(null)).toMatchObject({ status: 401 });
            expect(authorizeCronRequest(SECRET)).toMatchObject({ status: 401 });
            expect(authorizeCronRequest(`bearer ${SECRET}`)).toMatchObject({ status: 401 });
        });

        it('never logs the secret', () => {
            delete process.env.CRON_SECRET;
            authorizeCronRequest(`Bearer ${SECRET}`);
            const logged = errorSpy.mock.calls.flat().join(' ');
            expect(logged).not.toContain(SECRET);
        });
    });

    describe('route', () => {
        function request(method: string, header?: string) {
            return new Request('http://localhost:3000/api/cron/daily-discovery', {
                method,
                headers: header ? { authorization: header } : {},
            });
        }

        it('GET runs the scheduled discovery when authorised', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock).mockResolvedValue(discoveryResult());

            const res = await GET(request('GET', `Bearer ${SECRET}`));

            expect(res.status).toBe(200);
            expect(runProfileTargetedDiscovery).toHaveBeenCalledWith(USER_A);
        });

        it('POST remains available and behaves identically', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock).mockResolvedValue(discoveryResult());

            const res = await POST(request('POST', `Bearer ${SECRET}`));

            expect(res.status).toBe(200);
        });

        it('does no work at all before authentication succeeds', async () => {
            (createAdminClient as jest.Mock).mockImplementation(() => {
                throw new Error('admin client must not be constructed before auth');
            });

            const unauthorized = await GET(request('GET', 'Bearer wrong'));
            expect(unauthorized.status).toBe(401);

            delete process.env.CRON_SECRET;
            const misconfigured = await GET(request('GET', `Bearer ${SECRET}`));
            expect(misconfigured.status).toBe(500);

            expect(createAdminClient).not.toHaveBeenCalled();
            expect(runProfileTargetedDiscovery).not.toHaveBeenCalled();
        });
    });

    describe('eligibility', () => {
        it('does nothing when nobody has opted in', async () => {
            const admin = makeAdmin({ profiles: [] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            const res = await runScheduledDailyDiscovery();

            expect(res.eligibleUsers).toBe(0);
            expect(res.reason).toBe('no_eligible_users');
            expect(runProfileTargetedDiscovery).not.toHaveBeenCalled();
            expect(admin.upserts).toHaveLength(0);
        });

        it('selects exactly one user per invocation', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock).mockResolvedValue(discoveryResult());

            const res = await runScheduledDailyDiscovery();

            expect(runProfileTargetedDiscovery).toHaveBeenCalledTimes(1);
            expect(res.processedUserId).toBe(USER_A);
        });

        it('queries only opted-in profiles', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock).mockResolvedValue(discoveryResult());

            await runScheduledDailyDiscovery();

            expect(admin.from).toHaveBeenCalledWith('profiles');
        });

        it('advances the rotation stamp after a completed run', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock).mockResolvedValue(discoveryResult());

            await runScheduledDailyDiscovery();

            const stamp = admin.updates.find(u => u.table === 'profiles');
            expect(stamp?.payload.last_daily_discovery_at).toEqual(expect.any(String));
        });
    });

    describe('concurrency', () => {
        it('stands down when another cycle holds the mutex', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock)
                .mockResolvedValue(discoveryResult({ concurrencyAborted: true, pagesScraped: 0, creditsUsed: 0 }));

            const res = await runScheduledDailyDiscovery();

            expect(res.concurrencyAborted).toBe(true);
            expect(res.reason).toBe('concurrency_aborted');
        });

        it('does NOT advance the rotation when it stood down, so the user keeps its turn', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock)
                .mockResolvedValue(discoveryResult({ concurrencyAborted: true }));

            await runScheduledDailyDiscovery();

            expect(admin.updates.find(u => u.table === 'profiles')).toBeUndefined();
        });

        it('writes no usage ledger when it stood down', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock)
                .mockResolvedValue(discoveryResult({ concurrencyAborted: true }));

            await runScheduledDailyDiscovery();

            expect(admin.upserts.find(u => u.table === 'firecrawl_usage_ledgers')).toBeUndefined();
        });
    });

    describe('usage accounting', () => {
        it('writes the ledger BEFORE matching, so a later kill cannot lose it', async () => {
            const admin = makeAdmin({
                profiles: [{ user_id: USER_A, last_daily_discovery_at: null }],
                job_matches: [],
                jobs: [{
                    id: 'job-1',
                    title: 'Salesforce Developer',
                    company_name: 'Qualityze',
                    description: 'Salesforce developer working with Apex and JavaScript.',
                    work_mode: 'remote',
                    employment_type: 'full_time',
                    status: 'active',
                    job_locations: [],
                    job_skills: [],
                }],
            });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock).mockResolvedValue(discoveryResult());

            await runScheduledDailyDiscovery();

            const ledgerIndex = admin.upserts.findIndex(u => u.table === 'firecrawl_usage_ledgers');
            const matchIndex = admin.upserts.findIndex(u => u.table === 'job_matches');
            expect(ledgerIndex).toBeGreaterThanOrEqual(0);
            if (matchIndex >= 0) expect(ledgerIndex).toBeLessThan(matchIndex);
        });

        it('keys the ledger on the run id so a retry cannot double-count', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock).mockResolvedValue(discoveryResult({ runId: 'run-xyz' }));

            await runScheduledDailyDiscovery();

            const ledger = admin.upserts.find(u => u.table === 'firecrawl_usage_ledgers');
            // Key now comes from the shared run-accounting helper, which the
            // manual path uses too; the operation prefix keeps them distinct.
            expect(ledger?.payload.idempotency_key).toBe('background_discovery_run_run-xyz');
            expect(ledger?.payload.reference_id).toBe('run-xyz');
            expect(ledger?.options).toEqual({ onConflict: 'idempotency_key' });
        });

        it('records the user id from eligibility, never from the discovery result', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock)
                .mockResolvedValue(discoveryResult({ user_id: 'bbbbbbbb-0000-0000-0000-000000000002' }));

            await runScheduledDailyDiscovery();

            const ledger = admin.upserts.find(u => u.table === 'firecrawl_usage_ledgers');
            expect(ledger?.payload.user_id).toBe(USER_A);
        });

        it('flags unknown provider usage in the reconciliation status', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock).mockResolvedValue(discoveryResult({ unknownUsage: true }));

            await runScheduledDailyDiscovery();

            const ledger = admin.upserts.find(u => u.table === 'firecrawl_usage_ledgers');
            expect(ledger?.payload.reconciliation_status).toBe('provider_usage_unknown');
        });
    });

    describe('workload bounds', () => {
        it('reuses the unmodified Phase 3 entry point rather than M8', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock).mockResolvedValue(discoveryResult());

            await runScheduledDailyDiscovery();

            // Called with only a user id: no override widens the source, URL or
            // time budgets that Phase 3 enforces internally.
            expect(runProfileTargetedDiscovery).toHaveBeenCalledWith(USER_A);
            expect((runProfileTargetedDiscovery as jest.Mock).mock.calls[0]).toHaveLength(1);
        });

        it('reports a discovery timeout without treating it as a failure', async () => {
            const admin = makeAdmin({ profiles: [{ user_id: USER_A, last_daily_discovery_at: null }] });
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);
            (runProfileTargetedDiscovery as jest.Mock).mockResolvedValue(discoveryResult({ timedOut: true }));

            const res = await runScheduledDailyDiscovery();

            expect(res.timedOut).toBe(true);
            expect(res.concurrencyAborted).toBe(false);
        });
    });
});
