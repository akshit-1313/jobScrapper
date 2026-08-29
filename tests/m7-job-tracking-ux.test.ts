/**
 * @jest-environment node
 *
 * Job tracking UX: bookmark toggle + list-level saved/applied/new state.
 *
 * saved_jobs, its RLS policies and createOrUpdateSavedJob already existed and
 * are unchanged here. What is new is unsaving (the table has no 'none' status,
 * so removal deletes the row) and the pure helpers the list pages use to render
 * saved / applied / new state without inferring anything.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('@/utils/supabase/server', () => ({ createClient: jest.fn() }));

import { createClient } from '@/utils/supabase/server';
import { createOrUpdateSavedJob, removeSavedJob } from '@/app/actions/saved-jobs-actions';
import {
    buildSavedStatusMap,
    buildAppliedSet,
    resolveJobUserState,
    isRecentlyDiscovered,
    parseJobStatusFilter,
    filterJobsByStatus,
    NEW_JOB_WINDOW_HOURS,
} from '@/lib/jobs/job-status';

const SESSION_USER_ID = '8698300f-4aef-4b0f-bfc4-5cb956aaecee';
const OTHER_USER_ID = '11111111-2222-3333-4444-555555555555';
const JOB_ID = '99bd8026-7d52-4f77-8a1f-51500744f2aa';

/** Records the eq() filters applied so ownership scoping can be asserted. */
function makeSupabase(result: any = { error: null }) {
    const eqCalls: Array<[string, unknown]> = [];
    const upsertCalls: any[] = [];
    const deleteCalls: string[] = [];

    const chain: any = {
        eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return chain; },
        then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };

    const from = jest.fn((table: string) => ({
        upsert: (payload: any, options: any) => {
            upsertCalls.push({ table, payload, options });
            return Promise.resolve(result);
        },
        delete: () => { deleteCalls.push(table); return chain; },
    }));

    const client = {
        auth: {
            getUser: jest.fn().mockResolvedValue({
                data: { user: { id: SESSION_USER_ID } }, error: null,
            }),
        },
        from,
    };

    return { client, from, eqCalls, upsertCalls, deleteCalls };
}

describe('Job tracking UX', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    });
    afterEach(() => errorSpy.mockRestore());

    describe('save', () => {
        it('upserts on (user_id, job_id) with the session user', async () => {
            const s = makeSupabase({ error: null });
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await createOrUpdateSavedJob({ jobId: JOB_ID, status: 'saved' });

            expect(res.success).toBe(true);
            expect(s.upsertCalls).toHaveLength(1);
            expect(s.upsertCalls[0].table).toBe('saved_jobs');
            expect(s.upsertCalls[0].payload.user_id).toBe(SESSION_USER_ID);
            expect(s.upsertCalls[0].payload.job_id).toBe(JOB_ID);
            expect(s.upsertCalls[0].options).toEqual({ onConflict: 'user_id,job_id' });
        });

        it('rejects an unauthenticated caller without writing', async () => {
            const s = makeSupabase({ error: null });
            s.client.auth.getUser = jest.fn().mockResolvedValue({ data: { user: null }, error: null });
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await createOrUpdateSavedJob({ jobId: JOB_ID, status: 'saved' });

            expect(res.success).toBe(false);
            expect(res.error).toBe('Unauthorized');
            expect(s.upsertCalls).toHaveLength(0);
        });

        it('rejects an invalid status without writing', async () => {
            const s = makeSupabase({ error: null });
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await createOrUpdateSavedJob({ jobId: JOB_ID, status: 'bogus' as any });

            expect(res.success).toBe(false);
            expect(s.upsertCalls).toHaveLength(0);
        });
    });

    describe('unsave', () => {
        it('deletes the row scoped to BOTH the session user and the job', async () => {
            const s = makeSupabase({ error: null });
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await removeSavedJob({ jobId: JOB_ID });

            expect(res.success).toBe(true);
            expect(s.deleteCalls).toEqual(['saved_jobs']);
            expect(s.eqCalls).toEqual([
                ['user_id', SESSION_USER_ID],
                ['job_id', JOB_ID],
            ]);
        });

        it('cannot be steered at another user by its argument', async () => {
            const s = makeSupabase({ error: null });
            (createClient as jest.Mock).mockResolvedValue(s.client);

            await removeSavedJob({ jobId: JOB_ID, user_id: OTHER_USER_ID } as any);

            const userScoping = s.eqCalls.find(([col]) => col === 'user_id');
            expect(userScoping?.[1]).toBe(SESSION_USER_ID);
            expect(s.eqCalls.some(([, val]) => val === OTHER_USER_ID)).toBe(false);
        });

        it('is idempotent — removing an already-unsaved job still succeeds', async () => {
            const s = makeSupabase({ error: null });
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const first = await removeSavedJob({ jobId: JOB_ID });
            const second = await removeSavedJob({ jobId: JOB_ID });

            expect(first.success).toBe(true);
            expect(second.success).toBe(true);
        });

        it('rejects an unauthenticated caller without deleting', async () => {
            const s = makeSupabase({ error: null });
            s.client.auth.getUser = jest.fn().mockResolvedValue({ data: { user: null }, error: null });
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await removeSavedJob({ jobId: JOB_ID });

            expect(res.success).toBe(false);
            expect(res.error).toBe('Unauthorized');
            expect(s.deleteCalls).toHaveLength(0);
        });

        it('rejects a malformed job id without deleting', async () => {
            const s = makeSupabase({ error: null });
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await removeSavedJob({ jobId: 'not-a-uuid' });

            expect(res.success).toBe(false);
            expect(s.deleteCalls).toHaveLength(0);
        });

        it('surfaces a database rejection instead of reporting success', async () => {
            const s = makeSupabase({ error: { message: 'permission denied', code: '42501' } });
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await removeSavedJob({ jobId: JOB_ID });

            expect(res.success).toBe(false);
            expect(errorSpy).toHaveBeenCalled();
        });
    });

    describe('list state helpers', () => {
        it('indexes saved rows and ignores unknown statuses', () => {
            const map = buildSavedStatusMap([
                { job_id: 'a', status: 'saved' },
                { job_id: 'b', status: 'archived' },
                { job_id: 'c', status: 'ignored' },
                { job_id: 'd', status: 'nonsense' },
                { job_id: 'e', status: null },
            ]);

            expect(map.get('a')).toBe('saved');
            expect(map.get('b')).toBe('archived');
            expect(map.get('c')).toBe('ignored');
            expect(map.has('d')).toBe(false);
            expect(map.has('e')).toBe(false);
        });

        it('treats a missing row as not saved and not applied', () => {
            const state = resolveJobUserState('unknown', buildSavedStatusMap([]), buildAppliedSet([]));
            expect(state).toEqual({ savedStatus: null, applied: false });
        });

        it('resolves applied state from the applications rows', () => {
            const state = resolveJobUserState(
                JOB_ID,
                buildSavedStatusMap([{ job_id: JOB_ID, status: 'saved' }]),
                buildAppliedSet([{ job_id: JOB_ID }])
            );
            expect(state).toEqual({ savedStatus: 'saved', applied: true });
        });

        it('handles null inputs from a failed or empty query', () => {
            expect(buildSavedStatusMap(null).size).toBe(0);
            expect(buildAppliedSet(undefined).size).toBe(0);
        });
    });

    describe('new-job indicator', () => {
        const now = new Date('2026-08-29T12:00:00Z');

        it('flags a job discovered inside the window', () => {
            expect(isRecentlyDiscovered('2026-08-29T02:00:00Z', now)).toBe(true);
        });

        it('does not flag a job older than the window', () => {
            expect(isRecentlyDiscovered('2026-08-27T12:00:00Z', now)).toBe(false);
        });

        it('treats the window boundary as still new', () => {
            const boundary = new Date(now.getTime() - NEW_JOB_WINDOW_HOURS * 3600 * 1000).toISOString();
            expect(isRecentlyDiscovered(boundary, now)).toBe(true);
        });

        it('never flags missing, malformed or future timestamps', () => {
            expect(isRecentlyDiscovered(null, now)).toBe(false);
            expect(isRecentlyDiscovered(undefined, now)).toBe(false);
            expect(isRecentlyDiscovered('not a date', now)).toBe(false);
            expect(isRecentlyDiscovered('2026-09-01T00:00:00Z', now)).toBe(false);
        });
    });

    describe('status filter', () => {
        const jobs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        const saved = buildSavedStatusMap([
            { job_id: 'a', status: 'saved' },
            { job_id: 'b', status: 'archived' },
        ]);
        const applied = buildAppliedSet([{ job_id: 'b' }]);

        it('defaults unknown values to all', () => {
            expect(parseJobStatusFilter(undefined)).toBe('all');
            expect(parseJobStatusFilter('bogus')).toBe('all');
            expect(parseJobStatusFilter(['saved'])).toBe('all');
            expect(parseJobStatusFilter('saved')).toBe('saved');
        });

        it('returns every job for "all"', () => {
            expect(filterJobsByStatus(jobs, 'all', saved, applied)).toHaveLength(3);
        });

        it('"saved" excludes archived and ignored rows', () => {
            expect(filterJobsByStatus(jobs, 'saved', saved, applied).map(j => j.id)).toEqual(['a']);
        });

        it('"applied" returns only jobs with an application', () => {
            expect(filterJobsByStatus(jobs, 'applied', saved, applied).map(j => j.id)).toEqual(['b']);
        });

        it('"not_applied" is the exact complement of "applied"', () => {
            expect(filterJobsByStatus(jobs, 'not_applied', saved, applied).map(j => j.id)).toEqual(['a', 'c']);
        });
    });
});
