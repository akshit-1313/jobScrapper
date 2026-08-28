/**
 * @jest-environment node
 *
 * M2 — Firecrawl extraction, v2 API request shape.
 *
 * Regression cover for a live failure: every extraction returned
 *   "Unrecognized key in body -- please review the v2 API documentation"
 * because the adapter sent the v1 shape (formats: ['extract'] plus a sibling
 * `extract` object) to the v2 endpoint. @mendable/firecrawl-js v4 expects
 * formats: [{ type: 'json', prompt, schema }] and returns the result on `json`.
 *
 * The SDK is fully mocked — these tests make no network calls and spend zero
 * Firecrawl credits.
 */

const mockScrape = jest.fn()
const mockScrapeUrl = jest.fn()
const mockSearch = jest.fn()
const mockMapUrl = jest.fn()

jest.mock('@mendable/firecrawl-js', () => ({
    __esModule: true,
    default: class MockFirecrawl {
        scrape = mockScrape
        scrapeUrl = mockScrapeUrl
        search = mockSearch
        mapUrl = mockMapUrl
    },
}))

import { FirecrawlAdapter, hasUsableJobData } from '@/lib/jobs/adapters/firecrawl-adapter'

const GOOD_DOC = {
    json: {
        title: 'Salesforce Developer',
        company: 'Acme Corp',
        description: 'Build Apex and LWC solutions.',
        rawPayload: { location: 'Remote' },
    },
    metadata: { statusCode: 200, creditsUsed: 5 },
}

describe('M2 — extract() uses the v2 request shape', () => {
    let adapter: FirecrawlAdapter

    beforeEach(() => {
        jest.clearAllMocks()
        process.env.FIRECRAWL_API_KEY = 'fc-test-key-not-real'
        adapter = new FirecrawlAdapter()
    })

    test('calls scrape() — the v2 method — not the v1 scrapeUrl alias', async () => {
        mockScrape.mockResolvedValue(GOOD_DOC)
        await adapter.extract('https://jobs.example.com/1')

        expect(mockScrape).toHaveBeenCalledTimes(1)
        expect(mockScrapeUrl).not.toHaveBeenCalled()
    })

    test('sends formats: [{ type: "json", ... }]', async () => {
        mockScrape.mockResolvedValue(GOOD_DOC)
        await adapter.extract('https://jobs.example.com/1')

        const [url, options] = mockScrape.mock.calls[0]
        expect(url).toBe('https://jobs.example.com/1')
        expect(Array.isArray(options.formats)).toBe(true)
        expect(options.formats).toHaveLength(1)

        const fmt = options.formats[0]
        expect(typeof fmt).toBe('object')
        expect(fmt.type).toBe('json')
        expect(typeof fmt.prompt).toBe('string')
        expect(fmt.schema).toBeDefined()
        expect(fmt.schema.required).toEqual(['title', 'company', 'description'])
    })

    // ── The exact regression ────────────────────────────────────────────────

    test('REGRESSION: never sends the v1 shape that the v2 endpoint rejects', async () => {
        mockScrape.mockResolvedValue(GOOD_DOC)
        await adapter.extract('https://jobs.example.com/1')

        const options = mockScrape.mock.calls[0][1]

        // No sibling `extract` key — this is what produced
        // "Unrecognized key in body".
        expect(options).not.toHaveProperty('extract')

        // formats must not contain the bare 'extract' string.
        expect(options.formats).not.toContain('extract')
        for (const f of options.formats) {
            expect(f).not.toBe('extract')
        }
    })
})

describe('M2 — extract() response handling', () => {
    let adapter: FirecrawlAdapter

    beforeEach(() => {
        jest.clearAllMocks()
        process.env.FIRECRAWL_API_KEY = 'fc-test-key-not-real'
        adapter = new FirecrawlAdapter()
    })

    test('reads the structured result from `json` (v2 Document)', async () => {
        mockScrape.mockResolvedValue(GOOD_DOC)
        const res = await adapter.extract('https://jobs.example.com/1')

        expect(res.success).toBe(true)
        expect(res.data?.title).toBe('Salesforce Developer')
        expect(res.data?.company).toBe('Acme Corp')
        expect(res.data?.description).toBe('Build Apex and LWC solutions.')
        expect(res.data?.url).toBe('https://jobs.example.com/1')
        expect(res.data?.rawPayload).toEqual({ location: 'Remote' })
    })

    test('reads creditsUsed from metadata', async () => {
        mockScrape.mockResolvedValue(GOOD_DOC)
        const res = await adapter.extract('https://jobs.example.com/1')
        expect(res.creditsUsed).toBe(5)
    })

    test('produces a stable content hash for identical payloads', async () => {
        mockScrape.mockResolvedValue(GOOD_DOC)
        const a = await adapter.extract('https://jobs.example.com/1')
        const b = await adapter.extract('https://jobs.example.com/1')
        expect(a.data?.contentHash).toBe(b.data?.contentHash)
        expect(a.data?.contentHash).toMatch(/^[0-9a-f]{64}$/)
    })

    test('content hash changes when the payload changes', async () => {
        mockScrape.mockResolvedValue(GOOD_DOC)
        const a = await adapter.extract('https://jobs.example.com/1')

        mockScrape.mockResolvedValue({
            ...GOOD_DOC,
            json: { ...GOOD_DOC.json, description: 'Different description.' },
        })
        const b = await adapter.extract('https://jobs.example.com/1')

        expect(a.data?.contentHash).not.toBe(b.data?.contentHash)
    })

    test('still parses a v1-shaped response defensively (extract / data)', async () => {
        mockScrape.mockResolvedValue({ extract: GOOD_DOC.json, metadata: { creditsUsed: 2 } })
        const viaExtract = await adapter.extract('https://jobs.example.com/1')
        expect(viaExtract.success).toBe(true)
        expect(viaExtract.data?.title).toBe('Salesforce Developer')

        mockScrape.mockResolvedValue({ data: GOOD_DOC.json })
        const viaData = await adapter.extract('https://jobs.example.com/1')
        expect(viaData.success).toBe(true)
        expect(viaData.data?.company).toBe('Acme Corp')
    })

    test('honours a v1-style error envelope', async () => {
        mockScrape.mockResolvedValue({ success: false, error: 'quota exceeded' })
        const res = await adapter.extract('https://jobs.example.com/1')
        expect(res.success).toBe(false)
        expect(res.error).toBe('quota exceeded')
    })

    test('a thrown SDK error becomes a clean failure, not an exception', async () => {
        mockScrape.mockRejectedValue(new Error('Unrecognized key in body'))
        const res = await adapter.extract('https://jobs.example.com/1')
        expect(res.success).toBe(false)
        expect(res.error).toContain('Adapter Exception')
        expect(res.error).toContain('Unrecognized key in body')
    })

    test('an entirely empty extraction is REJECTED, not defaulted', async () => {
        // Previously this produced "Unknown Title @ Unknown Company" and was
        // persisted as a real job. It must now fail cleanly instead.
        mockScrape.mockResolvedValue({ json: {} })
        const res = await adapter.extract('https://jobs.example.com/1')
        expect(res.success).toBe(false)
        expect(res.data).toBeUndefined()
        expect(res.error).toContain('no job data found')
    })

    test('partial job data is still accepted and defaults fill the gaps', async () => {
        mockScrape.mockResolvedValue({ json: { title: 'Salesforce Developer' } })
        const res = await adapter.extract('https://jobs.example.com/1')
        expect(res.success).toBe(true)
        expect(res.data?.title).toBe('Salesforce Developer')
        expect(res.data?.company).toBe('Unknown Company')
        expect(res.data?.description).toBe('')
        expect(res.data?.rawPayload).toEqual({})
    })

    test('normalizes a non-object rawPayload to {}', async () => {
        mockScrape.mockResolvedValue({
            json: { title: 'T', company: 'C', description: 'D', rawPayload: 'not-an-object' },
        })
        const res = await adapter.extract('https://jobs.example.com/1')
        expect(res.data?.rawPayload).toEqual({})

        mockScrape.mockResolvedValue({
            json: { title: 'T', company: 'C', description: 'D', rawPayload: ['a'] },
        })
        const arr = await adapter.extract('https://jobs.example.com/1')
        expect(arr.data?.rawPayload).toEqual({})
    })

    test('a document with no structured result is rejected', async () => {
        mockScrape.mockResolvedValue({ markdown: '# Some page', metadata: {} })
        const res = await adapter.extract('https://jobs.example.com/1')
        expect(res.success).toBe(false)
        expect(res.error).toContain('no job data found')
    })

    test('leaves creditsUsed undefined when metadata omits it', async () => {
        mockScrape.mockResolvedValue({ json: GOOD_DOC.json })
        const res = await adapter.extract('https://jobs.example.com/1')
        expect(res.creditsUsed).toBeUndefined()
    })
})

/**
 * Junk-extraction validation gate.
 *
 * Live run evidence: 5/5 URLs extracted successfully, but 2 were aggregator /
 * listing pages that yielded empty title, company AND description. Those were
 * defaulted to "Unknown Title @ Unknown Company" and persisted as real jobs,
 * both carrying the same empty-content hash.
 */
describe('M2 — junk extraction is rejected before a job row can be created', () => {
    let adapter: FirecrawlAdapter

    beforeEach(() => {
        jest.clearAllMocks()
        process.env.FIRECRAWL_API_KEY = 'fc-test-key-not-real'
        adapter = new FirecrawlAdapter()
    })

    // ── The unit rule ───────────────────────────────────────────────────────

    test('hasUsableJobData: rejects only when title, company AND description are all blank', () => {
        expect(hasUsableJobData({ title: '', company: '', description: '' })).toBe(false)
        expect(hasUsableJobData({})).toBe(false)
        expect(hasUsableJobData({ title: '   ', company: '\t', description: '\n  ' })).toBe(false)
        expect(hasUsableJobData({ title: undefined, company: null, description: 0 })).toBe(false)

        expect(hasUsableJobData({ title: 'Developer', company: '', description: '' })).toBe(true)
        expect(hasUsableJobData({ title: '', company: 'Acme', description: '' })).toBe(true)
        expect(hasUsableJobData({ title: '', company: '', description: 'We are hiring.' })).toBe(true)
    })

    // ── End-to-end through extract() ────────────────────────────────────────

    test('empty title + empty company + empty description → rejected', async () => {
        mockScrape.mockResolvedValue({
            json: { title: '', company: '', description: '', rawPayload: {} },
            metadata: { creditsUsed: 5 },
        })
        const res = await adapter.extract('https://remoteok.com/hire-remotely/listing')
        expect(res.success).toBe(false)
        expect(res.data).toBeUndefined()
        expect(res.error).toContain('no job data found')
    })

    test('whitespace-only values → rejected', async () => {
        mockScrape.mockResolvedValue({
            json: { title: '   ', company: '\t\t', description: '\n   \n' },
        })
        const res = await adapter.extract('https://jobs.lever.co/aggregator/x')
        expect(res.success).toBe(false)
        expect(res.error).toContain('no job data found')
    })

    test('NEVER emits Unknown Title / Unknown Company for an entirely empty extraction', async () => {
        mockScrape.mockResolvedValue({ json: { title: '', company: '', description: '' } })
        const res = await adapter.extract('https://jobs.example.com/junk')

        expect(res.success).toBe(false)
        const serialized = JSON.stringify(res)
        expect(serialized).not.toContain('Unknown Title')
        expect(serialized).not.toContain('Unknown Company')
    })

    test('a fully valid job is still accepted', async () => {
        mockScrape.mockResolvedValue({
            json: {
                title: 'Senior Salesforce Developer',
                company: 'SBG Funding',
                description: 'Own Apex and LWC delivery.',
                rawPayload: { location: 'Remote' },
            },
            metadata: { creditsUsed: 5 },
        })
        const res = await adapter.extract('https://jobs.lever.co/sbg-funding/abc')
        expect(res.success).toBe(true)
        expect(res.data?.title).toBe('Senior Salesforce Developer')
        expect(res.data?.company).toBe('SBG Funding')
        expect(res.creditsUsed).toBe(5)
    })

    test('partial postings remain compatible with the normalizer', async () => {
        // Title only
        mockScrape.mockResolvedValue({ json: { title: 'Salesforce Engineer' } })
        const titleOnly = await adapter.extract('https://jobs.lever.co/a/1')
        expect(titleOnly.success).toBe(true)
        expect(titleOnly.data?.title).toBe('Salesforce Engineer')

        // Description only — still a real posting
        mockScrape.mockResolvedValue({ json: { description: 'We are hiring a Salesforce developer.' } })
        const descOnly = await adapter.extract('https://jobs.lever.co/a/2')
        expect(descOnly.success).toBe(true)
        expect(descOnly.data?.description).toBe('We are hiring a Salesforce developer.')

        // Company only
        mockScrape.mockResolvedValue({ json: { company: 'CI&T' } })
        const coOnly = await adapter.extract('https://jobs.lever.co/a/3')
        expect(coOnly.success).toBe(true)
        expect(coOnly.data?.company).toBe('CI&T')
    })

    test('rejection still reports creditsUsed so accounting stays accurate', async () => {
        mockScrape.mockResolvedValue({
            json: { title: '', company: '', description: '' },
            metadata: { creditsUsed: 5 },
        })
        const res = await adapter.extract('https://jobs.example.com/junk')
        expect(res.success).toBe(false)
        expect(res.creditsUsed).toBe(5)
    })

    test('rejected extractions produce no contentHash to collide on', async () => {
        mockScrape.mockResolvedValue({ json: { title: '', company: '', description: '' } })
        const a = await adapter.extract('https://jobs.example.com/junk-1')
        mockScrape.mockResolvedValue({ json: { title: '  ', company: '', description: '' } })
        const b = await adapter.extract('https://jobs.example.com/junk-2')

        // Previously both produced the SAME empty-content hash and two job rows.
        expect(a.data).toBeUndefined()
        expect(b.data).toBeUndefined()
    })
})
