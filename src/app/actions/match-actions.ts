'use server'

import { createClient } from '@/utils/supabase/server';
import { DeterministicMatcher, CandidateState, MatchResult } from '@/lib/matching/matching-engine';
import { revalidatePath } from 'next/cache';
import { JobWithLocationsAndSkills } from '@/lib/types/jobs';
import { SupabaseClient } from '@supabase/supabase-js';

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

    // Persist result strictly tied to authData.user.id to pass RLS
    const { data: savedMatch, error } = await supabase
        .from('job_matches')
        .upsert({
            user_id: authData.user.id,
            job_id: job.id,
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
        }, { onConflict: 'user_id,job_id' })
        .select()
        .single();

    if (error || !savedMatch) {
        console.error('Failed to upsert job_match:', error);
        return { success: false, error: 'Failed to save match result' };
    }

    revalidatePath(`/jobs/${jobId}`);
    return { success: true, match: savedMatch };
}

export async function triggerProfileMatching() {
    // Process top recent jobs for the current user safely bounds memory
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return { success: false, error: 'Unauthorized' };

    const candidate = await getCandidateState(supabase, authData.user.id);
    if (!candidate) return { success: false, error: 'No profile to match' };

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
        return { success: true, message: 'No active jobs found to match against.' };
    }

    let successCount = 0;

    // Batch process to prevent memory lock
    for (const job of jobs) {
        const matchResult = DeterministicMatcher.match(candidate, job as JobWithLocationsAndSkills);

        const { error } = await supabase.from('job_matches').upsert({
            user_id: authData.user.id,
            job_id: job.id,
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
        }, { onConflict: 'user_id,job_id' });

        if (!error) successCount++;
    }

    revalidatePath('/jobs');
    return { success: true, processed: successCount, total: jobs.length };
}
