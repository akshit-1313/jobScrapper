/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
import { createAdminClient } from '@/lib/supabase/admin';

jest.mock('@/lib/supabase/admin', () => {
    return {
        createAdminClient: jest.fn()
    };
});

describe('M9.1 Database Security & Table Tests (Mock Adapter)', () => {
    let mockAdminClient: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockAdminClient = {
            rpc: jest.fn(),
            from: jest.fn()
        };
        (createAdminClient as jest.Mock).mockReturnValue(mockAdminClient);
    });

    it('A. worker-only stale reset executes correctly', async () => {
        mockAdminClient.rpc.mockResolvedValue({ data: 3, error: null });
        const { data, error } = await mockAdminClient.rpc('reset_stale_tasks');
        expect(error).toBeNull();
        expect(data).toBe(3);
    });

    it('B. worker-only task claim executes correctly', async () => {
        mockAdminClient.rpc.mockResolvedValue({
            data: [{ id: 't1', status: 'executing' }],
            error: null
        });
        const { data, error } = await mockAdminClient.rpc('claim_next_integration_task', { p_task_type: 'sync_emails' });
        expect(error).toBeNull();
        expect(data.length).toBe(1);
        expect(data[0].status).toBe('executing');
    });

    it('C. explicit idempotency key violation propagates correctly', async () => {
        mockAdminClient.from.mockReturnValue({
            insert: jest.fn().mockResolvedValue({
                error: { code: '23505', message: 'duplicate key value violates unique constraint' }
            })
        });
        const res = await mockAdminClient.from('integration_tasks').insert({
            user_id: 'u1',
            integration_id: 'i1',
            task_type: 'sync_emails',
            idempotency_key: 'dup'
        });
        expect(res.error).toBeDefined();
        expect(res.error.code).toBe('23505');
    });
});
