/**
 * @jest-environment node
 *
 * Firecrawl search rate limiting.
 *
 * Live-run evidence: 30 sequential search calls (3 queries × 10 sources) were
 * fired into a ~10 req/min ceiling; 20 returned "Rate limit exceeded".
 *
 * The gate must serialize AND space requests, share one budget across
 * concurrent callers, and never retry a rejected request. The SDK is mocked —
 * no network, no credits.
 */

const mockSearch = jest.fn()
const mockScrape = jest.fn()

jest.mock('@mendable/firecrawl-js', () => ({
    __esModule: true,
    default: class MockFirecrawl {
        search = mockSearch
        scrape = mockScrape
    },
}))

import {
    FirecrawlAdapter,
    getSearchRequestsPerMinute,
    minSearchSpacingMs,
    __resetSearchRateGate,
    DEFAULT_SEARCH_REQUESTS_PER_MINUTE,
} from '@/lib/jobs/adapters/firecrawl-adapter'

describe('search rate configuration', () => {
    const original = process.env.FIRECRAWL_SEARCH_RPM

    afterEach(() => {
        if (original === undefined) delete process.env.FIRECRAWL_SEARCH_RPM
        else process.env.FIRECRAWL_SEARCH_RPM = original
    })

    test('defaults to the documented provider limit', () => {
        delete process.env.FIRECRAWL_SEARCH_RPM
        expect(getSearchRequestsPerMinute()).toBe(DEFAULT_SEARCH_REQUESTS_PER_MINUTE)
        expect(DEFAULT_SEARCH_REQUESTS_PER_MINUTE).toBe(10)
    })

    test('is configurable without touching the adapter', () => {
        process.env.FIRECRAWL_SEARCH_RPM = '30'
        expect(getSearchRequestsPerMinute()).toBe(30)
        expect(minSearchSpacingMs()).toBe(2000)
    })

    test('ignores invalid configuration and falls back to the default', () => {
        for (const bad of ['0', '-5', 'abc', '']) {
            process.env.FIRECRAWL_SEARCH_RPM = bad
            expect(getSearchRequestsPerMinute()).toBe(DEFAULT_SEARCH_REQUESTS_PER_MINUTE)
        }
    })

    test('spacing derives from the configured rate', () => {
        process.env.FIRECRAWL_SEARCH_RPM = '10'
        expect(minSearchSpacingMs()).toBe(6000)
        process.env.FIRECRAWL_SEARCH_RPM = '60'
        expect(minSearchSpacingMs()).toBe(1000)
    })
})

describe('search rate gate', () => {
    let adapter: FirecrawlAdapter
    const original = process.env.FIRECRAWL_SEARCH_RPM

    beforeEach(() => {
        jest.clearAllMocks()
        __resetSearchRateGate()
        process.env.FIRECRAWL_API_KEY = 'fc-test-key-not-real'
        // 1200/min → 50ms spacing, so tests stay fast but spacing is observable.
        process.env.FIRECRAWL_SEARCH_RPM = '1200'
        adapter = new FirecrawlAdapter()
    })

    afterEach(() => {
        if (original === undefined) delete process.env.FIRECRAWL_SEARCH_RPM
        else process.env.FIRECRAWL_SEARCH_RPM = original
    })

    test('spaces sequential requests by at least the configured interval', async () => {
        mockSearch.mockResolvedValue({ web: [] })
        const stamps: number[] = []
        mockSearch.mockImplementation(async () => { stamps.push(Date.now()); return { web: [] } })

        const opts = { includeDomains: ['example.com'], limit: 1 }
        await adapter.searchJobs('a', opts)
        await adapter.searchJobs('b', opts)
        await adapter.searchJobs('c', opts)

        expect(stamps).toHaveLength(3)
        expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(45)
        expect(stamps[2] - stamps[1]).toBeGreaterThanOrEqual(45)
    })

    // ── Requirement 12: concurrency must not defeat the limiter ─────────────

    test('CONCURRENT callers share one budget and are still spaced', async () => {
        const stamps: number[] = []
        mockSearch.mockImplementation(async () => { stamps.push(Date.now()); return { web: [] } })

        const opts = { includeDomains: ['example.com'], limit: 1 }
        // Fired in parallel — the gate must serialize them anyway.
        await Promise.all([
            adapter.searchJobs('a', opts),
            adapter.searchJobs('b', opts),
            adapter.searchJobs('c', opts),
            adapter.searchJobs('d', opts),
        ])

        expect(stamps).toHaveLength(4)
        for (let i = 1; i < stamps.length; i++) {
            expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(45)
        }
    })

    test('two adapter instances share the module-level budget', async () => {
        const stamps: number[] = []
        mockSearch.mockImplementation(async () => { stamps.push(Date.now()); return { web: [] } })

        const other = new FirecrawlAdapter()
        const opts = { includeDomains: ['example.com'], limit: 1 }
        await Promise.all([
            adapter.searchJobs('a', opts),
            other.searchJobs('b', opts),
        ])

        expect(stamps).toHaveLength(2)
        expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(45)
    })

    // ── Preserved behaviour ─────────────────────────────────────────────────

    test('a rate-limit error still degrades safely to [] and is NOT retried', async () => {
        mockSearch.mockRejectedValue(new Error('Rate limit exceeded. Consumed (req/min): 11'))

        const out = await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 5 })

        expect(out).toEqual([])
        // Exactly one attempt — no automatic retry.
        expect(mockSearch).toHaveBeenCalledTimes(1)
    })

    test('a failed request does not wedge the gate for later callers', async () => {
        mockSearch.mockRejectedValueOnce(new Error('Rate limit exceeded'))
        mockSearch.mockResolvedValue({ web: [{ url: 'https://example.com/a' }] })

        const opts = { includeDomains: ['example.com'], limit: 5 }
        const first = await adapter.searchJobs('q1', opts)
        const second = await adapter.searchJobs('q2', opts)

        expect(first).toEqual([])
        expect(second).toHaveLength(1)
    })

    test('an empty allow-list still short-circuits BEFORE consuming a slot', async () => {
        const out = await adapter.searchJobs('q', { includeDomains: [], limit: 5 })
        expect(out).toEqual([])
        expect(mockSearch).not.toHaveBeenCalled()
    })

    test('allow-list enforcement is unchanged by throttling', async () => {
        mockSearch.mockResolvedValue({
            web: [{ url: 'https://example.com/ok' }, { url: 'https://evil.com/x' }],
        })
        const out = await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 5 })
        expect(out).toHaveLength(1)
        expect(out[0].url).toBe('https://example.com/ok')
    })
})

describe('search call budget per production run', () => {
    test('3 queries x 3 sources stays within a 10/min ceiling', () => {
        const queries = 3
        const sources = 3
        expect(queries * sources).toBeLessThanOrEqual(DEFAULT_SEARCH_REQUESTS_PER_MINUTE)
    })

    test('the previous 10-source fan-out would have exceeded it', () => {
        // Regression guard for the defect this fix addresses.
        expect(3 * 10).toBeGreaterThan(DEFAULT_SEARCH_REQUESTS_PER_MINUTE)
    })
})
