import { createAdminClient } from '@/lib/supabase/admin';
import { runProfileTargetedDiscovery } from './discovery-service';
import { ExecutionBudget } from './discovery-lock';
import { DeterministicMatcher, CandidateState } from '@/lib/matching/matching-engine';
import { buildMatchRow, describeWriteError } from '@/lib/matching/match-row';
import type { JobWithLocationsAndSkills } from '@/lib/types/jobs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordRunUsage } from '@/lib/firecrawl/run-accounting';
import { refreshUsageSnapshot } from '@/lib/firecrawl/usage-service';

/**
 * Scheduled daily discovery.
 *
 * Runs the SAME profile-targeted flow as the manual "Find matching jobs"
 * button — `runProfileTargetedDiscovery` is called unmodified, so every
 * validated control applies here automatically: the m8_cron_runs mutex, stale
 * lock recovery, the Firecrawl rate gate and its 6s spacing, the 3-source cap,
 * deterministic source rotation, the 4-URL extraction cap, the 55s execution
 * budget and the 45s extraction reservation.
 *
 * This module adds only what a scheduled run needs on top of that:
 *   - eligibility (explicit per-user opt-in, one user per invocation)
 *   - fair rotation between opted-in users
 *   - usage accounting written immediately after discovery
 *   - matching, which the interactive path gets from a server action that
 *     requires a session the cron does not have
 *
 * M8's executeBackgroundDiscovery is NOT used and remains dormant.
 */

/**
 * Whole-invocation budget, under Vercel Hobby's 60s hard kill.
 *
 * Discovery polices itself with its own 55s budget; this outer clock exists so
 * the work that happens AFTER discovery returns cannot push the function past
 * the ceiling.
 */
export const SCHEDULED_INVOCATION_BUDGET_SECONDS = 57;

/** Reserved before starting the matching pass. Skipped if it will not fit. */
export const SCHEDULED_MATCH_RESERVATION_MS = 3_000;

/** Upper bound on match writes per invocation. Keeps the tail predictable. */
export const SCHEDULED_MATCH_LIMIT = 10;

/** Candidate jobs considered when looking for unscored ones. */
const SCHEDULED_MATCH_SCAN_LIMIT = 50;

/**
 * What a scheduled run may actually plan.
 *
 * The manual path plans 3 strategies × 3 sources = 9 searches. A scheduled run
 * cannot execute that: the search gate requires room for the 6s spacing AND the
 * full 45s extraction reservation, so under the 55s budget a search may only
 * start while elapsed <= 4s. That admits two searches, and the run then reports
 * `timeout` having abandoned seven planned calls — every single day.
 *
 * Planning 1 source × 2 strategies makes the schedule honest: it plans what it
 * can finish, so `timeout` goes back to meaning something went wrong rather
 * than being the normal outcome. Nothing is lost, because a daily job gets
 * breadth from rotation across days rather than from depth in one invocation —
 * and with the rotation fix, an unsearched source now keeps its turn.
 *
 * These use the EXISTING ProfileTargetedOptions. There is no second discovery
 * engine, no second query builder and no second source-selection path: the
 * scheduled run is the manual run with a smaller plan.
 */
export const SCHEDULED_MAX_SOURCES_PER_RUN = 1;
export const SCHEDULED_MAX_QUERIES_PER_RUN = 2;

export interface ScheduledRunResult {
    /** How many users are opted in right now. */
    eligibleUsers: number;
    /** The user processed this invocation, if any. */
    processedUserId: string | null;
    pagesScraped: number;
    /** Matches written by the post-discovery matching pass. */
    matchesPersisted: number;
    /** True when another discovery cycle held the lock and this run stood down. */
    concurrencyAborted: boolean;
    /** True when discovery stopped early on its own execution budget. */
    timedOut: boolean;
    /** True when the matching pass was skipped to stay inside the budget. */
    matchingSkipped: boolean;
    reason?: string;
}

/** Load candidate state with the service-role client: the cron has no session. */
async function loadCandidateState(
    admin: SupabaseClient,
    userId: string
): Promise<CandidateState | null> {
    const [profileRes, skillsRes, expRes, prefsRes] = await Promise.all([
        admin.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
        admin.from('candidate_skills').select('*').eq('user_id', userId),
        admin.from('candidate_experience').select('*').eq('user_id', userId),
        admin.from('candidate_preferences').select('*').eq('user_id', userId).maybeSingle(),
    ]);

    if (!profileRes.data && !skillsRes.data?.length && !expRes.data?.length) {
        return null;
    }

    return {
        profile: profileRes.data || null,
        skills: skillsRes.data || [],
        experience: expRes.data || [],
        preferences: prefsRes.data || null,
    };
}

/**
 * Score the user's active jobs that have no match row yet.
 *
 * Targeting UNSCORED jobs rather than "jobs from this run" keeps the pass
 * bounded and self-healing: anything a previous run could not finish is picked
 * up the next day instead of staying unscored forever.
 */
export async function matchUnscoredJobsForUser(
    admin: SupabaseClient,
    userId: string,
    limit: number = SCHEDULED_MATCH_LIMIT
): Promise<{ persisted: number; failed: number }> {
    const candidate = await loadCandidateState(admin, userId);
    if (!candidate) return { persisted: 0, failed: 0 };

    const [{ data: existingMatches }, { data: jobs }] = await Promise.all([
        admin.from('job_matches').select('job_id').eq('user_id', userId),
        admin
            .from('jobs')
            .select(`
                *,
                job_locations (city, state, country, remote_region),
                job_skills (skill_name, is_required)
            `)
            .eq('status', 'active')
            .order('discovered_at', { ascending: false })
            .limit(SCHEDULED_MATCH_SCAN_LIMIT),
    ]);

    const scored = new Set((existingMatches ?? []).map((m: { job_id: string }) => m.job_id));
    const unscored = (jobs ?? [])
        .filter((job: { id: string }) => !scored.has(job.id))
        .slice(0, Math.max(0, limit));

    let persisted = 0;
    let failed = 0;

    for (const job of unscored) {
        const matchResult = DeterministicMatcher.match(candidate, job as JobWithLocationsAndSkills);

        const { error } = await admin
            .from('job_matches')
            .upsert(buildMatchRow(userId, job.id, matchResult), { onConflict: 'user_id,job_id' });

        if (error) {
            failed++;
            console.error(`[ScheduledDiscovery] match write failed for job ${job.id}: ${describeWriteError(error)}`);
            continue;
        }
        persisted++;
    }

    if (persisted > 0 || failed > 0) {
        console.log(`[ScheduledDiscovery] matching persisted=${persisted} failed=${failed} candidates=${unscored.length}`);
    }

    return { persisted, failed };
}

/**
 * Select and process at most ONE opted-in user.
 *
 * One user per invocation is deliberate: a single profile-targeted run already
 * consumes the whole 55s discovery budget in its worst case, so processing a
 * second user in the same invocation could not fit under Hobby's 60s ceiling.
 * With several opted-in users, `last_daily_discovery_at ASC NULLS FIRST` makes
 * coverage rotate across days rather than always serving the same account.
 */
export async function runScheduledDailyDiscovery(): Promise<ScheduledRunResult> {
    const admin = createAdminClient();
    const budget = new ExecutionBudget(SCHEDULED_INVOCATION_BUDGET_SECONDS);

    const empty: ScheduledRunResult = {
        eligibleUsers: 0, processedUserId: null, pagesScraped: 0, matchesPersisted: 0,
        concurrencyAborted: false, timedOut: false, matchingSkipped: false,
    };

    const { data: eligible, error: eligibleErr } = await admin
        .from('profiles')
        .select('user_id, last_daily_discovery_at')
        .eq('daily_discovery_enabled', true)
        .order('last_daily_discovery_at', { ascending: true, nullsFirst: true })
        .limit(1);

    if (eligibleErr) {
        console.error('[ScheduledDiscovery] eligibility query failed:', eligibleErr.message);
        return { ...empty, reason: 'eligibility_query_failed' };
    }

    if (!eligible || eligible.length === 0) {
        console.log('[ScheduledDiscovery] no users have opted in; nothing to do.');
        return { ...empty, reason: 'no_eligible_users' };
    }

    const userId = eligible[0].user_id as string;
    console.log('[ScheduledDiscovery] processing 1 eligible user (least recently run).');

    // Unmodified Phase 3 entry point: every validated control comes with it.
    // The only difference from the manual run is a smaller plan, expressed
    // through the options the engine already exposes — same Search Parameters,
    // same job-source selection, same query builder, same rate gate, spacing,
    // rotation, URL cap, extraction reservation, dedup and allow-list.
    const discovery = await runProfileTargetedDiscovery(userId, {
        maxSourcesPerRun: SCHEDULED_MAX_SOURCES_PER_RUN,
        maxQueries: SCHEDULED_MAX_QUERIES_PER_RUN,
    });

    if (discovery.concurrencyAborted) {
        // Another cycle held the mutex. Do NOT stamp the rotation: this user has
        // not had their turn, so they stay first in line for the next run.
        console.warn('[ScheduledDiscovery] another discovery cycle is running; standing down.');
        return {
            ...empty, eligibleUsers: 1, concurrencyAborted: true, reason: 'concurrency_aborted',
        };
    }

    // Written immediately after discovery and BEFORE matching, so a
    // termination during matching cannot lose it. Extraction-only, so it is
    // recorded as provider_usage_unknown rather than a whole-run total.
    await recordRunUsage(admin, {
        userId,
        runId: discovery.runId,
        creditsUsed: discovery.creditsUsed,
        pagesScraped: discovery.pagesScraped,
        unknownUsage: discovery.unknownUsage,
        runError: discovery.runError,
        operation: 'background_discovery',
    });

    // One balance refresh per scheduled run, subject to the TTL.
    try {
        await refreshUsageSnapshot();
    } catch (err) {
        console.error('[ScheduledDiscovery] usage snapshot refresh failed (non-fatal):', err);
    }

    // Advance the rotation so a different opted-in user leads tomorrow.
    const { error: stampError } = await admin
        .from('profiles')
        .update({ last_daily_discovery_at: new Date().toISOString() })
        .eq('user_id', userId);

    if (stampError) {
        console.error('[ScheduledDiscovery] rotation stamp failed:', stampError.message);
    }

    // Matching is skipped rather than started when it cannot finish inside the
    // budget. Unscored jobs are picked up by the next run, so nothing is lost.
    let matchesPersisted = 0;
    let matchingSkipped = false;

    if (budget.canAfford(SCHEDULED_MATCH_RESERVATION_MS)) {
        const matching = await matchUnscoredJobsForUser(admin, userId);
        matchesPersisted = matching.persisted;
    } else {
        matchingSkipped = true;
        console.warn(
            `[ScheduledDiscovery] matching skipped after ${Math.round(budget.elapsedMs() / 1000)}s: ` +
            'insufficient budget remaining; unscored jobs roll over to the next run.'
        );
    }

    console.log(
        `[ScheduledDiscovery] complete pages=${discovery.pagesScraped} ` +
        `matches=${matchesPersisted} timedOut=${discovery.timedOut} ` +
        `elapsed=${Math.round(budget.elapsedMs() / 1000)}s`
    );

    return {
        eligibleUsers: 1,
        processedUserId: userId,
        pagesScraped: discovery.pagesScraped,
        matchesPersisted,
        concurrencyAborted: false,
        timedOut: discovery.timedOut === true,
        matchingSkipped,
    };
}
