'use server';

// Expose a manual discovery boundary obeying M2.2 strict limits inherently
import { runJobDiscovery, runProfileTargetedDiscovery } from '@/lib/jobs/discovery-service';
import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

export async function triggerDiscoveryAction() {
    try {
        // runJobDiscovery handles authentication natively via supabase.auth.getUser()
        // It strictly encapsulates 5 pages limit natively across the active domains mapping exactly to job boundaries.
        const searchRunId = await runJobDiscovery();

        revalidatePath('/jobs');
        revalidatePath('/dashboard');

        return { success: true, searchRunId };
    } catch (err: unknown) {
        console.error("Discovery Edge Failure:", err);
        return { success: false, error: err instanceof Error ? err.message : "Sync aborted due to unknown server failure" };
    }
}

/**
 * Profile-targeted job discovery, then matching — the user-facing "Find
 * matching jobs" action.
 *
 * Flow:
 *   persisted structured profile
 *     → buildSearchStrategies()        (deterministic, no LLM)
 *     → runProfileTargetedDiscovery()  (Firecrawl search, allow-list enforced,
 *                                       hard cap of 4 URLs, dedup, empty-
 *                                       extraction rejection)
 *     → triggerProfileMatching()       (existing M6 matcher, unmodified)
 *     → /jobs revalidated
 *
 * MANUAL ONLY. Nothing calls this on page load, on a schedule, or from a cron
 * route — it runs solely in response to an explicit user click, because it
 * spends Firecrawl credits.
 *
 * The URL budget is deliberately not passed: runProfileTargetedDiscovery
 * applies PROFILE_SEARCH_DEFAULT_MAX_URLS_PER_RUN and clamps to the hard
 * ceiling, so this action cannot widen it.
 */
export async function findMatchingJobsAction() {
    try {
        const supabase = await createClient();
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr || !authData.user) {
            return { success: false, error: 'Unauthorized' };
        }

        const discovery = await runProfileTargetedDiscovery(authData.user.id);

        if (discovery.strategies.length === 0) {
            return {
                success: false,
                error: 'No search criteria could be derived from your profile. Upload and confirm a resume first.',
            };
        }

        // Reuse the existing M6 matching path. Not rewritten, not bypassed.
        const { triggerProfileMatching } = await import('./match-actions');
        const matching = await triggerProfileMatching();

        revalidatePath('/jobs');
        revalidatePath('/dashboard');

        return {
            success: true,
            queries: discovery.strategies.map(s => s.query),
            pagesScraped: discovery.pagesScraped,
            matched: matching.success,
        };
    } catch (err: unknown) {
        console.error('Profile-targeted discovery failed:', err);
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Job search failed due to an unknown server error',
        };
    }
}
