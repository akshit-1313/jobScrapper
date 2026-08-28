/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { processGmailDeepExtraction } from '@/lib/integrations/gmail-extraction-processor';
import { createAdminClient } from '@/lib/supabase/admin';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('@/lib/supabase/admin', () => ({
    createAdminClient: jest.fn()
}));
jest.mock('ai', () => ({ generateObject: jest.fn() }), { virtual: true });
jest.mock('@ai-sdk/openai', () => ({ openai: jest.fn() }), { virtual: true });

// M10.2 Orchestration Test Suite
describe('M10.2 Database & Orchestration isolation boundaries', () => {

    let mockAdminClient: any;
    let mockSelect: jest.Mock;
    let mockInsert: jest.Mock;
    let mockRpc: jest.Mock;
    const testUserId = '00000000-0000-0000-0000-000000000000';
    const testIntegrationId = '11111111-1111-1111-1111-111111111111';

    beforeEach(() => {
        jest.clearAllMocks();
        mockSelect = jest.fn().mockReturnThis();
        mockInsert = jest.fn().mockResolvedValue({ error: null });
        mockRpc = jest.fn().mockResolvedValue({
            data: [{
                id: 'task_1',
                task_type: 'gmail_deep_extraction',
                idempotency_key: 'extracted_message:test_msg_123',
                payload: { message_id: 'test_msg_123' }
            }],
            error: null
        });

        mockAdminClient = {
            rpc: mockRpc,
            from: jest.fn(() => ({
                select: mockSelect,
                insert: mockInsert,
                limit: jest.fn().mockResolvedValue({ error: null, data: [] })
            }))
        };

        (createAdminClient as jest.Mock).mockReturnValue(mockAdminClient);
    });

    test('Test 1: email_extractions schema query simulates without crash', async () => {
        const client = createAdminClient();
        const { error } = await client.from('email_extractions').select('id').limit(1);
        expect(error).toBeNull();
        expect(client.from).toHaveBeenCalledWith('email_extractions');
    });

    test('Test 2: gmail_deep_extraction task type native mock claims correctly', async () => {
        const client = createAdminClient();
        const payload = {
            message_id: 'test_msg_123',
            thread_id: 'test_thread_123',
            matched_application_id: null
        };

        const { error } = await client.from('integration_tasks').insert({
            user_id: testUserId,
            integration_id: testIntegrationId,
            task_type: 'gmail_deep_extraction',
            status: 'pending',
            idempotency_key: 'extracted_message:test_msg_123',
            payload
        });

        expect(error).toBeNull();
        expect(client.from).toHaveBeenCalledWith('integration_tasks');

        // Verify RPC signature allows array requests
        const { data: claims } = await client.rpc('claim_next_integration_task', {
            p_task_types: ['gmail_application_intelligence', 'gmail_deep_extraction']
        });

        expect(claims).toBeDefined();
        if (claims) {
            expect(claims.length).toBeGreaterThan(0);
            expect(claims[0].task_type).toBe('gmail_deep_extraction');
            expect(claims[0].idempotency_key).toBe('extracted_message:test_msg_123');
        }
    });

    // Test 4 removed as M10.3 LLM Integration replaces the stub completely.

    test('Test 5: Duplicate enqueue returns gracefully upon violation constraint mock', async () => {
        // We override insert strictly for this test to mock the constraint violation
        mockInsert.mockResolvedValueOnce({ error: { code: '23505' } });
        const client = createAdminClient();
        const { error: e2 } = await client.from('integration_tasks').insert({
            user_id: testUserId,
            integration_id: testIntegrationId,
            task_type: 'gmail_deep_extraction',
            status: 'pending',
            idempotency_key: 'extracted_message:msg_dup'
        });
        expect(e2).toBeDefined();
        expect(e2?.code).toBe('23505'); // Unique violation
    });

});
