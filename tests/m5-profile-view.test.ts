/**
 * @jest-environment node
 *
 * Profile presentation helpers backing the structured-profile UI.
 *
 * Pure grouping/formatting — no network, no LLM, no Firecrawl. The key
 * guarantee under test is that the view never invents, drops or reassigns
 * profile data.
 */
import {
    groupSkillsByCategory,
    formatMonthYear,
    formatPeriod,
    formatDuration,
    SKILL_CATEGORY_ORDER,
    SKILL_CATEGORY_LABELS,
    type ViewSkill,
} from '@/lib/profile/profile-view'

const SKILLS: ViewSkill[] = [
    { skill_name: 'Apex', category: 'language', is_primary: true },
    { skill_name: 'JavaScript', category: 'language' },
    { skill_name: 'Visualforce Pages', category: 'framework' },
    { skill_name: 'Sales Cloud', category: 'cloud' },
    { skill_name: 'FTP', category: 'tool' },
    { skill_name: 'REST API Integrations', category: 'domain' },
]

describe('profile view — skill grouping', () => {
    test('groups skills by category', () => {
        const groups = groupSkillsByCategory(SKILLS)
        const byCat = Object.fromEntries(groups.map(g => [g.category, g.skills.map(s => s.skill_name)]))

        expect(byCat.language).toEqual(['Apex', 'JavaScript'])
        expect(byCat.framework).toEqual(['Visualforce Pages'])
        expect(byCat.cloud).toEqual(['Sales Cloud'])
        expect(byCat.tool).toEqual(['FTP'])
        expect(byCat.domain).toEqual(['REST API Integrations'])
    })

    test('emits groups in the declared display order', () => {
        const groups = groupSkillsByCategory(SKILLS)
        const order = groups.map(g => g.category)
        const expected = SKILL_CATEGORY_ORDER.filter(c => order.includes(c))
        expect(order).toEqual(expected)
    })

    test('omits empty categories', () => {
        const groups = groupSkillsByCategory([{ skill_name: 'Apex', category: 'language' }])
        expect(groups).toHaveLength(1)
        expect(groups[0].category).toBe('language')
    })

    test('every group carries a human label', () => {
        for (const g of groupSkillsByCategory(SKILLS)) {
            expect(g.label).toBe(SKILL_CATEGORY_LABELS[g.category])
            expect(g.label.length).toBeGreaterThan(0)
        }
    })

    test('loses no skill — grouping is a partition', () => {
        const groups = groupSkillsByCategory(SKILLS)
        const total = groups.reduce((n, g) => n + g.skills.length, 0)
        expect(total).toBe(SKILLS.length)
    })

    test('uncategorized skills are surfaced, never dropped or guessed', () => {
        const groups = groupSkillsByCategory([
            { skill_name: 'Apex', category: 'language' },
            { skill_name: 'Mystery Skill', category: null },
            { skill_name: 'Another', category: undefined },
            { skill_name: 'Bogus', category: 'not-a-real-category' },
        ])
        const uncat = groups.find(g => g.category === 'uncategorized')
        expect(uncat).toBeDefined()
        expect(uncat!.skills.map(s => s.skill_name)).toEqual(['Mystery Skill', 'Another', 'Bogus'])
    })

    test('skips blank skill names', () => {
        const groups = groupSkillsByCategory([
            { skill_name: '', category: 'language' },
            { skill_name: '   ', category: 'language' },
            { skill_name: 'Apex', category: 'language' },
        ])
        expect(groups).toHaveLength(1)
        expect(groups[0].skills).toHaveLength(1)
    })

    test('handles an empty profile', () => {
        expect(groupSkillsByCategory([])).toEqual([])
    })
})

describe('profile view — date formatting', () => {
    test('formats an ISO date as month + year', () => {
        expect(formatMonthYear('2025-01-01')).toBe('Jan 2025')
        expect(formatMonthYear('2021-12-15')).toBe('Dec 2021')
    })

    test('returns null for absent or unparseable input rather than guessing', () => {
        expect(formatMonthYear(null)).toBeNull()
        expect(formatMonthYear(undefined)).toBeNull()
        expect(formatMonthYear('')).toBeNull()
        expect(formatMonthYear('not-a-date')).toBeNull()
        expect(formatMonthYear('2025-13-01')).toBeNull()
    })

    test('formats a closed period', () => {
        expect(formatPeriod('2019-03-01', '2021-12-01', false)).toBe('Mar 2019 – Dec 2021')
    })

    test('shows Present only when explicitly current', () => {
        expect(formatPeriod('2025-01-01', null, true)).toBe('Jan 2025 – Present')
        // A missing end date is NOT assumed to mean current.
        expect(formatPeriod('2025-01-01', null, false)).toBe('Jan 2025')
    })

    test('degrades gracefully when dates are missing', () => {
        expect(formatPeriod(null, null, false)).toBe('Dates not specified')
        expect(formatPeriod(null, '2021-12-01', false)).toBe('Dec 2021')
    })
})

describe('profile view — duration formatting', () => {
    test('formats years and months', () => {
        expect(formatDuration(33)).toBe('2 yrs 9 mos')
        expect(formatDuration(12)).toBe('1 yr')
        expect(formatDuration(1)).toBe('1 mo')
        expect(formatDuration(9)).toBe('9 mos')
    })

    test('handles zero and unknown', () => {
        expect(formatDuration(0)).toBe('Less than a month')
        expect(formatDuration(null)).toBeNull()
        expect(formatDuration(undefined)).toBeNull()
        expect(formatDuration(-5)).toBeNull()
        expect(formatDuration(NaN)).toBeNull()
    })
})
