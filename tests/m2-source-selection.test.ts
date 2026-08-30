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

import { z } from 'zod';
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

/**
 * The REAL ids production uses, seeded by migration 008.
 *
 * These are the regression fixture. Every id above is RFC-4122 shaped
 * (`-4xxx-8xxx-`), which is precisely why the save bug went unnoticed: the
 * suite validated the code against data production does not have. These carry
 * version and variant nibbles of 0, so `z.string().uuid()` rejected them and
 * no "Choose sources" save ever reached the database.
 */
const SEEDED_SOURCE_IDS = {
    lever: 'a0000000-0000-0000-0000-000000000005',
    remoteok: 'a0000000-0000-0000-0000-000000000010',
    greenhouse: 'a0000000-0000-0000-0000-000000000004',
    linkedin: 'a0000000-0000-0000-0000-000000000001',
} as const;

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

    /**
     * Regression: the ids production actually has must validate.
     *
     * `z.string().uuid()` enforces the RFC 4122 version/variant nibbles, which
     * the seeded ids do not carry, so every "Choose sources" save failed before
     * the database was touched while "All sources" ([]) always passed.
     */
    describe('the seeded production source ids are accepted', () => {
        const seeded = Object.values(SEEDED_SOURCE_IDS);

        it.each(seeded)('%s passes schema validation', (id) => {
            const parsed = SearchParametersSchema.safeParse({ selected_source_ids: [id] });
            expect(parsed.success).toBe(true);
        });

        it('rejects them under the old RFC-4122 rule — proving the fixture is the real case', () => {
            // Guards against a well-meaning revert to z.string().uuid().
            for (const id of seeded) {
                expect(z.string().uuid().safeParse(id).success).toBe(false);
            }
        });

        it('a Choose-sources save of real ids reaches the database', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const chosen = [SEEDED_SOURCE_IDS.lever, SEEDED_SOURCE_IDS.remoteok, SEEDED_SOURCE_IDS.greenhouse];
            const res = await saveSearchParameters({ selected_source_ids: chosen });

            expect(res.success).toBe(true);
            expect(s.upserts).toHaveLength(1);
            expect(s.upserts[0].payload.selected_source_ids).toEqual(chosen);
        });

        it('still refuses ids that are not UUID-shaped at all', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            for (const bad of ['not-a-uuid', '', 'a0000000-0000-0000-0000', `${SEEDED_SOURCE_IDS.lever}x`]) {
                const res = await saveSearchParameters({ selected_source_ids: [bad] });
                expect(res.success).toBe(false);
            }
            expect(s.upserts).toHaveLength(0);
        });

        it('every id seeded by migration 008 satisfies the schema', () => {
            // Drift guard: a future seeded source cannot silently reintroduce this.
            const sql = require('fs').readFileSync(
                require('path').join(__dirname, '..', 'supabase', 'migrations', '008_seed_shared_data.sql'),
                'utf8'
            );
            const sourceBlock = sql.slice(
                sql.indexOf('INSERT INTO public.job_sources'),
                sql.indexOf('INSERT INTO public.jobs')
            );
            const ids: string[] = sourceBlock.match(/'a0000000-[0-9a-f-]+'/g)?.map((m: string) => m.slice(1, -1)) ?? [];

            expect(ids.length).toBe(10);
            const parsed = SearchParametersSchema.safeParse({ selected_source_ids: ids });
            expect(parsed.success).toBe(true);
        });
    });

    /**
     * Both UI cards share one candidate_preferences row, so a save from either
     * must carry the whole record rather than patching one column.
     */
    describe('the shared candidate_preferences row is never partially overwritten', () => {
        const FULL = {
            desired_roles: ['Salesforce Developer', 'Salesforce Engineer', 'Salesforce Programmer'],
            work_modes: ['remote'] as const,
            geographic_preferences: ['Worldwide'],
            remote_search_terms: ['remote', 'work from anywhere', 'remote-first'],
            desired_skills: ['Apex', 'LWC', 'SOQL'],
            excluded_skills: [],
            excluded_roles: [],
        };

        it('saving sources preserves every search-parameter field', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            await saveSearchParameters({ ...FULL, selected_source_ids: [SEEDED_SOURCE_IDS.lever] });

            const written = s.upserts[0].payload;
            expect(written.desired_roles).toEqual(FULL.desired_roles);
            expect(written.work_modes).toEqual(['remote']);
            expect(written.geographic_preferences).toEqual(['Worldwide']);
            expect(written.remote_search_terms).toEqual(FULL.remote_search_terms);
            expect(written.desired_skills).toEqual(FULL.desired_skills);
            expect(written.selected_source_ids).toEqual([SEEDED_SOURCE_IDS.lever]);
        });

        it('saving search parameters preserves the source selection', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            const chosen = [SEEDED_SOURCE_IDS.lever, SEEDED_SOURCE_IDS.remoteok];
            await saveSearchParameters({ ...FULL, desired_skills: ['Apex'], selected_source_ids: chosen });

            expect(s.upserts[0].payload.selected_source_ids).toEqual(chosen);
            expect(s.upserts[0].payload.desired_skills).toEqual(['Apex']);
        });

        it('switching back to All sources stores an empty array, not a removal', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            await saveSearchParameters({ ...FULL, selected_source_ids: [] });

            expect(s.upserts[0].payload.selected_source_ids).toEqual([]);
            expect(s.upserts[0].payload.desired_roles).toEqual(FULL.desired_roles);
        });

        it('the user_id written is the session id, never a caller argument', async () => {
            const s = makeSupabase();
            (createClient as jest.Mock).mockResolvedValue(s.client);

            await saveSearchParameters({
                ...FULL,
                user_id: '00000000-0000-0000-0000-0000000000ff',
                selected_source_ids: [SEEDED_SOURCE_IDS.lever],
            } as any);

            expect(s.upserts[0].payload.user_id).toBe(SESSION_USER_ID);
            expect(s.upserts[0].options).toEqual({ onConflict: 'user_id' });
        });
    });

    /**
     * The zero-selection guard is a UI concern: the schema accepts [] because
     * that is the legitimate "All sources" value, so the panel must be the thing
     * that refuses to save an empty Choose-sources selection.
     */
    describe('zero-selection is blocked in the panel, not the schema', () => {
        const panel = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'src', 'components', 'discovery', 'search-parameters-panel.tsx'),
            'utf8'
        );

        it('computes a no-source-chosen state from Choose mode plus an empty list', () => {
            expect(panel).toContain('const noSourceChosen = chooseSources && values.selected_source_ids.length === 0');
        });

        it('disables Save while nothing is ticked', () => {
            expect(panel).toMatch(/disabled=\{[^}]*noSourceChosen[^}]*\}/);
        });

        it('only marks the form saved after the action reports success', () => {
            // The Unsaved-changes badge stuck precisely because a failed save
            // must not call setSaved.
            expect(panel).toMatch(/if \(!result\.success\)[\s\S]{0,200}return/);
            expect(panel).toContain('setSaved(values)');
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
