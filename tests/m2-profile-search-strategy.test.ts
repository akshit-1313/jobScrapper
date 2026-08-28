/**
 * @jest-environment node
 *
 * Phase 3 — profile → targeted search strategy.
 *
 * Deterministic: static vocabulary + set operations. No LLM, no network, no
 * API cost. These tests spend zero Firecrawl credits.
 */
import {
    buildSearchStrategies,
    deriveAlternativeTitles,
    rankSkills,
    deriveExperienceLevel,
    normalizeTitle,
    StrategyInput,
    resolveUrlBudget,
    PROFILE_SEARCH_DEFAULT_MAX_URLS_PER_RUN,
    PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN,
} from '@/lib/jobs/profile-search-strategy'

const BASE: StrategyInput = {
    profile: { headline: 'Salesforce Developer', years_of_experience: 4 },
    skills: [
        { skill_name: 'Apex', category: 'language', is_primary: true },
        { skill_name: 'Lightning Web Components', category: 'framework', is_primary: true },
        { skill_name: 'REST API Integrations', category: 'domain', is_primary: false },
        { skill_name: 'PostgreSQL', category: 'database', is_primary: false },
        { skill_name: 'FTP', category: 'tool', is_primary: false },
        { skill_name: 'CSV', category: 'tool', is_primary: false },
    ],
    experience: [{ title: 'Software Engineer', is_current: true }],
    engagements: [
        { technologies: ['Apex', 'FTP'], domains: ['integration'] },
        { technologies: ['Apex', 'CSV'], domains: ['integration'] },
    ],
    preferences: null,
}

describe('Phase 3 — title derivation', () => {
    test('normalizes titles', () => {
        expect(normalizeTitle('  Senior  Salesforce/Developer ')).toBe('senior salesforce developer')
    })

    test('expands role synonyms generically', () => {
        const alts = deriveAlternativeTitles('Salesforce Developer')
        expect(alts).toContain('salesforce developer')
        expect(alts).toContain('salesforce engineer')
        expect(alts).toContain('salesforce programmer')
    })

    test('maps a platform to its discipline', () => {
        expect(deriveAlternativeTitles('Salesforce Developer')).toContain('crm developer')
        expect(deriveAlternativeTitles('SAP Analyst')).toContain('erp analyst')
        expect(deriveAlternativeTitles('Workday Consultant')).toContain('hcm consultant')
    })

    test('drops seniority to broaden reach', () => {
        expect(deriveAlternativeTitles('Senior Backend Engineer')).toContain('backend engineer')
    })

    test('is generic — an unrelated title still expands', () => {
        const alts = deriveAlternativeTitles('Data Engineer')
        expect(alts).toContain('data developer')
        expect(alts).toContain('data programmer')
    })

    test('returns nothing for empty input', () => {
        expect(deriveAlternativeTitles('')).toEqual([])
    })
})

describe('Phase 3 — skill ranking', () => {
    test('primary skills and recurring engagement technologies rank highest', () => {
        const { core } = rankSkills(BASE.skills, BASE.engagements)
        expect(core[0]).toBe('Apex') // primary AND in two engagements
        expect(core).toContain('Lightning Web Components')
    })

    test('domain skills are separated from capability skills', () => {
        const { domains, core } = rankSkills(BASE.skills, BASE.engagements)
        expect(domains).toContain('REST API Integrations')
        expect(core).not.toContain('REST API Integrations')
    })

    test('engagement domains contribute business context', () => {
        const { domains } = rankSkills(BASE.skills, BASE.engagements)
        expect(domains.map(d => d.toLowerCase())).toContain('integration')
    })

    test('handles an empty profile without throwing', () => {
        expect(rankSkills([], [])).toEqual({ core: [], secondary: [], domains: [] })
    })
})

describe('Phase 3 — experience level', () => {
    test('maps years to a level', () => {
        expect(deriveExperienceLevel(0)).toBe('entry level')
        expect(deriveExperienceLevel(2)).toBe('junior')
        expect(deriveExperienceLevel(4)).toBe('mid level')
        expect(deriveExperienceLevel(7)).toBe('senior')
        expect(deriveExperienceLevel(12)).toBe('lead')
    })

    test('returns null when unknown rather than guessing', () => {
        expect(deriveExperienceLevel(null)).toBeNull()
        expect(deriveExperienceLevel(undefined)).toBeNull()
    })
})

describe('Phase 3 — strategy construction', () => {
    const strategies = buildSearchStrategies(BASE, { maxQueries: 3 })

    test('produces multiple distinct targeted queries', () => {
        expect(strategies.length).toBe(3)
        expect(new Set(strategies.map(s => s.query)).size).toBe(3)
    })

    test('each query targets one title with a focused skill cluster', () => {
        for (const s of strategies) {
            expect(s.title.length).toBeGreaterThan(0)
            expect(s.skills.length).toBeGreaterThan(0)
            expect(s.skills.length).toBeLessThanOrEqual(3)
            expect(s.query).toContain(`"${s.title}"`)
        }
    })

    test('does NOT concatenate the whole profile into one query', () => {
        for (const s of strategies) {
            // A resume-dump query would name most skills at once.
            expect(s.skills.length).toBeLessThan(BASE.skills.length)
            expect(s.query.length).toBeLessThan(200)
        }
    })

    test('explores related titles, not just the headline', () => {
        const titles = strategies.map(s => s.title.toLowerCase())
        expect(titles.some(t => t.includes('salesforce'))).toBe(true)
        expect(new Set(titles).size).toBeGreaterThan(1)
    })

    test('respects the query cap, bounding credit spend', () => {
        expect(buildSearchStrategies(BASE, { maxQueries: 1 })).toHaveLength(1)
        expect(buildSearchStrategies(BASE, { maxQueries: 2 })).toHaveLength(2)
    })

    test('every skill in a query comes from the profile', () => {
        const owned = new Set(BASE.skills.map(s => s.skill_name.toLowerCase()))
        for (const s of strategies) {
            for (const sk of s.skills) expect(owned.has(sk.toLowerCase())).toBe(true)
        }
    })

    test('honours excluded roles', () => {
        const out = buildSearchStrategies(
            { ...BASE, preferences: { excluded_roles: ['salesforce developer'] } },
            { maxQueries: 5 }
        )
        expect(out.every(s => s.title.toLowerCase() !== 'salesforce developer')).toBe(true)
    })

    test('includes preference desired_roles as targets', () => {
        const out = buildSearchStrategies(
            { ...BASE, preferences: { desired_roles: ['Integration Architect'] } },
            { maxQueries: 5 }
        )
        expect(out.some(s => s.title.toLowerCase().includes('integration architect'))).toBe(true)
    })

    test('returns no strategies when there is no profile signal', () => {
        expect(buildSearchStrategies(
            { profile: null, skills: [], experience: [], engagements: [], preferences: null }
        )).toEqual([])
    })

    test('builds a title-only query when the profile has no skills', () => {
        const out = buildSearchStrategies({
            profile: { headline: 'Product Manager' },
            skills: [], experience: [], engagements: [], preferences: null,
        }, { maxQueries: 1 })
        expect(out).toHaveLength(1)
        expect(out[0].skills).toEqual([])
        expect(out[0].query).toBe('"Product Manager"')
    })
})

/**
 * Run-wide URL budget.
 *
 * Set to 4 from three live measurements (credits ≈ 4 + 5 × URLs). Extraction is
 * the expensive operation, so this ceiling is what actually bounds spend — the
 * per-query limit does not, because queries multiply across sources.
 */
describe('Phase 3 — run-wide URL budget (hard limit 4)', () => {
    test('the configured default is 4', () => {
        expect(PROFILE_SEARCH_DEFAULT_MAX_URLS_PER_RUN).toBe(4)
    })

    test('the hard ceiling is 4', () => {
        expect(PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN).toBe(4)
    })

    test('defaults to 4 when nothing is requested', () => {
        expect(resolveUrlBudget()).toBe(4)
        expect(resolveUrlBudget(undefined)).toBe(4)
        expect(resolveUrlBudget(null)).toBe(4)
    })

    // ── The hard limit ──────────────────────────────────────────────────────

    test('NEVER exceeds 4, however large the request', () => {
        expect(resolveUrlBudget(5)).toBe(4)
        expect(resolveUrlBudget(20)).toBe(4)
        expect(resolveUrlBudget(100)).toBe(4)
        expect(resolveUrlBudget(Number.MAX_SAFE_INTEGER)).toBe(4)
        expect(resolveUrlBudget(Infinity)).toBe(4)
    })

    test('a caller may request FEWER URLs', () => {
        expect(resolveUrlBudget(1)).toBe(1)
        expect(resolveUrlBudget(2)).toBe(2)
        expect(resolveUrlBudget(3)).toBe(3)
        expect(resolveUrlBudget(4)).toBe(4)
    })

    test('never returns less than 1', () => {
        expect(resolveUrlBudget(0)).toBe(1)
        expect(resolveUrlBudget(-1)).toBe(1)
        expect(resolveUrlBudget(-999)).toBe(1)
    })

    test('fractional requests floor — never round up into extra spend', () => {
        expect(resolveUrlBudget(3.9)).toBe(3)
        expect(resolveUrlBudget(4.9)).toBe(4)
        expect(resolveUrlBudget(0.5)).toBe(1)
    })

    test('non-finite input falls back to the default rather than throwing', () => {
        expect(resolveUrlBudget(NaN)).toBe(4)
    })

    test('the resolved budget is always within [1, 4]', () => {
        for (const n of [-10, 0, 1, 2, 3, 4, 5, 7, 50, 1000]) {
            const b = resolveUrlBudget(n)
            expect(b).toBeGreaterThanOrEqual(1)
            expect(b).toBeLessThanOrEqual(PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN)
        }
    })

    test('query count is unchanged — the budget fix must not broaden the search', () => {
        // Guards requirement: do not increase the number of search strategies.
        const out = buildSearchStrategies(BASE, { maxQueries: 3 })
        expect(out.length).toBe(3)
    })
})
