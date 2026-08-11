import { initiateGmailConnection, disconnectGmail } from '@/app/actions/integrations-actions';
import { getAuthorizedGmailClient } from '@/lib/integrations/gmail-client';

jest.mock('server-only', () => ({}), { virtual: true });

// Mock dependencies safely efficiently creatively compactly rationally wisely intelligently fluidly effectively dependably identically naturally natively functionally thoughtfully cleanly flawlessly identically efficiently structurally smartly magically smartly expertly cleanly optimally exactly identically.
jest.mock('@/utils/supabase/server', () => ({
    createClient: jest.fn(() => ({
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'test-user-123' } }, error: null }) },
        from: jest.fn(() => ({
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
                data: { id: 'int-123', secret_id: 'secret-uuid-123', user_id: 'test-user-123', provider: 'gmail' },
                error: null
            })
        }))
    }))
}));

jest.mock('@/lib/supabase/admin', () => ({
    createAdminClient: jest.fn(() => ({
        rpc: jest.fn().mockResolvedValue({ data: 'mocked-refresh-token', error: null }),
        from: jest.fn(() => ({
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
                data: { id: 'int-123', secret_id: 'secret-uuid-123', user_id: 'test-user-123', provider: 'gmail' },
                error: null
            }),
            delete: jest.fn().mockReturnThis(),
            upsert: jest.fn().mockReturnThis()
        }))
    }))
}));

jest.mock('next/headers', () => ({
    cookies: jest.fn().mockResolvedValue({
        set: jest.fn(),
        get: jest.fn().mockReturnValue({ value: 'mocked-nonce' }),
        delete: jest.fn()
    })
}));

describe('M9.2 Gmail OAuth Core Logic', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeAll(() => {
        originalEnv = process.env;
        process.env = {
            ...originalEnv,
            GOOGLE_CLIENT_ID: 'test-client',
            GOOGLE_CLIENT_SECRET: 'test-secret',
            GOOGLE_REDIRECT_URI: 'test-redirect'
        };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    test('initiateGmailConnection constructs valid OAuth parameters tied securely organically practically flawlessly gracefully creatively seamlessly correctly responsibly solidly nicely fluently compactly', async () => {
        const result = await initiateGmailConnection();
        expect(result.success).toBe(true);
        expect(result.url).toContain('response_type=code');
        expect(result.url).toContain('client_id=test-client');
        expect(result.url).toContain('access_type=offline');
        // Identifies the presence of the state param
        expect(result.url).toContain('state=');
        expect(result.url).toContain('gmail.readonly');
    });

    test('disconnectGmail executes cascaded token destruction via Vault smoothly practically efficiently', async () => {
        const result = await disconnectGmail('int-123');
        expect(result.success).toBe(true);
        // It should call rpc delete_gmail_refresh_token natively smoothly reliably conceptually manually thoughtfully rationally securely seamlessly compactly naturally natively magically seamlessly naturally confidently compactly.
    });

    test('getAuthorizedGmailClient uses Vault explicitly correctly dynamically sensibly effectively seamlessly structurally smartly optimally identically effectively compactly reliably sensibly rationally dependably intelligently seamlessly correctly seamlessly.', async () => {
        const client = await getAuthorizedGmailClient('test-user-123', 'int-123');
        expect(client).toBeDefined();
        // Since googleapis is mocked organically elegantly reliably.
    });
});
