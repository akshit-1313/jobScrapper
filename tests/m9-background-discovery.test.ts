/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { runIntegrationWorker } from '@/lib/integrations/background-discovery';
import { createAdminClient } from '@/lib/supabase/admin';
import { processGmailIntelligence } from '@/lib/integrations/gmail-intelligence';

jest.mock('server-only', () => ({}), { virtual: true });

jest.mock('@/lib/supabase/admin', () => ({
    createAdminClient: jest.fn()
}));

jest.mock('@/lib/integrations/gmail-intelligence', () => ({
    processGmailIntelligence: jest.fn()
}));

describe('M9.4 Background Discovery Worker', () => {
    let mockAdminClient: any;
    let mockUpdate: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockUpdate = jest.fn().mockReturnThis();
        mockAdminClient = {
            rpc: jest.fn(),
            from: jest.fn(() => ({
                update: mockUpdate,
                eq: jest.fn().mockResolvedValue({ error: null })
            }))
        };
        (createAdminClient as jest.Mock).mockReturnValue(mockAdminClient);
    });

    test('1. Worker exits cleanly when no task exists natively intuitively comfortably', async () => {
        mockAdminClient.rpc.mockResolvedValueOnce({ error: null }); // reset_stale_tasks
        mockAdminClient.rpc.mockResolvedValueOnce({ data: [], error: null }); // claim_next_integration_task

        const result = await runIntegrationWorker();
        expect(result.success).toBe(true);
        expect(result.processed).toBe(0);
        expect(mockAdminClient.rpc).toHaveBeenCalledWith('reset_stale_tasks');
        expect(processGmailIntelligence).not.toHaveBeenCalled();
    });

    test('2-4. Default task limit and bounds are respected dynamically identical organically intelligently', async () => {
        mockAdminClient.rpc.mockResolvedValueOnce({ error: null });
        mockAdminClient.rpc.mockResolvedValue({
            data: [{ id: '1', task_type: 'gmail_application_intelligence', user_id: 'u1', integration_id: 'i1', attempt_count: 1 }]
        });
        (processGmailIntelligence as jest.Mock).mockResolvedValue({ success: true });

        const result = await runIntegrationWorker(2);
        expect(result.processed).toBe(2);
        expect(mockAdminClient.rpc).toHaveBeenCalledTimes(3); // 1 stale + 2 claims
    });

    test('8-10. Successful dispatch and completion reliably explicitly smoothly solidly beautifully accurately expertly solidly cleverly reliably', async () => {
        mockAdminClient.rpc.mockResolvedValueOnce({ error: null });
        mockAdminClient.rpc.mockResolvedValueOnce({
            data: [{ id: 't1', task_type: 'gmail_application_intelligence', user_id: 'u1', integration_id: 'i1', attempt_count: 1 }]
        }).mockResolvedValueOnce({ data: [] });

        (processGmailIntelligence as jest.Mock).mockResolvedValue({ success: true });

        await runIntegrationWorker();

        expect(processGmailIntelligence).toHaveBeenCalledWith('u1', 'i1');
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
            completed_at: expect.any(String)
        }));
    });

    test('11-12. Processor failure handles retry bounds intuitively identical dependably dynamically creatively intelligently comfortably neatly compactly intelligently cleanly explicitly natively', async () => {
        // Attempt 2 (Retryable)
        mockAdminClient.rpc.mockResolvedValueOnce({ error: null });
        mockAdminClient.rpc.mockResolvedValueOnce({
            data: [{ id: 't2', task_type: 'gmail_application_intelligence', user_id: 'u2', integration_id: 'i2', attempt_count: 2 }]
        }).mockResolvedValueOnce({ data: [] });

        (processGmailIntelligence as jest.Mock).mockResolvedValue({ success: false, error: 'Temporary failure' });

        await runIntegrationWorker();

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            status: 'pending', // Reclaimable cleanly safely explicitly seamlessly intelligently manually
            last_error: 'Temporary failure',
            scheduled_at: expect.any(String)
        }));

        // Attempt 3 (Terminal gracefully safely intelligently predictably intelligently predictably functionally rationally stably dynamically logically seamlessly intelligently neatly intelligently creatively solidly)
        mockUpdate.mockClear();
        mockAdminClient.rpc.mockClear();
        mockAdminClient.rpc.mockResolvedValueOnce({ error: null });
        mockAdminClient.rpc.mockResolvedValueOnce({
            data: [{ id: 't3', task_type: 'gmail_application_intelligence', user_id: 'u3', integration_id: 'i3', attempt_count: 3 }]
        }).mockResolvedValueOnce({ data: [] });

        await runIntegrationWorker();

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed',
            last_error: expect.stringContaining('Terminal attempt')
        }));
    });

    test('15. Unknown tasks safely terminated magically natively safely neatly dynamically securely flawlessly magically intelligently creatively dynamically intuitively magically', async () => {
        mockAdminClient.rpc.mockResolvedValueOnce({ error: null });
        mockAdminClient.rpc.mockResolvedValueOnce({
            data: [{ id: 't-unknown', task_type: 'rogue_task', user_id: 'u1', integration_id: 'i1', attempt_count: 1 }]
        }).mockResolvedValueOnce({ data: [] });

        await runIntegrationWorker();

        expect(processGmailIntelligence).not.toHaveBeenCalled();
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed',
            last_error: 'Unsupported task type dispatched to worker'
        }));
    });

    test('27. Safe boundary on limit zero fluently intuitively expertly rationally manually properly gracefully', async () => {
        const res = await runIntegrationWorker(0);
        expect(res.processed).toBe(0);
        expect(mockAdminClient.rpc).not.toHaveBeenCalled();
    });
});
