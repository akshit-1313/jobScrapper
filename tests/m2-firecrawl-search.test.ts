/**
 * @jest-environment node
 *
 * Phase 3 — Firecrawl search adapter, allow-list enforcement.
 *
 * The Firecrawl SDK is fully mocked: these tests make no network calls and
 * spend ZERO credits.
 *
 * The M2.2 cross-domain boundary is the thing under test. Search must never
 * become a way to pull arbitrary web results into the job pipeline.
 */

const mockSearch = jest.fn()
const mockMapUrl = jest.fn()
const mockScrapeUrl = jest.fn()

jest.mock('@mendable/firecrawl-js', () => {
    return {
        __esModule: true,
        default: class MockFirecrawl {
            search = mockSearch
            mapUrl = mockMapUrl
            scrapeUrl = mockScrapeUrl
        },
    }
})

import { FirecrawlAdapter, __resetSearchRateGate } from '@/lib/jobs/adapters/firecrawl-adapter'

describe('Phase 3 — FirecrawlAdapter.searchJobs', () => {
    let adapter: FirecrawlAdapter
    const originalRpm = process.env.FIRECRAWL_SEARCH_RPM

    beforeEach(() => {
        jest.clearAllMocks()
        process.env.FIRECRAWL_API_KEY = 'fc-test-key-not-real'
        // searchJobs is now rate-gated. The real 10/min default spaces calls 6s
        // apart, which exceeds Jest's timeout. Throttle behaviour has its own
        // suite (m2-firecrawl-rate-limit); here we neutralise the delay so these
        // allow-list assertions stay fast and unchanged.
        process.env.FIRECRAWL_SEARCH_RPM = '60000'
        __resetSearchRateGate()
        adapter = new FirecrawlAdapter()
    })

    afterAll(() => {
        if (originalRpm === undefined) delete process.env.FIRECRAWL_SEARCH_RPM
        else process.env.FIRECRAWL_SEARCH_RPM = originalRpm
    })

    test('passes includeDomains to the provider so filtering happens server-side', async () => {
        mockSearch.mockResolvedValue({ web: [] })

        await adapter.searchJobs('"Salesforce Developer" Apex', {
            includeDomains: ['jobs.example.com'],
            limit: 5,
        })

        expect(mockSearch).toHaveBeenCalledTimes(1)
        const [query, req] = mockSearch.mock.calls[0]
        expect(query).toBe('"Salesforce Developer" Apex')
        expect(req.includeDomains).toEqual(['jobs.example.com'])
        expect(req.limit).toBe(5)
        expect(req.sources).toEqual(['web'])
    })

    test('returns allow-listed results', async () => {
        mockSearch.mockResolvedValue({
            web: [
                { url: 'https://jobs.example.com/a', title: 'A' },
                { url: 'https://jobs.example.com/b', title: 'B' },
            ],
        })

        const out = await adapter.searchJobs('q', { includeDomains: ['jobs.example.com'], limit: 5 })
        expect(out).toHaveLength(2)
        expect(out[0].sourceDomain).toBe('jobs.example.com')
    })

    test('accepts subdomains of an allowed host', async () => {
        mockSearch.mockResolvedValue({ web: [{ url: 'https://careers.example.com/x' }] })
        const out = await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 5 })
        expect(out).toHaveLength(1)
    })

    // ── The security boundary ───────────────────────────────────────────────

    test('REJECTS off-allow-list results even when the provider returns them', async () => {
        mockSearch.mockResolvedValue({
            web: [
                { url: 'https://jobs.example.com/ok' },
                { url: 'https://random-blog.net/spam' },
                { url: 'https://evil.com/phish' },
            ],
        })

        const out = await adapter.searchJobs('q', { includeDomains: ['jobs.example.com'], limit: 5 })
        expect(out).toHaveLength(1)
        expect(out[0].url).toBe('https://jobs.example.com/ok')
    })

    test('REJECTS look-alike domains (evil-example.com is not example.com)', async () => {
        mockSearch.mockResolvedValue({
            web: [
                { url: 'https://evil-example.com/x' },
                { url: 'https://exampleXcom.net/y' },
            ],
        })
        const out = await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 5 })
        expect(out).toEqual([])
    })

    test('REFUSES to search at all with an empty allow-list', async () => {
        const out = await adapter.searchJobs('q', { includeDomains: [], limit: 5 })
        expect(out).toEqual([])
        // Critically: no provider call, so no credits spent.
        expect(mockSearch).not.toHaveBeenCalled()
    })

    // ── Robustness ──────────────────────────────────────────────────────────

    test('caps the requested limit to bound credit spend', async () => {
        mockSearch.mockResolvedValue({ web: [] })
        await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 9999 })
        expect(mockSearch.mock.calls[0][1].limit).toBe(20)
    })

    test('de-duplicates repeated URLs', async () => {
        mockSearch.mockResolvedValue({
            web: [{ url: 'https://example.com/a' }, { url: 'https://example.com/a' }],
        })
        const out = await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 5 })
        expect(out).toHaveLength(1)
    })

    test('skips malformed URLs without throwing', async () => {
        mockSearch.mockResolvedValue({
            web: [{ url: 'not-a-url' }, { url: 'https://example.com/ok' }],
        })
        const out = await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 5 })
        expect(out).toHaveLength(1)
        expect(out[0].url).toBe('https://example.com/ok')
    })

    test('handles a provider error cleanly, returning no results', async () => {
        mockSearch.mockRejectedValue(new Error('rate limited'))
        const out = await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 5 })
        expect(out).toEqual([])
    })

    test('handles an unexpected response shape cleanly', async () => {
        mockSearch.mockResolvedValue(null)
        expect(await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 5 })).toEqual([])

        mockSearch.mockResolvedValue({ web: 'not-an-array' })
        expect(await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 5 })).toEqual([])
    })

    test('handles an empty result set', async () => {
        mockSearch.mockResolvedValue({ web: [] })
        expect(await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 5 })).toEqual([])
    })

    test('does not disturb the existing map/scrape discovery path', async () => {
        mockSearch.mockResolvedValue({ web: [] })
        await adapter.searchJobs('q', { includeDomains: ['example.com'], limit: 5 })
        expect(mockMapUrl).not.toHaveBeenCalled()
        expect(mockScrapeUrl).not.toHaveBeenCalled()
    })
})
