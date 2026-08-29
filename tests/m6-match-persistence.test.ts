/**
 * @jest-environment node
 *
 * M6 match persistence.
 *
 * Production evidence: a profile-targeted discovery run created a job, a
 * crawl_run and a source mapping, but job_matches did not grow and no existing
 * row's scored_at moved. Cause: job_matches carries a SELECT-only RLS policy
 * (006_rls_policies.sql:144 — "Server-generated data ... writes via
 * service-role"), while match-actions performed the upsert with the
 * authenticated request client. Every write was rejected and the error was
 * discarded by `if (!error) successCount++`, so the action still reported
 * success.
 *
 * These tests pin the fix: authentication and reads stay on the authenticated
 * client, the job_matches write goes through the service-role client only,
 * user_id always comes from the verified session, and the returned count
 * reflects writes that actually landed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/utils/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { triggerProfileMatching, triggerJobMatch } from '@/app/actions/match-actions';
import { DeterministicMatcher, CandidateState } from '@/lib/matching/matching-engine';
import { JobWithLocationsAndSkills } from '@/lib/types/jobs';

const SESSION_USER_ID = 'session-user-0001';
/** Never valid as a write target: proves user_id is not taken from the data. */
const FOREIGN_USER_ID = 'attacker-user-9999';

/**
 * Minimal PostgREST-shaped stub. Chain methods return `this`; the object is
 * awaitable so `await client.from(t).select().eq(...)` resolves, and .single()
 * / .maybeSingle() resolve to the same payload.
 */
function tableStub(result: any) {
    const chain: any = {};
    const passthrough = () => chain;
    chain.select = passthrough;
    chain.eq = passthrough;
    chain.in = passthrough;
    chain.order = passthrough;
    chain.limit = passthrough;
    chain.single = () => Promise.resolve(result);
    chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
    return chain;
}

function activeJob(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        title: 'Salesforce Developer',
        company_name: 'Qualityze',
        description: 'Salesforce developer working with Apex and JavaScript on CRM integrations.',
        status: 'active',
        job_locations: [],
        job_skills: [],
        ...overrides
    };
}

/** The authenticated request client: auth + all user-scoped reads. */
function makeAuthClient(jobs: any[], singleJob?: any) {
    const from = jest.fn((table: string) => {
        switch (table) {
            case 'profiles':
                return tableStub({ data: { user_id: SESSION_USER_ID, headline: 'Salesforce Developer' }, error: null });
            case 'candidate_skills':
                return tableStub({ data: [{ skill_name: 'Apex' }, { skill_name: 'JavaScript' }], error: null });
            case 'candidate_experience':
                return tableStub({ data: [{ title: 'Salesforce Developer' }], error: null });
            case 'candidate_preferences':
                return tableStub({ data: null, error: null });
            case 'jobs':
                return singleJob
                    ? tableStub({ data: singleJob, error: null })
                    : tableStub({ data: jobs, error: null });
            default:
                return tableStub({ data: null, error: null });
        }
    });

    return {
        auth: {
            getUser: jest.fn().mockResolvedValue({ data: { user: { id: SESSION_USER_ID } }, error: null })
        },
        from
    };
}

/** The service-role client: job_matches writes only. */
function makeAdminClient(upsertResult: any) {
    const upsert = jest.fn(() => {
        const chain: any = {
            select: () => chain,
            single: () => Promise.resolve(upsertResult),
            then: (resolve: any, reject: any) => Promise.resolve(upsertResult).then(resolve, reject)
        };
        return chain;
    });
    const from = jest.fn(() => ({ upsert }));
    return { client: { from }, from, upsert };
}

describe('M6 match persistence', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    describe('1. job_matches is written with the admin client only', () => {
        it('authenticates and reads on the authenticated client, writes on the admin client', async () => {
            const auth = makeAuthClient([activeJob('job-1')]);
            const admin = makeAdminClient({ data: null, error: null });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            await triggerProfileMatching();

            // Session comes from the authenticated client.
            expect(auth.auth.getUser).toHaveBeenCalledTimes(1);

            // User-scoped reads stay on the authenticated client.
            const readTables = auth.from.mock.calls.map(c => c[0]);
            expect(readTables).toEqual(expect.arrayContaining([
                'profiles', 'candidate_skills', 'candidate_experience', 'candidate_preferences', 'jobs'
            ]));

            // The write goes to the admin client...
            expect(admin.from).toHaveBeenCalledWith('job_matches');
            expect(admin.upsert).toHaveBeenCalledTimes(1);

            // ...and NEVER to the authenticated client, which RLS would reject.
            expect(readTables).not.toContain('job_matches');
        });

        it('triggerJobMatch also writes job_matches through the admin client', async () => {
            const job = activeJob('job-single');
            const auth = makeAuthClient([], job);
            const admin = makeAdminClient({ data: { id: 'match-1' }, error: null });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            const res = await triggerJobMatch('job-single');

            expect(res.success).toBe(true);
            expect(res.persisted).toBe(1);
            expect(admin.from).toHaveBeenCalledWith('job_matches');
            expect(auth.from.mock.calls.map(c => c[0])).not.toContain('job_matches');
        });
    });

    describe('2. user_id security boundary', () => {
        it('writes the session user id, not any id present on the job data', async () => {
            const auth = makeAuthClient([
                activeJob('job-1', { user_id: FOREIGN_USER_ID }),
                activeJob('job-2', { user_id: FOREIGN_USER_ID })
            ]);
            const admin = makeAdminClient({ data: null, error: null });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            await triggerProfileMatching();

            expect(admin.upsert).toHaveBeenCalledTimes(2);
            for (const call of admin.upsert.mock.calls) {
                const payload = (call as any[])[0];
                expect(payload.user_id).toBe(SESSION_USER_ID);
                expect(payload.user_id).not.toBe(FOREIGN_USER_ID);
            }
        });

        it('triggerJobMatch cannot be steered to another user by its argument', async () => {
            const job = activeJob('job-single', { user_id: FOREIGN_USER_ID });
            const auth = makeAuthClient([], job);
            const admin = makeAdminClient({ data: { id: 'match-1' }, error: null });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            await triggerJobMatch('job-single');

            const payload = (admin.upsert.mock.calls[0] as any[])[0];
            expect(payload.user_id).toBe(SESSION_USER_ID);
            expect(payload.job_id).toBe('job-single');
        });

        it('returns Unauthorized without writing when there is no session', async () => {
            const auth = makeAuthClient([activeJob('job-1')]);
            auth.auth.getUser = jest.fn().mockResolvedValue({ data: { user: null }, error: null });
            const admin = makeAdminClient({ data: null, error: null });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            const res = await triggerProfileMatching();

            expect(res.success).toBe(false);
            expect(res.persisted).toBe(0);
            expect(admin.upsert).not.toHaveBeenCalled();
        });
    });

    describe('3. write failure is reported, not swallowed', () => {
        it('reports persisted 0 and does not claim success when every write is rejected', async () => {
            const auth = makeAuthClient([activeJob('job-1'), activeJob('job-2')]);
            const admin = makeAdminClient({
                data: null,
                error: { message: 'new row violates row-level security policy for table "job_matches"', code: '42501' }
            });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            const res = await triggerProfileMatching();

            expect(res.persisted).toBe(0);
            expect(res.processed).toBe(0);
            expect(res.failed).toBe(2);
            expect(res.total).toBe(2);
            expect(res.success).toBe(false);
            expect(res.error).toBeDefined();
        });

        it('logs the actual database error with job context', async () => {
            const auth = makeAuthClient([activeJob('job-1')]);
            const admin = makeAdminClient({
                data: null,
                error: { message: 'new row violates row-level security policy', code: '42501' }
            });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            await triggerProfileMatching();

            const logged = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
            expect(logged).toContain('job-1');
            expect(logged).toContain('row-level security');
            expect(logged).toContain('42501');
        });

        it('a partial failure still reports only the writes that landed', async () => {
            const auth = makeAuthClient([activeJob('job-1'), activeJob('job-2'), activeJob('job-3')]);
            const admin = makeAdminClient({ data: null, error: null });
            let call = 0;
            admin.upsert.mockImplementation(() => {
                call++;
                const result = call === 2
                    ? { data: null, error: { message: 'timeout', code: '57014' } }
                    : { data: null, error: null };
                const chain: any = {
                    select: () => chain,
                    single: () => Promise.resolve(result),
                    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
                };
                return chain;
            });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            const res = await triggerProfileMatching();

            expect(res.persisted).toBe(2);
            expect(res.failed).toBe(1);
            expect(res.total).toBe(3);
        });

        it('triggerJobMatch reports failure rather than a saved match', async () => {
            const auth = makeAuthClient([], activeJob('job-single'));
            const admin = makeAdminClient({ data: null, error: { message: 'denied', code: '42501' } });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            const res = await triggerJobMatch('job-single');

            expect(res.success).toBe(false);
            expect(res.persisted).toBe(0);
            expect(res.match).toBeUndefined();
        });
    });

    describe('4. successful persistence', () => {
        it('counts exactly the rows written', async () => {
            const auth = makeAuthClient([activeJob('job-1'), activeJob('job-2'), activeJob('job-3')]);
            const admin = makeAdminClient({ data: null, error: null });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            const res = await triggerProfileMatching();

            expect(res.success).toBe(true);
            expect(res.persisted).toBe(3);
            expect(res.failed).toBe(0);
            expect(res.total).toBe(3);
            expect(admin.upsert).toHaveBeenCalledTimes(3);
        });

        it('processed stays an alias of persisted for existing callers', async () => {
            const auth = makeAuthClient([activeJob('job-1'), activeJob('job-2')]);
            const admin = makeAdminClient({ data: null, error: null });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            const res = await triggerProfileMatching();

            expect(res.processed).toBe(res.persisted);
            expect(res.processed).toBe(2);
        });

        it('upserts on the (user_id, job_id) unique constraint so re-runs update in place', async () => {
            const auth = makeAuthClient([activeJob('job-1')]);
            const admin = makeAdminClient({ data: null, error: null });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            await triggerProfileMatching();

            const options = (admin.upsert.mock.calls[0] as any[])[1];
            expect(options).toEqual({ onConflict: 'user_id,job_id' });
        });
    });

    describe('5. empty job_skills remains matchable', () => {
        const candidate: CandidateState = {
            profile: { headline: 'Salesforce Developer' } as any,
            skills: [
                { skill_name: 'Apex' } as any,
                { skill_name: 'JavaScript' } as any,
                { skill_name: 'Visualforce' } as any
            ],
            experience: [{ title: 'Salesforce Developer' } as any],
            preferences: null
        };

        function jobWithoutSkills(): JobWithLocationsAndSkills {
            return {
                id: 'job-no-skills',
                title: 'Salesforce Developer 3-8 years Exp',
                company_name: 'Qualityze',
                description:
                    'We are hiring a Salesforce Developer. Hands-on Apex and JavaScript ' +
                    'experience building Visualforce pages and CRM integrations.',
                job_locations: [],
                job_skills: []
            } as unknown as JobWithLocationsAndSkills;
        }

        it('scores a job that has no job_skills rows, from its description alone', () => {
            const result = DeterministicMatcher.match(candidate, jobWithoutSkills());

            // No explicit required skills → the required half scores its safe
            // bound, and description-derived skills contribute the rest.
            expect(result.skills_score).toBeGreaterThanOrEqual(75);
            expect(result.overall_score).toBeGreaterThan(0);
            expect(result.matching_skills.length).toBeGreaterThan(0);
            expect(result.missing_required_skills).toEqual([]);
        });

        it('produces a persistable row for a job with no job_skills', async () => {
            const auth = makeAuthClient([activeJob('job-no-skills', { job_skills: [] })]);
            const admin = makeAdminClient({ data: null, error: null });
            (createClient as jest.Mock).mockResolvedValue(auth);
            (createAdminClient as jest.Mock).mockReturnValue(admin.client);

            const res = await triggerProfileMatching();

            expect(res.persisted).toBe(1);
            const payload = (admin.upsert.mock.calls[0] as any[])[0];
            expect(payload.job_id).toBe('job-no-skills');
            expect(typeof payload.overall_score).toBe('number');
            expect(payload.recommendation).toBeDefined();
        });
    });
});
