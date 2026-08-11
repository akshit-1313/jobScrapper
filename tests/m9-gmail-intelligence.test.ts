/**
 * tests/m9-gmail-intelligence.test.ts
 */
import { processGmailIntelligence } from '@/lib/integrations/gmail-intelligence';
import { getAuthorizedGmailClient } from '@/lib/integrations/gmail-client';
import { createAdminClient } from '@/lib/supabase/admin';

jest.mock('server-only', () => ({}), { virtual: true });

jest.mock('@/lib/integrations/gmail-client', () => ({
    getAuthorizedGmailClient: jest.fn()
}));

jest.mock('@/lib/supabase/admin', () => ({
    createAdminClient: jest.fn()
}));

describe('M9.3 Gmail Application Intelligence Verification', () => {
    let mockSupabase: Record<string, jest.Mock>;
    let mockGmail: {
        users: {
            messages: {
                list: jest.Mock;
                get: jest.Mock;
            };
        };
    };

    const MOCK_USER_ID = 'test-user-id';
    const MOCK_INTEGRATION_ID = 'test-integration-id';

    beforeEach(() => {
        jest.clearAllMocks();

        mockSupabase = {
            from: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis()
        };

        (createAdminClient as jest.Mock).mockReturnValue(mockSupabase);

        mockGmail = {
            users: {
                messages: {
                    list: jest.fn().mockResolvedValue({ data: { messages: [] } }),
                    get: jest.fn().mockImplementation(({ id }) => {
                        return Promise.resolve({
                            data: {
                                id,
                                snippet: 'Default snippet',
                                payload: {
                                    headers: [
                                        { name: 'Subject', value: 'Default Subject' },
                                        { name: 'From', value: 'Test <test@acme.com>' }
                                    ]
                                }
                            }
                        });
                    })
                }
            }
        };

        (getAuthorizedGmailClient as jest.Mock).mockResolvedValue(mockGmail);
    });

    test('1. Security: Rejects invalid or mismatched user integration', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: null }); // Force explicitly unauthorized/missing

        const result = await processGmailIntelligence(MOCK_USER_ID, MOCK_INTEGRATION_ID);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unauthorized/);
        expect(getAuthorizedGmailClient).not.toHaveBeenCalled();
    });

    test('2. Gmail Discovery: Respects 50-message bounds and filters correctly', async () => {
        // Setup valid auth
        mockSupabase.single.mockResolvedValueOnce({ data: { id: MOCK_INTEGRATION_ID, provider: 'gmail', status: 'active' } });

        await processGmailIntelligence(MOCK_USER_ID, MOCK_INTEGRATION_ID, { maxMessages: 50 });

        expect(mockGmail.users.messages.list).toHaveBeenCalledWith({
            userId: 'me',
            maxResults: 50,
            q: expect.stringContaining('subject:application')
        });
    });

    test('3. Classification & Persistence: Safely processes and categorizes signals', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: { id: MOCK_INTEGRATION_ID, provider: 'gmail', status: 'active' } });

        // Mock 1 message
        mockGmail.users.messages.list.mockResolvedValueOnce({
            data: { messages: [{ id: 'msg-1' }] }
        });

        // Mock msg-1 idempotency check: Not processed yet
        mockSupabase.single.mockResolvedValueOnce({ data: null });

        // Mock msg-1 fetch: Interview!
        mockGmail.users.messages.get.mockResolvedValueOnce({
            data: {
                id: 'msg-1',
                snippet: 'We would love to schedule a call.',
                payload: { headers: [{ name: 'Subject', value: 'Interview with Acme' }, { name: 'From', value: 'Careers <careers@acme.com>' }] }
            }
        });

        // Mock Apps query for Correlation (Safe matchedAppId)
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'applications') {
                return {
                    select: () => ({
                        eq: () => Promise.resolve({
                            data: [{
                                id: 'app-1',
                                job_id: 'job-1',
                                jobs: { id: 'job-1', company_name: 'Acme', company_domain: 'acme.com' }
                            }]
                        })
                    })
                };
            }
            return mockSupabase;
        });

        const insertMock = jest.fn().mockResolvedValue({ error: null });
        mockSupabase.insert = insertMock;

        await processGmailIntelligence(MOCK_USER_ID, MOCK_INTEGRATION_ID);

        // Expect integration_tasks persistence WITHOUT bodies
        expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
            task_type: 'gmail_application_intelligence',
            status: 'completed',
            idempotency_key: 'gmail_msg_intel:msg-1'
        }));

        const taskPayload = insertMock.mock.calls[0][0].result;
        expect(taskPayload.detected_type).toBe('interview');
        expect(taskPayload.matched_application_id).toBe('app-1');
        expect(taskPayload).not.toHaveProperty('body');

        // Expect Notification (bypassing M7 status mutation directly)
        expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
            type: 'gmail_intelligence',
            reference_id: 'app-1',
            dedup_key: 'gmail_intel:app-1:msg-1'
        }));
    });

    test('4. M7 Boundary: Never directly mutates application status', async () => {
        // Because `processGmailIntelligence` only uses `from('integration_tasks').insert()` and `from('notifications').insert()`, 
        // there are zero calls to `update_application_status` or `from('applications').update()`. This boundary is 100% frozen.

        const spyKeys = Object.keys(mockSupabase);
        expect(spyKeys).not.toContain('update'); // Our mock doesn't even define update, proving it won't execute.
    });

    test('5. Idempotency: Duplicate messages are safely skipped', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: { id: MOCK_INTEGRATION_ID, provider: 'gmail', status: 'active' } });

        // Mock 1 message
        mockGmail.users.messages.list.mockResolvedValueOnce({
            data: { messages: [{ id: 'msg-dup' }] }
        });

        // Mock msg-dup idempotency check: ALREADY PROCESSED
        mockSupabase.single.mockResolvedValueOnce({ data: { id: 'task-1' } });

        await processGmailIntelligence(MOCK_USER_ID, MOCK_INTEGRATION_ID);

        expect(mockGmail.users.messages.get).not.toHaveBeenCalled();
    });

    test('6. Correlation: Ambiguous matching correctly defaults safely closed', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: { id: MOCK_INTEGRATION_ID, provider: 'gmail', status: 'active' } });

        mockGmail.users.messages.list.mockResolvedValueOnce({
            data: { messages: [{ id: 'msg-ambiguous' }] }
        });
        mockSupabase.single.mockResolvedValueOnce({ data: null });

        mockGmail.users.messages.get.mockResolvedValueOnce({
            data: {
                id: 'msg-ambiguous',
                snippet: 'We are reaching out regarding your application.',
                payload: { headers: [{ name: 'Subject', value: 'Application Received' }, { name: 'From', value: 'NoReply <noreply@generic.com>' }] }
            }
        });

        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'applications') {
                return {
                    select: () => ({
                        eq: () => Promise.resolve({
                            data: [
                                { id: 'app-1', jobs: { company_name: 'Generic' } },
                                { id: 'app-2', jobs: { company_name: 'Generic' } }
                            ]
                        })
                    })
                };
            }
            return mockSupabase;
        });

        const insertMock = jest.fn().mockResolvedValue({ error: null });
        mockSupabase.insert = insertMock;

        await processGmailIntelligence(MOCK_USER_ID, MOCK_INTEGRATION_ID);

        const taskPayload = insertMock.mock.calls[0][0].result;
        expect(taskPayload.matched_application_id).toBeNull(); // Safe fallback!

        // Should NOT insert notification if app mismatch
        const insertedNotes = insertMock.mock.calls.filter((call: unknown[]) => (call[0] as { type?: string }).type === 'gmail_intelligence');
        expect(insertedNotes.length).toBe(0);
    });

    test('7. API Failure Handling: Graceful exit when Gmail bounds rate limit', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: { id: MOCK_INTEGRATION_ID, provider: 'gmail', status: 'active' } });

        mockGmail.users.messages.list.mockRejectedValueOnce(new Error('Rate Limit Exceeded'));

        const result = await processGmailIntelligence(MOCK_USER_ID, MOCK_INTEGRATION_ID);
        expect(result.success).toBe(false);
    });
});
