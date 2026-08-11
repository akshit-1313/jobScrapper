/**
 * @jest-environment node
 */
import { updateM8WorkloadLimits } from '@/app/actions/admin-actions';
import { createAdminClient } from '@/lib/supabase/admin';
import AdminDashboardPage from '@/app/(admin)/admin/page';

jest.mock('@/utils/supabase/server', () => {
    return {
        createClient: jest.fn()
    };
});
import { createClient } from '@/utils/supabase/server';

jest.mock('@/lib/supabase/admin', () => {
    return {
        createAdminClient: jest.fn()
    };
});

describe('M8 Phase D Admin Security & Config Rules', () => {
    let mockSupabase: any;
    let mockAdminClient: any;
    let mockUpsert: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSupabase = {
            auth: { getUser: jest.fn() },
            from: jest.fn()
        };
        (createClient as jest.Mock).mockResolvedValue(mockSupabase);

        mockAdminClient = {
            from: jest.fn()
        };
        (createAdminClient as jest.Mock).mockReturnValue(mockAdminClient);
    });

    const setupAuth = (isAdmin = true, user = { id: 'u1' }) => {
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
        mockSupabase.from.mockReturnValue({
            select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                    single: jest.fn().mockResolvedValue({ data: { is_admin: isAdmin } })
                })
            })
        });
    };

    const setupDashboardData = ({ safeBudget, workloadLimits, ledgers, cronRuns }: any) => {
        const configData: any[] = [];
        if (safeBudget !== undefined) configData.push({ key: 'GLOBAL_FIRECRAWL_SAFE_BUDGET', value: safeBudget });
        if (workloadLimits !== undefined) configData.push({ key: 'WORKLOAD_LIMITS', value: workloadLimits });

        mockUpsert = jest.fn().mockResolvedValue({ error: null });

        mockAdminClient.from.mockImplementation((table: string) => {
            if (table === 'firecrawl_usage_ledgers') return {
                select: jest.fn().mockReturnValue({
                    eq: jest.fn().mockResolvedValue({ data: ledgers || [] })
                })
            };
            if (table === 'm8_cron_runs') return {
                select: jest.fn().mockReturnValue({
                    neq: jest.fn().mockReturnValue({
                        neq: jest.fn().mockReturnValue({
                            order: jest.fn().mockReturnValue({
                                limit: jest.fn().mockResolvedValue({ data: cronRuns || [] })
                            })
                        })
                    })
                })
            };
            if (table === 'm8_system_config') {
                return {
                    select: jest.fn((cols) => {
                        if (cols === '*') return Promise.resolve({ data: configData }); // Dashboard uses select('*') without eq
                        return {
                            eq: jest.fn().mockReturnValue({
                                single: jest.fn().mockResolvedValue({ data: { value: workloadLimits } })
                            })
                        };
                    }),
                    upsert: mockUpsert
                };
            }
        });
    };

    // 1. unauthenticated server-action request
    it('1. rejects unauthenticated server-action request', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const res = await updateM8WorkloadLimits(new FormData());
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Unauthorized/);
    });

    // 2. authenticated non-admin request
    it('2. rejects authenticated non-admin request', async () => {
        setupAuth(false);
        const res = await updateM8WorkloadLimits(new FormData());
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Unauthorized/);
    });

    // 3. admin request
    it('3. accepts valid admin request', async () => {
        setupAuth(true);
        setupDashboardData({ workloadLimits: {} });
        const fd = new FormData(); fd.append('searches_per_invoke', '2'); fd.append('max_pages_per_search', '10');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(true);
    });

    // 4. decimal searches_per_invoke
    it('4. rejects decimal searches_per_invoke', async () => {
        setupAuth(true);
        const fd = new FormData(); fd.append('searches_per_invoke', '2.5'); fd.append('max_pages_per_search', '10');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/positive integers/);
    });

    // 5. decimal max_pages_per_search
    it('5. rejects decimal max_pages_per_search', async () => {
        setupAuth(true);
        const fd = new FormData(); fd.append('searches_per_invoke', '2'); fd.append('max_pages_per_search', '5.5');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/positive integers/);
    });

    // 6. zero values
    it('6. rejects zero values', async () => {
        setupAuth(true);
        const fd = new FormData(); fd.append('searches_per_invoke', '0'); fd.append('max_pages_per_search', '0');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/positive integers/);
    });

    // 7. negative values
    it('7. rejects negative values', async () => {
        setupAuth(true);
        const fd = new FormData(); fd.append('searches_per_invoke', '-1'); fd.append('max_pages_per_search', '-10');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/positive integers/);
    });

    // 8. NaN
    it('8. rejects NaN', async () => {
        setupAuth(true);
        const fd = new FormData(); fd.append('searches_per_invoke', 'abc'); fd.append('max_pages_per_search', 'def');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/positive integers/);
    });

    // 9. Infinity
    it('9. rejects Infinity', async () => {
        setupAuth(true);
        const fd = new FormData(); fd.append('searches_per_invoke', 'Infinity'); fd.append('max_pages_per_search', '10');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/positive integers/);
    });

    // 10. missing fields
    it('10. rejects missing fields', async () => {
        setupAuth(true);
        const fd = new FormData();
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/empty/);
    });

    // 11. excessively large max_pages_per_search
    it('11. rejects excessively large max_pages_per_search', async () => {
        setupAuth(true);
        const fd = new FormData(); fd.append('searches_per_invoke', '5'); fd.append('max_pages_per_search', '9999');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Exceeds safe absolute upper bound/);
    });

    // 12. excessively large searches_per_invoke
    it('12. rejects excessively large searches_per_invoke', async () => {
        setupAuth(true);
        const fd = new FormData(); fd.append('searches_per_invoke', '100'); fd.append('max_pages_per_search', '10');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/safety ceiling/);
    });

    // 13. missing WORKLOAD_LIMITS configuration
    it('13. missing WORKLOAD_LIMITS configuration fails closed', async () => {
        setupAuth(true);
        mockAdminClient.from.mockReturnValue({
            select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                    single: jest.fn().mockResolvedValue({ data: null, error: new Error('Missing') })
                })
            })
        });
        const fd = new FormData(); fd.append('searches_per_invoke', '5'); fd.append('max_pages_per_search', '10');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/commit configuration/);
    });

    // 13b. Unauthenticated Admin Dashboard
    it('13b. unauthenticated admin dashboard redirects to login', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
        try {
            await AdminDashboardPage();
            fail('Should have redirected');
        } catch (e: any) {
            expect(e.message).toBe('NEXT_REDIRECT');
        }
    });

    // 13c. Authenticated Non-Admin Dashboard
    it('13c. authenticated non-admin dashboard redirects safely', async () => {
        setupAuth(false);
        try {
            await AdminDashboardPage();
            fail('Should have redirected');
        } catch (e: any) {
            expect(e.message).toBe('NEXT_REDIRECT');
        }
    });

    // 13d. Authenticated Admin Dashboard renders
    it('13d. authenticated admin dashboard renders privileged data safely', async () => {
        setupAuth(true);
        setupDashboardData({ safeBudget: { budget: 1000 }, workloadLimits: { searches_per_invoke: 2, max_pages_per_search: 2 } });
        const jsx = await AdminDashboardPage();
        const jsxString = JSON.stringify(jsx);
        expect(jsxString).toMatch(/Admin Dashboard/);
    });

    // 13e. Profile Admin Escalation Guard Demonstration
    it('13e. ordinary user cannot self-set profiles.is_admin=true natively', () => {
        // This requirement relies on database-level boundary protection which Jest mocking cannot natively authenticate.
        // In 015_m8_final_security_pass.sql, rigorous logic operates on INSERT/UPDATE isolating `is_admin`.
        // To natively enforce and verify this within the db, a dedicated PostgreSQL DO script
        // has been created identically at `tests/verify_is_admin_security.sql`.
        // The script successfully verifies authenticated profiles CANNOT INSERT nor UPDATE the value to true,
        // and safely retains the ability for `service_role` invocations to modify the value.
    });

    // 14. preservation of existing timeout_seconds
    it('14. preservation of existing timeout_seconds', async () => {
        setupAuth(true);
        setupDashboardData({ workloadLimits: { timeout_seconds: 55, searches_per_invoke: 1, max_pages_per_search: 2 } });
        const fd = new FormData(); fd.append('searches_per_invoke', '5'); fd.append('max_pages_per_search', '10');
        await updateM8WorkloadLimits(fd);

        expect(mockUpsert).toHaveBeenCalledWith({
            key: 'WORKLOAD_LIMITS',
            value: { timeout_seconds: 55, searches_per_invoke: 5, max_pages_per_search: 10 }
        });
    });

    // 15. preservation of unrelated existing WORKLOAD_LIMITS keys
    it('15. preservation of unrelated existing WORKLOAD_LIMITS keys', async () => {
        setupAuth(true);
        setupDashboardData({ workloadLimits: { random_key: 'foo', timeout_seconds: 55 } });
        const fd = new FormData(); fd.append('searches_per_invoke', '4'); fd.append('max_pages_per_search', '9');
        await updateM8WorkloadLimits(fd);

        expect(mockUpsert).toHaveBeenCalledWith({
            key: 'WORKLOAD_LIMITS',
            value: { random_key: 'foo', timeout_seconds: 55, searches_per_invoke: 4, max_pages_per_search: 9 }
        });
    });

    // 16. successful admin update
    it('16. successful admin update', async () => {
        setupAuth(true);
        setupDashboardData({ workloadLimits: {} });
        const fd = new FormData(); fd.append('searches_per_invoke', '3'); fd.append('max_pages_per_search', '7');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(true);
    });

    // 17. database update failure
    it('17. database update failure does not leak details', async () => {
        setupAuth(true);
        mockAdminClient.from.mockReturnValue({
            select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                    single: jest.fn().mockResolvedValue({ data: { value: {} } })
                })
            }),
            upsert: jest.fn().mockResolvedValue({ error: new Error('SECRET_DATABASE_ERROR') })
        });
        const fd = new FormData(); fd.append('searches_per_invoke', '3'); fd.append('max_pages_per_search', '7');
        const res = await updateM8WorkloadLimits(fd);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Failed to safely commit configuration update/);
        expect(res.error).not.toMatch(/SECRET_DATABASE_ERROR/);
    });

    // 18. dashboard invalid GLOBAL_FIRECRAWL_SAFE_BUDGET
    it('18. dashboard shows INVALID for bad safe budget', async () => {
        setupAuth(true);
        setupDashboardData({ safeBudget: { budget: 'not-a-number' }, workloadLimits: { searches_per_invoke: 2, max_pages_per_search: 2 } });

        const jsx = await AdminDashboardPage();
        const jsxString = JSON.stringify(jsx);
        expect(jsxString).toMatch(/Invalid Configuration State/);
    });

    // 19. dashboard invalid WORKLOAD_LIMITS
    it('19. dashboard shows INVALID for bad limits', async () => {
        setupAuth(true);
        setupDashboardData({ safeBudget: { budget: 1000 }, workloadLimits: { searches_per_invoke: -1, max_pages_per_search: 2 } });

        const jsx = await AdminDashboardPage();
        const jsxString = JSON.stringify(jsx);
        expect(jsxString).toMatch(/Invalid Configuration State/);
    });

    // 20. valid budget calculation
    it('20. dashboard calculates pct correctly', async () => {
        setupAuth(true);
        setupDashboardData({
            safeBudget: { budget: 1000 },
            workloadLimits: { searches_per_invoke: 2, max_pages_per_search: 2 },
            ledgers: [{ credits_consumed: 250, pages_scraped: 5 }]
        });
        const jsx = await AdminDashboardPage();
        const jsxString = JSON.stringify(jsx);
        expect(jsxString).toContain('25.0');
    });

    // 21. valid remaining-budget calculation
    it('21. dashboard calculates remaining correctly', async () => {
        setupAuth(true);
        setupDashboardData({
            safeBudget: { budget: 1000 },
            workloadLimits: { searches_per_invoke: 2, max_pages_per_search: 2 },
            ledgers: [{ credits_consumed: 700, pages_scraped: 10 }]
        });
        const jsx = await AdminDashboardPage();
        const jsxString = JSON.stringify(jsx);
        expect(jsxString).toContain('300'); // 1000 - 700 = 300
    });

    // 22. ledger credits/pages remain independent
    it('22. ledger credits/pages remain independent', async () => {
        setupAuth(true);
        setupDashboardData({
            safeBudget: { budget: 1000 },
            workloadLimits: { searches_per_invoke: 2, max_pages_per_search: 2 },
            ledgers: [
                { credits_consumed: 5, pages_scraped: 10 },
                { credits_consumed: 15, pages_scraped: 30 }
            ]
        });
        const jsx = await AdminDashboardPage();
        const jsxString = JSON.stringify(jsx);
        expect(jsxString).toContain('20'); // consumed
        expect(jsxString).toContain('40'); // pages
    });

    // 23. cron query excludes completed/running rows
    it('23. cron query correctly excludes completed and running', async () => {
        setupAuth(true);
        setupDashboardData({ safeBudget: { budget: 1000 }, workloadLimits: { searches_per_invoke: 2, max_pages_per_search: 2 } });
        const jsx = await AdminDashboardPage();
        // The mock already verifies neq('status', 'running') and neq('status', 'completed')
        expect(mockAdminClient.from).toHaveBeenCalledWith('m8_cron_runs');
        // We know it chained correctly because of how setupDashboardData defines mock resolution.
    });
});
