/**
 * Relevance ordering and match presentation for the /jobs list.
 *
 * Pure and deterministic. This module does NOT compute match scores — it only
 * reads what M6 already wrote to job_matches. M6 is untouched.
 *
 * Explanations are surfaced verbatim from the stored match record
 * (matching_skills, positive_reasons, concerns). Nothing is inferred: a job
 * with no match record is reported as unmatched rather than given a guessed
 * score.
 */
import type { JobMatchRecord } from '@/lib/types/jobs'

/** The subset of a match record the list view needs. */
export type UserMatch = Pick<
    JobMatchRecord,
    | 'overall_score' | 'skills_score' | 'experience_score' | 'role_score'
    | 'location_score' | 'work_mode_score'
    | 'matching_skills' | 'missing_required_skills'
    | 'positive_reasons' | 'concerns' | 'recommendation'
> & { user_id?: string }

export interface RankableJob {
    id: string
    discovered_at?: string | null
    job_matches?: Array<Partial<UserMatch> & { user_id?: string }> | null
}

/**
 * Pull the CURRENT user's match from the embedded job_matches rows.
 *
 * job_matches is per-user and carries UNIQUE(user_id, job_id), so at most one
 * row can belong to the viewer. Returns null when the job has not been matched
 * for this user yet.
 */
export function extractUserMatch<T extends RankableJob>(
    job: T,
    userId: string | undefined
): UserMatch | null {
    if (!userId || !Array.isArray(job.job_matches)) return null

    const row = job.job_matches.find(m => m?.user_id === userId)
    if (!row || typeof row.overall_score !== 'number') return null

    return row as UserMatch
}

export type MatchTier = 'strong' | 'good' | 'possible' | 'weak'

export interface TierInfo {
    tier: MatchTier
    label: string
}

/**
 * Score band for display. Derived from the stored overall_score only — this is
 * presentation, not a second scoring model.
 */
export function matchTier(score: number): TierInfo {
    if (score >= 80) return { tier: 'strong', label: 'Strong match' }
    if (score >= 60) return { tier: 'good', label: 'Good match' }
    if (score >= 40) return { tier: 'possible', label: 'Possible match' }
    return { tier: 'weak', label: 'Weak match' }
}

/**
 * Reasons this job matched, taken verbatim from the stored match record.
 * Matching skills lead (most concrete), then M6's own positive_reasons.
 * Returns an empty array when the record explains nothing — never a fabricated
 * explanation.
 */
export function matchReasons(match: UserMatch | null, limit = 4): string[] {
    if (!match) return []

    const out: string[] = []
    for (const s of match.matching_skills ?? []) {
        if (typeof s === 'string' && s.trim()) out.push(s.trim())
        if (out.length >= limit) return out
    }
    for (const r of match.positive_reasons ?? []) {
        if (typeof r === 'string' && r.trim() && !out.includes(r.trim())) out.push(r.trim())
        if (out.length >= limit) break
    }
    return out.slice(0, limit)
}

export interface RankedJob<T> {
    job: T
    match: UserMatch | null
}

/**
 * Order jobs so the most relevant appear first.
 *
 *   1. jobs matched for this user, by overall_score descending
 *   2. jobs not yet matched, by discovered_at descending
 *
 * Matched jobs always precede unmatched ones, so a freshly discovered but
 * unscored job cannot displace a strong match. Ties fall back to
 * discovered_at, then id, so the order is stable across renders.
 */
export function rankJobsByRelevance<T extends RankableJob>(
    jobs: T[],
    userId: string | undefined
): Array<RankedJob<T>> {
    const decorated = jobs.map(job => ({ job, match: extractUserMatch(job, userId) }))

    const discoveredMs = (j: T): number => {
        const t = j.discovered_at ? new Date(j.discovered_at).getTime() : NaN
        return Number.isFinite(t) ? t : 0
    }

    return decorated.sort((a, b) => {
        const aScore = a.match?.overall_score
        const bScore = b.match?.overall_score
        const aHas = typeof aScore === 'number'
        const bHas = typeof bScore === 'number'

        // Matched jobs outrank unmatched ones.
        if (aHas !== bHas) return aHas ? -1 : 1

        if (aHas && bHas && aScore !== bScore) return bScore! - aScore!

        const byDate = discoveredMs(b.job) - discoveredMs(a.job)
        if (byDate !== 0) return byDate

        return a.job.id.localeCompare(b.job.id)
    })
}

/** Count of jobs with a match record for this user. */
export function countMatched<T extends RankableJob>(
    jobs: T[],
    userId: string | undefined
): number {
    return jobs.reduce((n, j) => n + (extractUserMatch(j, userId) ? 1 : 0), 0)
}
