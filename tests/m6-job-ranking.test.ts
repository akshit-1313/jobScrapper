/**
 * @jest-environment node
 *
 * /jobs relevance ordering and match presentation.
 *
 * This module READS job_matches — it never computes or adjusts a score, so M6
 * remains untouched. Tests assert ordering, per-user isolation, and that no
 * explanation is fabricated for an unmatched job.
 */
import {
    rankJobsByRelevance,
    extractUserMatch,
    countMatched,
    matchTier,
    matchReasons,
    type RankableJob,
} from '@/lib/jobs/job-ranking'

const ME = 'user-me'
const OTHER = 'user-other'

const match = (user_id: string, overall_score: number, extra: Record<string, unknown> = {}) => ({
    user_id, overall_score, ...extra,
})

const job = (id: string, discovered_at: string | null, matches: Array<Record<string, unknown>> = []): RankableJob => ({
    id, discovered_at, job_matches: matches as never,
})

describe('/jobs — extracting the current user\'s match', () => {
    test('returns the match belonging to the viewer', () => {
        const j = job('a', '2026-01-01', [match(ME, 82)])
        expect(extractUserMatch(j, ME)?.overall_score).toBe(82)
    })

    test('ignores another user\'s match — no score leaks across users', () => {
        const j = job('a', '2026-01-01', [match(OTHER, 95)])
        expect(extractUserMatch(j, ME)).toBeNull()
    })

    test('picks the viewer\'s row when several are embedded', () => {
        const j = job('a', '2026-01-01', [match(OTHER, 95), match(ME, 40)])
        expect(extractUserMatch(j, ME)?.overall_score).toBe(40)
    })

    test('returns null for an unmatched job rather than inventing a score', () => {
        expect(extractUserMatch(job('a', '2026-01-01', []), ME)).toBeNull()
        expect(extractUserMatch(job('a', '2026-01-01'), ME)).toBeNull()
        expect(extractUserMatch(job('a', '2026-01-01', [match(ME, 50)]), undefined)).toBeNull()
    })

    test('ignores a row with a non-numeric score', () => {
        const j = job('a', '2026-01-01', [{ user_id: ME, overall_score: null }])
        expect(extractUserMatch(j, ME)).toBeNull()
    })
})

describe('/jobs — relevance ordering', () => {
    test('highest-scoring matched jobs come first', () => {
        const jobs = [
            job('low', '2026-01-03', [match(ME, 30)]),
            job('high', '2026-01-01', [match(ME, 90)]),
            job('mid', '2026-01-02', [match(ME, 60)]),
        ]
        expect(rankJobsByRelevance(jobs, ME).map(r => r.job.id)).toEqual(['high', 'mid', 'low'])
    })

    test('score beats recency — a newer unscored-lower job does not jump ahead', () => {
        const jobs = [
            job('newer-but-weak', '2026-06-01', [match(ME, 20)]),
            job('older-but-strong', '2020-01-01', [match(ME, 95)]),
        ]
        expect(rankJobsByRelevance(jobs, ME)[0].job.id).toBe('older-but-strong')
    })

    test('matched jobs always precede unmatched ones', () => {
        const jobs = [
            job('unmatched-new', '2026-12-01', []),
            job('matched-old', '2020-01-01', [match(ME, 10)]),
        ]
        expect(rankJobsByRelevance(jobs, ME).map(r => r.job.id))
            .toEqual(['matched-old', 'unmatched-new'])
    })

    test('unmatched jobs fall back to newest-first', () => {
        const jobs = [
            job('old', '2020-01-01', []),
            job('new', '2026-01-01', []),
            job('mid', '2023-01-01', []),
        ]
        expect(rankJobsByRelevance(jobs, ME).map(r => r.job.id)).toEqual(['new', 'mid', 'old'])
    })

    test('another user\'s scores do not affect the viewer\'s ordering', () => {
        const jobs = [
            job('theirs-high', '2020-01-01', [match(OTHER, 99)]),
            job('mine-low', '2020-01-02', [match(ME, 15)]),
        ]
        expect(rankJobsByRelevance(jobs, ME).map(r => r.job.id))
            .toEqual(['mine-low', 'theirs-high'])
    })

    test('ordering is stable and deterministic on ties', () => {
        const jobs = [
            job('b', '2026-01-01', [match(ME, 50)]),
            job('a', '2026-01-01', [match(ME, 50)]),
        ]
        const once = rankJobsByRelevance(jobs, ME).map(r => r.job.id)
        const twice = rankJobsByRelevance([...jobs].reverse(), ME).map(r => r.job.id)
        expect(once).toEqual(['a', 'b'])
        expect(twice).toEqual(once)
    })

    test('handles missing/invalid discovered_at without throwing', () => {
        const jobs = [job('x', null, []), job('y', 'not-a-date', []), job('z', '2026-01-01', [])]
        expect(rankJobsByRelevance(jobs, ME).map(r => r.job.id)).toEqual(['z', 'x', 'y'])
    })

    test('handles an empty list', () => {
        expect(rankJobsByRelevance([], ME)).toEqual([])
    })

    test('attaches the resolved match alongside each job', () => {
        const jobs = [job('a', '2026-01-01', [match(ME, 77)]), job('b', '2026-01-02', [])]
        const ranked = rankJobsByRelevance(jobs, ME)
        expect(ranked[0].match?.overall_score).toBe(77)
        expect(ranked[1].match).toBeNull()
    })

    test('counts matched jobs for the viewer only', () => {
        const jobs = [
            job('a', '2026-01-01', [match(ME, 50)]),
            job('b', '2026-01-02', [match(OTHER, 90)]),
            job('c', '2026-01-03', []),
        ]
        expect(countMatched(jobs, ME)).toBe(1)
        expect(countMatched(jobs, undefined)).toBe(0)
    })
})

describe('/jobs — match presentation', () => {
    test('bands the score for display', () => {
        expect(matchTier(95).tier).toBe('strong')
        expect(matchTier(80).tier).toBe('strong')
        expect(matchTier(70).tier).toBe('good')
        expect(matchTier(60).tier).toBe('good')
        expect(matchTier(45).tier).toBe('possible')
        expect(matchTier(40).tier).toBe('possible')
        expect(matchTier(10).tier).toBe('weak')
        expect(matchTier(0).tier).toBe('weak')
    })

    test('every tier has a human label', () => {
        for (const s of [0, 40, 60, 80, 100]) {
            expect(matchTier(s).label.length).toBeGreaterThan(0)
        }
    })

    test('reasons come verbatim from the stored match record', () => {
        const reasons = matchReasons({
            overall_score: 80,
            matching_skills: ['Apex', 'LWC'],
            positive_reasons: ['Exact role match: Salesforce Developer.'],
        } as never)
        expect(reasons).toContain('Apex')
        expect(reasons).toContain('LWC')
        expect(reasons).toContain('Exact role match: Salesforce Developer.')
    })

    test('matching skills lead, then M6 reasons', () => {
        const reasons = matchReasons({
            overall_score: 80,
            matching_skills: ['Apex'],
            positive_reasons: ['Role match'],
        } as never, 2)
        expect(reasons[0]).toBe('Apex')
        expect(reasons[1]).toBe('Role match')
    })

    test('respects the limit', () => {
        const reasons = matchReasons({
            overall_score: 80,
            matching_skills: ['a', 'b', 'c', 'd', 'e', 'f'],
        } as never, 3)
        expect(reasons).toHaveLength(3)
    })

    test('NEVER fabricates an explanation for an unmatched job', () => {
        expect(matchReasons(null)).toEqual([])
    })

    test('returns nothing when the record explains nothing', () => {
        expect(matchReasons({ overall_score: 50 } as never)).toEqual([])
        expect(matchReasons({ overall_score: 50, matching_skills: [], positive_reasons: [] } as never)).toEqual([])
    })

    test('skips blank and duplicate entries', () => {
        const reasons = matchReasons({
            overall_score: 50,
            matching_skills: ['Apex', '  ', ''],
            positive_reasons: ['Apex'],
        } as never)
        expect(reasons).toEqual(['Apex'])
    })
})
