'use server'

import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { DeterministicMatcher, CandidateState, MatchResult } from '@/lib/matching/matching-engine';
import { revalidatePath } from 'next/cache';
import { JobWithLocationsAndSkills } from '@/lib/types/jobs';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * job_matches is server-generated data. Migration 006 grants `authenticated`
 * SELECT only ("Users can view own matches"), with writes reserved for the
 * service role:
 *
 *   006_rls_policies.sql:6
 *   "Server-generated data (job_matches, search_runs, crawl_runs) →
 *    authenticated read-only; writes via service-role"
 *
 * Using the request-scoped client for the upsert therefore fails RLS silently,
 * which is why matches stopped persisting. Reads and authentication stay on the
 * authenticated client; ONLY the job_matches write uses the admin client.
 *
 * The RLS policies are unchanged — the ownership boundary is enforced in code
 * instead: user_id always comes from the verified session, never from an
 * argument or any other caller-controlled value.
 */
function buildMatchRow(userId: string, jobId: string, matchResult: MatchResult) {
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
        scored_at: new Date().toISOString()
    };
}

/** Failure detail worth logging. Never includes payloads, tokens or keys. */
function describeWriteError(error: { message?: string; code?: string } | null): string {
    if (!error) return 'no row returned';
    return error.code ? `${error.message} (code ${error.code})` : `${error.message}`;
}

async function getCandidateState(supabase: SupabaseClient, userId: string): Promise<CandidateState | null> {
    const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', userId).single();

    // We strictly wait on these deterministic loads to prove candidate integrity
    const [skillsRes, expRes, prefsRes] = await Promise.all([
        supabase.from('candidate_skills').select('*').eq('user_id', userId),
        supabase.from('candidate_experience').select('*').eq('user_id', userId),
        supabase.from('candidate_preferences').select('*').eq('user_id', userId).single()
    ]);

    if (!profile && !skillsRes.data?.length && !expRes.data?.length) {
        return null;
    }

    return {
        profile: profile || null,
        skills: skillsRes.data || [],
        experience: expRes.data || [],
        preferences: prefsRes.data || null
    };
}

async function getJobState(supabase: SupabaseClient, jobId: string): Promise<JobWithLocationsAndSkills | null> {
    const { data: job, error } = await supabase
        .from('jobs')
        .select(`
            *,
            job_locations (city, state, country, remote_region),
            job_skills (skill_name, is_required)
        `)
        .eq('id', jobId)
        .single();

    if (error || !job) return null;
    return job as JobWithLocationsAndSkills;
}

export async function triggerJobMatch(jobId: string) {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return { success: false, error: 'Unauthorized' };

    const candidate = await getCandidateState(supabase, authData.user.id);
    if (!candidate) return { success: false, error: 'No candidate profile found' };

    const job = await getJobState(supabase, jobId);
    if (!job) return { success: false, error: 'Job not found' };

    const matchResult = DeterministicMatcher.match(candidate, job);

    // Server-generated write: service role only. user_id is the verified session.
    const admin = createAdminClient();
    const { data: savedMatch, error } = await admin
        .from('job_matches')
        .upsert(buildMatchRow(authData.user.id, job.id, matchResult), { onConflict: 'user_id,job_id' })
        .select()
        .single();

    if (error || !savedMatch) {
        console.error(`[M6] job_matches upsert failed for job ${job.id}: ${describeWriteError(error)}`);
        return { success: false, persisted: 0, error: 'Failed to save match result' };
    }

    revalidatePath(`/jobs/${jobId}`);
    return { success: true, persisted: 1, match: savedMatch };
}

/**
 * Outcome of a profile-wide matching pass.
 *
 * `success` reports whether the matching OPERATION completed. `persisted` is the
 * only authoritative count of matches actually written — a caller must never
 * infer persistence from `success` alone. `processed` is retained as an alias of
 * `persisted` for existing callers.
 */
interface ProfileMatchingResult {
    success: boolean;
    persisted: number;
    failed: number;
    processed: number;
    total: number;
    error?: string;
    message?: string;
}

/** At most this many individual write failures are logged in detail per run. */
const MAX_LOGGED_WRITE_FAILURES = 5;

export async function triggerProfileMatching(): Promise<ProfileMatchingResult> {
    // Process top recent jobs for the current user safely bounds memory
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
        return { success: false, persisted: 0, failed: 0, processed: 0, total: 0, error: 'Unauthorized' };
    }

    const candidate = await getCandidateState(supabase, authData.user.id);
    if (!candidate) {
        return { success: false, persisted: 0, failed: 0, processed: 0, total: 0, error: 'No profile to match' };
    }

    // Fetch up to 50 active jobs to avoid overloading server memory
    const { data: jobs, error: jobsErr } = await supabase
        .from('jobs')
        .select(`
            *,
            job_locations (city, state, country, remote_region),
            job_skills (skill_name, is_required)
        `)
        .eq('status', 'active')
        .order('discovered_at', { ascending: false })
        .limit(50);

    if (jobsErr || !jobs?.length) {
        return {
            success: true, persisted: 0, failed: 0, processed: 0, total: 0,
            message: 'No active jobs found to match against.'
        };
    }

    // Server-generated write: service role only. Reads above stay authenticated.
    const admin = createAdminClient();

    let persisted = 0;
    let failed = 0;
    let firstError: string | null = null;

    // Batch process to prevent memory lock
    for (const job of jobs) {
        const matchResult = DeterministicMatcher.match(candidate, job as JobWithLocationsAndSkills);

        const { error } = await admin
            .from('job_matches')
            .upsert(buildMatchRow(authData.user.id, job.id, matchResult), { onConflict: 'user_id,job_id' });

        if (error) {
            failed++;
            if (!firstError) firstError = describeWriteError(error);
            // Bounded so one systemic failure cannot flood the log with 50 lines.
            if (failed <= MAX_LOGGED_WRITE_FAILURES) {
                console.error(`[M6] job_matches upsert failed for job ${job.id}: ${describeWriteError(error)}`);
            }
            continue;
        }

        persisted++;
    }

    if (failed > 0) {
        console.error(
            `[M6] Persisted ${persisted}/${jobs.length} matches; ${failed} write(s) failed. ` +
            `First error: ${firstError}`
        );
    }

    revalidatePath('/jobs');

    // Every write failing is not a successful matching pass, however cleanly the
    // loop ran. Callers must not be told matches were saved when none were.
    const nothingSaved = persisted === 0 && failed > 0;

    return {
        success: !nothingSaved,
        persisted,
        failed,
        processed: persisted,
        total: jobs.length,
        error: nothingSaved ? 'Matching ran but no results could be saved.' : undefined
    };
}
