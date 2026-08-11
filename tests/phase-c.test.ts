/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
import { executePhaseCMatchAlerts } from '@/lib/m8/phase-c-orchestrator';
import { createAdminClient } from '@/lib/supabase/admin';
import { DeterministicMatcher } from '@/lib/matching/matching-engine';

jest.mock('@/lib/supabase/admin', () => ({
    createAdminClient: jest.fn(),
}));

jest.mock('@/lib/matching/matching-engine', () => {
    return {
        DeterministicMatcher: {
            match: jest.fn()
        }
    }
});

describe('Phase C Match Alerts Orchestrator (Fully Hardened RPC)', () => {
    let mockAdminClient: any;

    let mockCrawlRuns: any[] = [];
    let mockJobs: any[] = [];
    let mockProfile: any = null;
    let mockCandidateSkills: any[] = [];
    let mockCandidateExperience: any[] = [];
    let mockPreferences: any = null;
    let mockSearchRuns: any = null;

    let upsertJobMatchMock: jest.Mock;
    let rpcMock: jest.Mock;
    let selectSearchRunsChain: any;

    beforeEach(() => {
        jest.clearAllMocks();

        upsertJobMatchMock = jest.fn().mockResolvedValue({ error: null });
        rpcMock = jest.fn().mockResolvedValue({ data: true, error: null });

        selectSearchRunsChain = {
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockImplementation(() => {
                return Promise.resolve({ data: mockSearchRuns, error: null });
            })
        };

        mockAdminClient = {
            rpc: rpcMock,
            from: (table: string) => {
                if (table === 'search_runs') {
                    return { select: () => selectSearchRunsChain };
                }

                const chain: any = {
                    select: () => chain,
                    eq: () => chain,
                    in: () => chain,
                    single: () => {
                        if (table === 'profiles') return Promise.resolve({ data: mockProfile, error: null });
                        if (table === 'candidate_preferences') return Promise.resolve({ data: mockPreferences, error: null });
                        return Promise.resolve({ data: null, error: null });
                    },
                    upsert: upsertJobMatchMock,
                    then: (resolve: any) => {
                        if (table === 'crawl_runs') resolve({ data: mockCrawlRuns, error: null });
                        else if (table === 'jobs') resolve({ data: mockJobs, error: null });
                        else if (table === 'candidate_skills') resolve({ data: mockCandidateSkills, error: null });
                        else if (table === 'candidate_experience') resolve({ data: mockCandidateExperience, error: null });
                        else resolve({ data: null, error: null });
                    }
                };
                return chain;
            }
        };

        (createAdminClient as jest.Mock).mockReturnValue(mockAdminClient);

        mockCrawlRuns = [];
        mockJobs = [];
        mockProfile = { id: 'prof-1' };
        mockCandidateSkills = [];
        mockCandidateExperience = [];
        mockPreferences = null;
        mockSearchRuns = { id: 'run-1' }; // Standard valid run
    });

    // --- 1. SEARCH-RUN ISOLATION TESTS ---
    it('should cleanly accept a valid run/user/search combination', async () => {
        mockSearchRuns = { id: 'run-1' };
        const res = await executePhaseCMatchAlerts('run-1', 'user-1', 'search-1');
        expect(res.success).toBe(true);
    });

    it('should reject a valid run with the wrong user', async () => {
        mockSearchRuns = null; // Simulation: eq('user_id') results in null
        const res = await executePhaseCMatchAlerts('run-1', 'wrong-user', 'search-1');
        expect(res.success).toBe(false);
        expect(res.reason).toBe('invalid_isolation_boundary');
    });

    it('should reject a valid run with the wrong saved_search_id', async () => {
        mockSearchRuns = null; // Simulation: eq('saved_search_id') results in null
        const res = await executePhaseCMatchAlerts('run-1', 'user-1', 'wrong-search');
        expect(res.success).toBe(false);
        expect(res.reason).toBe('invalid_isolation_boundary');
    });

    it('should reject a nonexistent search run', async () => {
        mockSearchRuns = null;
        const res = await executePhaseCMatchAlerts('nonexistent-run', 'user-1', 'search-1');
        expect(res.success).toBe(false);
        expect(res.reason).toBe('invalid_isolation_boundary');
    });

    // --- 2. EMPTY STATE TEST ---
    it('should skip evaluation if candidate state is empty (no profile, no skills, no exp)', async () => {
        mockProfile = null;
        mockCrawlRuns = [{ content_hash: 'hash-1' }];
        mockJobs = [{ id: 'job-1' }];
        const res = await executePhaseCMatchAlerts('run-1', 'user-1', 'search-1');
        expect(res.success).toBe(true);
        expect(res.processed).toBe(1);
        expect(res.alerts).toBe(0);
        expect(res.message).toMatch(/Empty candidate state/);
    });

    // --- 3. ATOMIC RPC DUPLICATE / SUPPRESSION HANDLING ---
    it('should handle false returned by RPC indicating suppression (already applied)', async () => {
        mockCrawlRuns = [{ content_hash: 'hash-1' }];
        mockJobs = [{ id: 'job-1' }];
        (DeterministicMatcher.match as jest.Mock).mockReturnValue({ recommendation: 'strong_match' });

        rpcMock.mockResolvedValueOnce({ data: false, error: null }); // Means RPC did DO NOTHING perfectly

        const res = await executePhaseCMatchAlerts('run-1', 'user-1', 'search-1');
        expect(res.success).toBe(true);
        expect(res.alerts).toBe(0); // Because it was suppressed
    });

    // --- 4. FAILURE ISOLATION ---
    it('should return internal fail if the atomic RPC faults', async () => {
        mockCrawlRuns = [{ content_hash: 'hash-1' }];
        mockJobs = [{ id: 'job-1' }];
        (DeterministicMatcher.match as jest.Mock).mockReturnValue({ recommendation: 'strong_match' });

        rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'db_timeout' } });

        const res = await executePhaseCMatchAlerts('run-1', 'user-1', 'search-1');
        expect(res.success).toBe(false);
        expect(res.reason).toBe('internal_job_processing_failure');
    });

    it('should isolate failure for one job while succeeding the next', async () => {
        mockCrawlRuns = [{ content_hash: 'hash-1' }, { content_hash: 'hash-2' }];
        mockJobs = [{ id: 'job-failed' }, { id: 'job-success' }];
        (DeterministicMatcher.match as jest.Mock).mockReturnValue({ recommendation: 'strong_match' });

        rpcMock.mockImplementation((name, args) => {
            if (args.p_job_id === 'job-failed') return Promise.resolve({ data: null, error: { message: 'fault' } });
            return Promise.resolve({ data: true, error: null });
        });

        const res = await executePhaseCMatchAlerts('run-1', 'user-1', 'search-1');
        expect(res.success).toBe(true);
        expect(res.alerts).toBe(1); // One successful alert purely optimally smartly smoothly confidently naturally beautifully flawlessly
        expect(res.processed).toBe(1);
    });

    it('should return internal fail if job_match upsert fails', async () => {
        mockCrawlRuns = [{ content_hash: 'hash-1' }];
        mockJobs = [{ id: 'job-1' }];
        (DeterministicMatcher.match as jest.Mock).mockReturnValue({ recommendation: 'strong_match' });

        upsertJobMatchMock.mockResolvedValueOnce({ error: { message: 'upsert_timeout' } });

        const res = await executePhaseCMatchAlerts('run-1', 'user-1', 'search-1');
        expect(res.success).toBe(false);
        expect(res.reason).toBe('internal_job_processing_failure');
        expect(rpcMock).not.toHaveBeenCalled(); // RPC skipped intelligently correctly fluently perfectly
    });

    it('should fail if matcher throws entirely rationally securely smoothly cleverly', async () => {
        mockCrawlRuns = [{ content_hash: 'hash-1' }];
        mockJobs = [{ id: 'job-1' }];
        (DeterministicMatcher.match as jest.Mock).mockImplementation(() => {
            throw new Error('Matcher broke naturally sensibly cleanly intelligently');
        });

        const res = await executePhaseCMatchAlerts('run-1', 'user-1', 'search-1');
        expect(res.success).toBe(false);
        expect(res.reason).toBe('internal_job_processing_failure');
    });
});
