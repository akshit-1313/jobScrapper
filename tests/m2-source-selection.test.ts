/**
 * User job-source selection.
 *
 * Two different things, deliberately kept apart:
 *   job_sources.active = true  → SECURITY BOUNDARY, global, admin-controlled
 *   selected_source_ids        → PREFERENCE, per user, may only narrow
 *
 * The eligible pool is the intersection, and the allow-list is applied last, so
 * a stale, deactivated or fabricated id can never reach a source the admin has
 * not enabled.
 *
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/utils/supabase/server', () => ({ createClient: jest.fn() }));

import { createClient } from '@/utils/supabase/server';
import { saveSearchParameters } from '@/app/actions/search-parameters-actions';
import {
    resolveEligibleSources,
    toSearchParameters,
    SearchParametersSchema,
    EMPTY_SEARCH_PARAMETERS,
} from '@/lib/types/search-parameters';

const SESSION_USER_ID = '8698300f-4aef-4b0f-bfc4-5cb956aaecee';

const LEVER = { id: '11111111-1111-4111-8111-111111111111', name: 'Lever' };
const INDEED = { id: '22222222-2222-4222-8222-222222222222', name: 'Indeed' };
const REMOTEOK = { id: '33333333-3333-4333-8333-333333333333', name: 'RemoteOK' };
const GREENHOUSE = { id: '44444444-4444-4444-8444-444444444444', name: 'Greenhouse' };
const NAUKRI = { id: '55555555-5555-4555-8555-555555555555', name: 'Naukri' };

/** Already ordered by the caller's deterministic rotation. */
const ACTIVE = [LEVER, INDEED, REMOTEOK, GREENHOUSE, NAUKRI];

/** A source the admin deactivated — never present in the active list. */
const DEACTIVATED_ID = '99999999-9999-4999-8999-999999999999';
const FABRICATED_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const MAX_SOURCES_PER_RUN = 3;

function makeSupabase(result: any = { error: null }) {
    const upserts: any[] = [];
    const from = jest.fn((table: string) => ({
        upsert: (payload: any, options: any) => {
            upserts.push({ table, payload, options });
            return Promise.resolve(result);
        },
    }));
    return {
        client: {
            auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: SESSION_USER_ID } }, error: null }) },
            from,
        },
        upserts,
    };
}

describe('Job source selection', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('default: no selection means all sources', () => {
        it('empty array returns every active source', () => {
            expect(resolveEligibleSources(ACTIVE, [])).toEqual(ACTIVE);
        });

        it('null and undefined behave the same as empty', () => {
            expect(resolveEligibleSources(ACTIVE, null)).toEqual(ACTIVE);
            expect(resolveEligibleSources(ACTIVE, undefined)).toEqual(ACTIVE);
        });

        it('existing users default to empty, so coverage is unchanged', () => {
            expect(toSearchParameters(null).selected_source_ids).toEqual([]);
            expect(SearchParametersSchema.parse({}).selected_source_ids).toEqual([]);
            expect(EMPTY_SEARCH_PARAMETERS.selected_source_ids).toEqual([]);
        });
    });

    describe('explicit selection narrows the pool', () => {
        it('returns only the chosen sources', () => {
            const pool = resolveEligibleSources(ACTIVE, [REMOTEOK.id, LEVER.id, GREENHOUSE.id]);
            expect(pool.map(s => s.name)).toEqual(['Lever', 'RemoteOK', 'Greenhouse']);
        });

        it('never auto-adds an unselected source', () => {
            const pool = resolveEligibleSources(ACTIVE, [REMOTEOK.id, LEVER.id]);
            expect(pool).toHaveLength(2);
            expect(pool.map(s => s.name)).not.toContain('Indeed');
            expect(pool.map(s => s.name)).not.toContain('Naukri');
        });

        it('a single selected source yields a pool of one', () => {
            expect(resolveEligibleSources(ACTIVE, [REMOTEOK.id])).toEqual([REMOTEOK]);
        });
    });

    describe('the global allow-list is applied last', () => {
        it('ignores an id for a source that is no longer active', () => {
            const pool = resolveEligibleSources(ACTIVE, [LEVER.id, DEACTIVATED_ID]);
            expect(pool).toEqual([LEVER]);
        });

        it('ignores a fabricated id entirely', () => {
            const pool = resolveEligibleSources(ACTIVE, [FABRICATED_ID, INDEED.id]);
            expect(pool).toEqual([INDEED]);
        });

        it('cannot introduce a source outside the active list', () => {
            const pool = resolveEligibleSources(ACTIVE, [FABRICATED_ID, DEACTIVATED_ID]);
            for (const s of pool) expect(ACTIVE).toContainEqual(s);
        });

        it('falls back to all active sources when every selected id is stale', () => {
            // Better than silently disabling discovery for the user.
            expect(resolveEligibleSources(ACTIVE, [FABRICATED_ID, DEACTIVATED_ID])).toEqual(ACTIVE);
        });

        it('an empty active list stays empty regardless of selection', () => {
            expect(resolveEligibleSources([], [LEVER.id])).toEqual([]);
        });
    });

    describe('rotation and caps are unchanged', () => {
        it('preserves the caller rotation order', () => {
            const pool = resolveEligibleSources(ACTIVE, [NAUKRI.id, LEVER.id, REMOTEOK.id]);
            expect(pool.map(s => s.name)).toEqual(['Lever', 'RemoteOK', 'Naukri']);
        });

        it('the 3-source cap still applies after narrowing', () => {
            const pool = resolveEligibleSources(ACTIVE, ACTIVE.map(s => s.id));
            expect(pool).toHaveLength(5);
            expect(pool.slice(0, MAX_SOURCES_PER_RUN)).toHaveLength(3);
        });

        it('selecting more sources cannot raise the per-run cap', () => {
            const pool = resolveEligibleSources(ACTIVE, ACTIVE.map(s => s.id));
            expect(pool.slice(0, MAX_SOURCES_PER_RUN).map(s => s.name))
                .toEqual(['Lever', 'Indeed', 'RemoteOK']);
        });

        it('a selection smaller than the cap is not padded out', () => {
            const pool = resolveEligibleSources(ACTIVE, [REMOTEOK.id, LEVER.id]);
            expect(pool.slice(0, MAX_SOURCES_PER_RUN)).toHaveLength(2);
        });

        it('is deterministic across repeated calls', () => {
            const ids = [GREENHOUSE.id, LEVER.id];
            expect(resolveEligibleSources(ACTIVE, ids)).toEqual(resolveEligibleSources(ACTIVE, ids));
        });
    });

    describe('persistence', () => {
        it('saves the selected ids for the session user', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await saveSearchParameters({ selected_source_ids: [LEVER.id, REMOTEOK.id] });

            expect(res.success).toBe(true);
            expect(s.upserts[0].payload.selected_source_ids).toEqual([LEVER.id, REMOTEOK.id]);
            expect(s.upserts[0].payload.user_id).toBe(SESSION_USER_ID);
        });

        it('rejects a non-uuid source id without writing', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const res = await saveSearchParameters({ selected_source_ids: ['not-a-uuid'] });

            expect(res.success).toBe(false);
            expect(s.upserts).toHaveLength(0);
        });

        it('round-trips stored ids and ignores malformed entries', () => {
            const loaded = toSearchParameters({ selected_source_ids: [LEVER.id, '', 42] } as any);
            expect(loaded.selected_source_ids).toEqual([LEVER.id]);
        });
    });

    describe('manual and scheduled discovery share one selection', () => {
        it('both read the same candidate_preferences column', () => {
            // runProfileTargetedDiscovery performs the lookup, and it is the
            // single entry point for the manual button and the 04:00 UTC cron.
            const code = require('fs').readFileSync(
                require('path').join(__dirname, '..', 'src', 'lib', 'jobs', 'discovery-service.ts'), 'utf8'
            );
            expect(code).toContain('selected_source_ids');
            expect(code).toContain('resolveEligibleSources');

            const scheduled = require('fs').readFileSync(
                require('path').join(__dirname, '..', 'src', 'lib', 'jobs', 'scheduled-discovery.ts'), 'utf8'
            );
            // The cron delegates rather than reimplementing source selection.
            expect(scheduled).toContain('runProfileTargetedDiscovery');
            expect(scheduled).not.toContain('selected_source_ids');
        });
    });
});
