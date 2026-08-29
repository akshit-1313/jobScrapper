/**
 * @jest-environment node
 *
 * Search Parameters storage.
 *
 * candidate_preferences is the single source of truth for what the user wants
 * to search for, read by both the manual button and the 04:00 UTC scheduled
 * run. These tests pin the ownership boundary, the explicit empty semantics,
 * and that saving search intent cannot disturb the matching constraints edited
 * elsewhere.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/utils/supabase/server', () => ({ createClient: jest.fn() }));

import { createClient } from '@/utils/supabase/server';
import { saveSearchParameters } from '@/app/actions/search-parameters-actions';
import {
    SearchParametersSchema,
    EMPTY_SEARCH_PARAMETERS,
    toSearchParameters,
    searchParametersEqual,
    WORK_MODE_OPTIONS,
} from '@/lib/types/search-parameters';

const SESSION_USER_ID = '8698300f-4aef-4b0f-bfc4-5cb956aaecee';
const OTHER_USER_ID = '11111111-2222-3333-4444-555555555555';

function makeSupabase(result: any = { error: null }) {
    const upserts: any[] = [];
    const from = jest.fn((table: string) => ({
        upsert: (payload: any, options: any) => {
            upserts.push({ table, payload, options });
            return Promise.resolve(result);
        },
    }));
    const client = {
        auth: {
            getUser: jest.fn().mockResolvedValue({ data: { user: { id: SESSION_USER_ID } }, error: null }),
        },
        from,
    };
    return { client, from, upserts };
}

const INTENDED = {
    desired_roles: ['Salesforce Developer', 'Salesforce Engineer', 'Salesforce Programmer'],
    work_modes: ['remote'],
    geographic_preferences: ['worldwide'],
    remote_search_terms: ['remote', 'work from anywhere', 'remote-first'],
    desired_skills: ['Apex', 'LWC', 'SOQL'],
    excluded_skills: [],
    excluded_roles: [],
    // Empty = all globally active sources, the default for every user.
    selected_source_ids: [],
};

describe('Search Parameters', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    });
    afterEach(() => errorSpy.mockRestore());

    describe('loading stored values', () => {
        it('returns all-empty defaults when no row exists', () => {
            expect(toSearchParameters(null)).toEqual(EMPTY_SEARCH_PARAMETERS);
            expect(toSearchParameters(undefined)).toEqual(EMPTY_SEARCH_PARAMETERS);
        });

        it('loads the seven fields including remote_search_terms', () => {
            expect(toSearchParameters(INTENDED)).toEqual(INTENDED);
        });

        it('tolerates nulls and non-string entries from the database', () => {
            const loaded = toSearchParameters({
                desired_roles: null,
                work_modes: ['remote', 42, ''],
                geographic_preferences: 'not-an-array',
                remote_search_terms: ['  ', 'remote'],
            } as any);

            expect(loaded.desired_roles).toEqual([]);
            expect(loaded.work_modes).toEqual(['remote']);
            expect(loaded.geographic_preferences).toEqual([]);
            expect(loaded.remote_search_terms).toEqual(['remote']);
        });

        it('reads a legacy in_office selection back as office', () => {
            expect(toSearchParameters({ work_modes: ['in_office'] } as any).work_modes).toEqual(['office']);
        });

        it('offers exactly the jobs.work_mode domain (no in_office)', () => {
            expect([...WORK_MODE_OPTIONS]).toEqual(['remote', 'hybrid', 'office']);
            expect(WORK_MODE_OPTIONS as readonly string[]).not.toContain('in_office');
        });
    });

    describe('saved / unsaved indicator', () => {
        it('reports equal for identical values', () => {
            expect(searchParametersEqual(toSearchParameters(INTENDED), toSearchParameters(INTENDED))).toBe(true);
        });

        it('detects any field changing', () => {
            const a = toSearchParameters(INTENDED);
            expect(searchParametersEqual(a, { ...a, work_modes: [] })).toBe(false);
            expect(searchParametersEqual(a, { ...a, remote_search_terms: ['remote'] })).toBe(false);
        });
    });

    describe('validation', () => {
        it('accepts the intended configuration', () => {
            expect(SearchParametersSchema.safeParse(INTENDED).success).toBe(true);
        });

        it('defaults every omitted field to empty', () => {
            const parsed = SearchParametersSchema.parse({});
            expect(parsed).toEqual(EMPTY_SEARCH_PARAMETERS);
        });

        it('rejects a work mode outside the jobs domain', () => {
            expect(SearchParametersSchema.safeParse({ work_modes: ['in_office'] }).success).toBe(false);
            expect(SearchParametersSchema.safeParse({ work_modes: ['anywhere'] }).success).toBe(false);
        });
    });

    describe('saving', () => {
        it('writes the seven fields for the session user', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await saveSearchParameters(INTENDED);

            expect(res.success).toBe(true);
            expect(s.upserts).toHaveLength(1);
            expect(s.upserts[0].table).toBe('candidate_preferences');
            expect(s.upserts[0].options).toEqual({ onConflict: 'user_id' });
            expect(s.upserts[0].payload.user_id).toBe(SESSION_USER_ID);
            expect(s.upserts[0].payload.remote_search_terms).toEqual(INTENDED.remote_search_terms);
        });

        it('never writes a user id supplied by the caller', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            await saveSearchParameters({ ...INTENDED, user_id: OTHER_USER_ID } as any);

            expect(s.upserts[0].payload.user_id).toBe(SESSION_USER_ID);
            expect(s.upserts[0].payload.user_id).not.toBe(OTHER_USER_ID);
        });

        it('does not touch the matching constraints owned by /preferences', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            await saveSearchParameters({ ...INTENDED, salary_min: 1, visa_sponsorship_pref: 'required' } as any);

            const payload = s.upserts[0].payload;
            expect(payload.salary_min).toBeUndefined();
            expect(payload.visa_sponsorship_pref).toBeUndefined();
            expect(payload.relocation_pref).toBeUndefined();
            expect(payload.experience_min).toBeUndefined();
        });

        it('persists empty arrays rather than inventing defaults', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            await saveSearchParameters({});

            const payload = s.upserts[0].payload;
            expect(payload.work_modes).toEqual([]);
            expect(payload.geographic_preferences).toEqual([]);
            expect(payload.remote_search_terms).toEqual([]);
        });

        it('rejects an unauthenticated caller without writing', async () => {
            const s = makeSupabase();
            s.client.auth.getUser = jest.fn().mockResolvedValue({ data: { user: null }, error: null });
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await saveSearchParameters(INTENDED);

            expect(res.success).toBe(false);
            expect(res.error).toBe('Unauthorized');
            expect(s.upserts).toHaveLength(0);
        });

        it('rejects invalid input without writing', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await saveSearchParameters({ work_modes: ['in_office'] });

            expect(res.success).toBe(false);
            expect(s.upserts).toHaveLength(0);
        });

        it('reports a database failure instead of claiming success', async () => {
            const s = makeSupabase({ error: { message: 'permission denied', code: '42501' } });
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await saveSearchParameters(INTENDED);

            expect(res.success).toBe(false);
            expect(errorSpy).toHaveBeenCalled();
        });
    });
});
