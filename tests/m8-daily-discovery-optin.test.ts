/**
 * @jest-environment node
 *
 * Daily discovery opt-in.
 *
 * The scheduled run spends Firecrawl credits while the user is not present, so
 * eligibility must be explicit, per-user and default-off. These tests pin that
 * the flag can only ever be set for the verified session user.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/utils/supabase/server', () => ({ createClient: jest.fn() }));

import { createClient } from '@/utils/supabase/server';
import { setDailyDiscoveryEnabled } from '@/app/actions/daily-discovery-actions';

const SESSION_USER_ID = '8698300f-4aef-4b0f-bfc4-5cb956aaecee';
const OTHER_USER_ID = '11111111-2222-3333-4444-555555555555';

function makeSupabase(result: any = { error: null }) {
    const eqCalls: Array<[string, unknown]> = [];
    const updateCalls: any[] = [];

    const chain: any = {
        eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return chain; },
        then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };

    const from = jest.fn((table: string) => ({
        update: (payload: any) => { updateCalls.push({ table, payload }); return chain; },
    }));

    const client = {
        auth: {
            getUser: jest.fn().mockResolvedValue({
                data: { user: { id: SESSION_USER_ID } }, error: null,
            }),
        },
        from,
    };

    return { client, from, eqCalls, updateCalls };
}

describe('Daily discovery opt-in', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    });
    afterEach(() => errorSpy.mockRestore());

    it('enables the flag for the session user only', async () => {
        const s = makeSupabase();
        (createClient as jest.Mock).mockResolvedValue(s.client);

        const res = await setDailyDiscoveryEnabled(true);

        expect(res.success).toBe(true);
        expect(s.updateCalls).toEqual([
            { table: 'profiles', payload: { daily_discovery_enabled: true } },
        ]);
        expect(s.eqCalls).toEqual([['user_id', SESSION_USER_ID]]);
    });

    it('disables the flag', async () => {
        const s = makeSupabase();
        (createClient as jest.Mock).mockResolvedValue(s.client);

        const res = await setDailyDiscoveryEnabled(false);

        expect(res.success).toBe(true);
        expect(s.updateCalls[0].payload).toEqual({ daily_discovery_enabled: false });
    });

    it('never writes a user id supplied by the caller', async () => {
        const s = makeSupabase();
        (createClient as jest.Mock).mockResolvedValue(s.client);

        await setDailyDiscoveryEnabled({ enabled: true, user_id: OTHER_USER_ID } as any);

        // A non-boolean argument is rejected outright, so nothing is written.
        expect(s.updateCalls).toHaveLength(0);
        expect(s.eqCalls.some(([, v]) => v === OTHER_USER_ID)).toBe(false);
    });

    it('scopes the update to the session user, never to another id', async () => {
        const s = makeSupabase();
        (createClient as jest.Mock).mockResolvedValue(s.client);

        await setDailyDiscoveryEnabled(true);

        const userScoping = s.eqCalls.find(([col]) => col === 'user_id');
        expect(userScoping?.[1]).toBe(SESSION_USER_ID);
        expect(userScoping?.[1]).not.toBe(OTHER_USER_ID);
    });

    it('rejects an unauthenticated caller without writing', async () => {
        const s = makeSupabase();
        s.client.auth.getUser = jest.fn().mockResolvedValue({ data: { user: null }, error: null });
        (createClient as jest.Mock).mockResolvedValue(s.client);

        const res = await setDailyDiscoveryEnabled(true);

        expect(res.success).toBe(false);
        expect(res.error).toBe('Unauthorized');
        expect(s.updateCalls).toHaveLength(0);
    });

    it('rejects a non-boolean value without writing', async () => {
        const s = makeSupabase();
        (createClient as jest.Mock).mockResolvedValue(s.client);

        const res = await setDailyDiscoveryEnabled('yes' as any);

        expect(res.success).toBe(false);
        expect(s.updateCalls).toHaveLength(0);
    });

    it('reports a database failure instead of claiming success', async () => {
        const s = makeSupabase({ error: { message: 'permission denied', code: '42501' } });
        (createClient as jest.Mock).mockResolvedValue(s.client);

        const res = await setDailyDiscoveryEnabled(true);

        expect(res.success).toBe(false);
        expect(errorSpy).toHaveBeenCalled();
    });
});
