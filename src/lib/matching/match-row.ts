import type { MatchResult } from './matching-engine';

/**
 * Shape of a `job_matches` row for a scored (user, job) pair.
 *
 * Lives outside the server-action file because a 'use server' module may only
 * export async functions, and both the interactive path (match-actions) and the
 * scheduled path need the identical row. Keeping one builder means the two can
 * never drift into writing different columns.
 *
 * `userId` is supplied by the caller and must always come from a verified
 * session (interactive) or from the eligibility query (scheduled) — never from
 * caller-controlled input.
 */
export function buildMatchRow(userId: string, jobId: string, matchResult: MatchResult) {
    return {
        user_id: userId,
        job_id: jobId,
        overall_score: matchResult.overall_score,
        skills_score: matchResult.skills_score,
        experience_score: matchResult.experience_score,
        role_score: matchResult.role_score,
        location_score: matchResult.location_score,
        work_mode_score: matchResult.work_mode_score,
        seniority_score: matchResult.seniority_score,
        emp_type_score: matchResult.emp_type_score,
        matching_skills: matchResult.matching_skills,
        missing_required_skills: matchResult.missing_required_skills,
        missing_preferred_skills: matchResult.missing_preferred_skills,
        positive_reasons: matchResult.positive_reasons,
        concerns: matchResult.concerns,
        recommendation: matchResult.recommendation,
        scored_at: new Date().toISOString(),
    };
}

/** Failure detail worth logging. Never includes payloads, tokens or keys. */
export function describeWriteError(error: { message?: string; code?: string } | null): string {
    if (!error) return 'no row returned';
    return error.code ? `${error.message} (code ${error.code})` : `${error.message}`;
}
