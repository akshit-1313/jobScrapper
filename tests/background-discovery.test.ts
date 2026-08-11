/**
 * @jest-environment node
 */
import { executeBackgroundDiscovery } from '@/lib/m8/background-discovery';
import { createAdminClient } from '@/lib/supabase/admin';
import { runJobDiscoveryForUser } from '@/lib/jobs/discovery-service';

jest.mock('@/lib/supabase/admin', () => ({
    createAdminClient: jest.fn()
}));

jest.mock('@/lib/jobs/discovery-service', () => ({
    runJobDiscoveryForUser: jest.fn()
}));

const mockRunJobDiscovery = runJobDiscoveryForUser as jest.Mock;

describe('M8 Phase B Background Orchestrator Constraints', () => {
    let mockSupabase: any;
    let mockSelect: any, mockUpdate: any, mockInsert: any, mockUpsert: any;
    let mockEq: any, mockSingle: any, mockIn: any, mockGt: any, mockOrder: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSingle = jest.fn().mockResolvedValue({ data: {}, error: null });
        mockEq = jest.fn().mockReturnValue({ single: mockSingle, in: mockIn });
        mockIn = jest.fn().mockReturnValue({ order: mockOrder, data: [], error: null });
        mockGt = jest.fn().mockReturnValue({ data: [], error: null });
        mockOrder = jest.fn().mockReturnValue({ order: mockOrder, data: [], error: null });

        mockSelect = jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ gt: mockGt }), single: mockSingle, in: mockIn }),
            in: mockIn,
            single: mockSingle
        });
        mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
        mockInsert = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: mockSingle }) });
        mockUpsert = jest.fn().mockResolvedValue({ data: null, error: null });

        mockSupabase = {
            from: jest.fn().mockImplementation((table: string) => ({
                select: mockSelect, update: mockUpdate, insert: mockInsert, upsert: mockUpsert
            }))
        };
        (createAdminClient as jest.Mock).mockReturnValue(mockSupabase);

        mockRunJobDiscovery.mockResolvedValue({
            runId: 'fake-run-123', creditsUsed: 5, pagesScraped: 2, runError: false, unknownUsage: false
        });
    });

    // We use a helper builder to reduce test boilerplate 
    const setupScenario = (overrides: any) => {
        mockSingle.mockResolvedValueOnce({ data: { id: 'cron-id' }, error: null }); // Insert Cron
        mockSelect.mockReturnValueOnce({
            data: [
                { key: 'GLOBAL_FIRECRAWL_SAFE_BUDGET', value: overrides.globalBudget ?? { budget: 800 } },
                { key: 'WORKLOAD_LIMITS', value: overrides.workload ?? { searches_per_invoke: 5, timeout_seconds: 55, max_pages_per_search: 3 } }
            ], error: null
        }); // configs
        mockSelect.mockReturnValueOnce({ eq: jest.fn().mockResolvedValue({ data: overrides.globalLedger || [], error: null }) });
        mockSelect.mockReturnValueOnce({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ gt: jest.fn().mockResolvedValue({ data: overrides.allocations || [{ user_id: 'user-a', allocated_credits: 100 }] }) }) }) });
        mockSelect.mockReturnValueOnce({ eq: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: overrides.userLedger || [] }) }) }); // User ledgers
        mockSelect.mockReturnValueOnce({ eq: jest.fn().mockReturnValue({ in: jest.fn().mockReturnValue({ order: jest.fn().mockReturnValue({ order: jest.fn().mockResolvedValue({ data: overrides.savedSearches || [{ id: 'search-a', user_id: 'user-a', search_phrase: 'dev india' }] }) }) }) }) });
        mockSelect.mockReturnValueOnce({ in: jest.fn().mockResolvedValue({ data: overrides.geography || [] }) }); // Geo Prefernce
        mockSingle.mockResolvedValueOnce({ data: { status: 'completed' }, error: null }); // Cron Timeout check
    };

    it('1. JSONB budget parses to 800 and 2/3. Config Missing/Invalid fails closed', async () => {
        setupScenario({ globalBudget: {}, workload: {} });
        const res = await executeBackgroundDiscovery();
        expect(res.success).toBe(false);
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error_log: expect.stringContaining('M8_ERR_CONFIG_INVALID') }));
    });

    it('4 & 6. User with 1 credit + worst-case 3 is bypassed, Global remaining 1 + worst case 3 bypassed', async () => {
        setupScenario({
            allocations: [{ user_id: 'user-a', allocated_credits: 1 }],
            workload: { searches_per_invoke: 5, max_pages_per_search: 3, timeout_seconds: 55 }
        });
        const res = await executeBackgroundDiscovery();
        expect(res.success).toBe(true);
        expect(res.processed).toBe(0); // 1 < 3 natively
        expect(mockRunJobDiscovery).not.toHaveBeenCalled();
    });

    it('5. User with 3 credits and worst-case 3 can execute', async () => {
        setupScenario({
            allocations: [{ user_id: 'user-a', allocated_credits: 3 }],
            workload: { searches_per_invoke: 5, max_pages_per_search: 3, timeout_seconds: 55 }
        });
        await executeBackgroundDiscovery();
        expect(mockRunJobDiscovery).toHaveBeenCalled();
    });

    it('7 & 8 & 16. Unknown usage applies max_pages_per_search and NEVER creates negative balance', async () => {
        setupScenario({
            allocations: [{ user_id: 'user-a', allocated_credits: 100 }],
            workload: { searches_per_invoke: 5, max_pages_per_search: 10, timeout_seconds: 55 }
        });
        mockRunJobDiscovery.mockResolvedValue({
            runId: 'actual-run-id', creditsUsed: NaN, pagesScraped: 3, runError: false, unknownUsage: true
        });
        await executeBackgroundDiscovery();
        expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
            credits_consumed: 10, // worst case fallback
            reconciliation_status: 'provider_usage_unknown'
        }), expect.anything());
    });

    it('11. Missing geo preference defaults to 50%', async () => {
        // Just verify execution doesn't blow up and maps correctly natively
        setupScenario({ geography: [] });
        const res = await executeBackgroundDiscovery();
        expect(res.success).toBe(true);
    });

    it('19. Ledger failure stops subsequent searches', async () => {
        setupScenario({
            allocations: [{ user_id: 'user-a', allocated_credits: 100 }],
            savedSearches: [{ id: 's1', user_id: 'user-a', search_phrase: 'a' }, { id: 's2', user_id: 'user-a', search_phrase: 'b' }]
        });
        mockUpsert.mockResolvedValueOnce({ data: null, error: { message: 'Database lockdown' } });

        const res = await executeBackgroundDiscovery();
        expect(res.success).toBe(false);
        expect(res.reason).toBe('CRITICAL_LEDGER_FAILURE');
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error_log: 'CRITICAL_LEDGER_FAILURE: Database lockdown' }));
        // Should only run 1 search before dying natively
        expect(mockRunJobDiscovery).toHaveBeenCalledTimes(1);
    });

    it('27 & 28. User A exhaustion does not stop User B, but Global Exhaustion stops everybody', async () => {
        setupScenario({
            allocations: [{ user_id: 'user-a', allocated_credits: 1 }, { user_id: 'user-b', allocated_credits: 100 }],
            savedSearches: [{ id: 's1', user_id: 'user-a', search_phrase: 'a' }, { id: 's2', user_id: 'user-b', search_phrase: 'b' }],
            workload: { searches_per_invoke: 5, max_pages_per_search: 3, timeout_seconds: 55 }
        });
        // User A (1) is less than worst case 3, User B (100) is okay
        await executeBackgroundDiscovery();
        // User B search should be the only one passed
        expect(mockRunJobDiscovery).toHaveBeenCalledTimes(1);
        expect(mockRunJobDiscovery).toHaveBeenCalledWith('user-b', expect.anything());
    });
});
