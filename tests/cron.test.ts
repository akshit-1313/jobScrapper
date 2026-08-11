/**
 * @jest-environment node
 */
import { POST } from '@/app/api/cron/discovery/route';
import { executeBackgroundDiscovery } from '@/lib/m8/background-discovery';

jest.mock('@/lib/m8/background-discovery', () => ({
    executeBackgroundDiscovery: jest.fn()
}));

const mockExecute = executeBackgroundDiscovery as jest.Mock;

describe('M8 Phase B CRON Authorization', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('rejects execution when CRON_SECRET is entirely missing from the environment', async () => {
        delete process.env.CRON_SECRET;

        const req = new Request('http://localhost:3000/api/cron/discovery', {
            method: 'POST',
            headers: {
                'authorization': `Bearer ANY_SECRET`
            }
        });

        const response = await POST(req);
        expect(response.status).toBe(500);
        const data = await response.json();
        expect(data.error).toBe('System Configuration Error');
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('rejects execution with an invalid authorization header', async () => {
        process.env.CRON_SECRET = 'super-secret-m8-token';

        const req = new Request('http://localhost:3000/api/cron/discovery', {
            method: 'POST',
            headers: {
                'authorization': `Bearer evil-hacker-token`
            }
        });

        const response = await POST(req);
        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.error).toBe('Unauthorized');
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('executes the background pipeline successfully with valid matching Bearer token', async () => {
        process.env.CRON_SECRET = 'super-secret-m8-token';
        mockExecute.mockResolvedValueOnce({ success: true, processed: 10 });

        const req = new Request('http://localhost:3000/api/cron/discovery', {
            method: 'POST',
            headers: {
                'authorization': `Bearer super-secret-m8-token`
            }
        });

        const response = await POST(req);
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.processed).toBe(10);
        expect(mockExecute).toHaveBeenCalledTimes(1);
    });
});
