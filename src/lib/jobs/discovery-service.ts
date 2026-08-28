import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/utils/supabase/server';
import { getActiveJobSources } from './job-source-service';
import { createSearchRun, completeSearchRunWithStats, createCrawlRun, markCrawlRunCompleted, markCrawlRunFailed, markCrawlRunRunning } from './crawl-service';
import { SourceAdapterRegistry } from './adapters/source-adapter-registry';
import { JobNormalizer } from './job-normalizer';
import { DiscoveredURL } from './adapters/types';
import { buildSearchStrategies, SearchStrategy, resolveUrlBudget } from './profile-search-strategy';
import {
    acquireDiscoveryLock,
    releaseDiscoveryLock,
    ExecutionBudget,
    getProfileSearchTimeoutSeconds,
} from './discovery-lock';
import { minSearchSpacingMs } from './adapters/firecrawl-adapter';

/**
 * Validates that a discovered candidate URL strictly belongs to the permitted root domain.
 * Rejects malicious variants (e.g., evil-example.com vs example.com).
 */
function isDomainAllowed(candidateUrlStr: string, allowedHost: string): boolean {
    try {
        const candidateHost = new URL(candidateUrlStr).hostname.toLowerCase();
        const rootAllowed = allowedHost.toLowerCase().replace(/^www\./, '');

        return candidateHost === rootAllowed || candidateHost.endsWith(`.${rootAllowed}`);
    } catch {
        return false;
    }
}

/**
 * Executes a controlled Bounded Jobs Discovery orchestrated loop securely on the server.
 * This runs iteratively across verified 'active' sources directly from the strictly typed DB schema.
 * 
 * Internal trusted executor bound to a specific user. 
 * Should only be called by fully trusted backend services.
 */
/**
 * Optional replacement for the default per-source URL discovery step.
 *
 * Supplied by the profile-targeted path so query-driven results flow through
 * the EXISTING extraction, normalization, dedup, source-tracking and credit
 * accounting pipeline unchanged. Everything downstream of URL discovery —
 * including the isDomainAllowed cross-domain check — is untouched.
 */
export type DiscoverOverride = (
    source: { id: string; name?: string | null; base_url?: string | null },
    limit: number
) => Promise<DiscoveredURL[]>;

/**
 * Optional pre-fetched source list.
 *
 * getActiveJobSources() uses the cookie-scoped server client, so it only works
 * inside a Next.js request context. Supplying the sources directly lets trusted
 * server-side callers (and offline measurement runs) execute outside a request
 * scope. It does NOT widen the allow-list: callers pass the same active
 * job_sources rows read from the database.
 */
export type SourcesOverride = Array<{
    id: string; name?: string | null; base_url?: string | null;
}>;

export async function runJobDiscoveryForUser(
    userId: string,
    searchParams: Record<string, unknown> = { initiated_by: 'background_cron' },
    discoverOverride?: DiscoverOverride,
    sourcesOverride?: SourcesOverride
): Promise<{ runId: string, creditsUsed: number, pagesScraped: number, runError: boolean, unknownUsage: boolean }> {
    const adminClient = createAdminClient();
    const registry = new SourceAdapterRegistry();
    let searchRunId = "";
    let totalCreditsConsumed = 0;
    let totalPagesScraped = 0;
    let unknownUsage = false;
    let runError = false;

    try {
        // 1. Initialize the Tracking Run 
        const searchRun = await createSearchRun({
            user_id: userId,
            saved_search_id: (searchParams.saved_search_id as string) || undefined,
            search_params: searchParams
        });
        searchRunId = searchRun.id;

        // 2. Fetch Allow-listed active sources & map them securely against the requested selected SavedSearch Target correctly efficiently explicitly.
        const allSources = sourcesOverride ?? await getActiveJobSources();
        let sources = allSources;

        if (searchParams.saved_search_id) {
            const { data: savedSearchTarget } = await adminClient
                .from('saved_searches')
                .select('filters')
                .eq('id', searchParams.saved_search_id)
                .single();

            // Constrain source strictly if requested. 
            // If the saved search purposefully omits source_id, it is implicitly unbounded against all sources effectively correctly efficiently identically securely correctly successfully organically.
            if (savedSearchTarget?.filters?.source_id) {
                sources = allSources.filter(s => s.id === savedSearchTarget.filters.source_id);
            }
        }

        if (!sources || sources.length === 0) {
            await completeSearchRunWithStats(searchRunId, { sources_searched: 0 });
            return { runId: searchRunId, creditsUsed: 0, pagesScraped: 0, runError: false, unknownUsage: false };
        }

        let jobsDiscoveredCount = 0;
        let jobsCreatedCount = 0;
        let jobsUpdatedCount = 0;
        let errorsFound = 0;
        let duplicatesFound = 0;
        const errorLogs: unknown[] = [];

        for (const source of sources) {
            if (!source.base_url) continue;

            const adapter = registry.getAdapterForSource(source.base_url);
            if (!adapter) {
                errorLogs.push({ source: source.name, error: "No adapter registered capable of handling domains for this source type" });
                continue;
            }

            try {
                // 3. Bound concurrency natively with absolute max limits 
                // Passed search limits if configured
                const searchLimit = (searchParams.limit as number) || 5;
                const sourceRootDomain = new URL(source.base_url).hostname;
                const discovered = discoverOverride
                    ? await discoverOverride(source, searchLimit)
                    : await adapter.discover(source.base_url, searchLimit);

                for (const candidate of discovered) {
                    jobsDiscoveredCount++;

                    // Reject Cross-Domain arbitrarily crawled payloads strictly!
                    if (!isDomainAllowed(candidate.url, sourceRootDomain)) {
                        errorLogs.push({ url: candidate.url, error: "Illegal cross-domain boundary violation rejected" });
                        errorsFound++;
                        continue;
                    }

                    // 4. Record single page crawl metrics via `crawl_runs` 
                    const crawlRun = await createCrawlRun({
                        user_id: userId,
                        source_id: source.id,
                        search_run_id: searchRunId,
                        url: candidate.url
                    });

                    await markCrawlRunRunning(crawlRun.id);

                    try {
                        // 5. Firecrawl Extraction mapped to exactly bounded schemas
                        const extraction = await adapter.extract(candidate.url);

                        // Enforce strict numeric bounded constraints defensively identically elegantly efficiently efficiently correctly smartly securely organically carefully beautifully flawlessly comfortably expertly explicitly identically comfortably solidly safely logically.
                        if (
                            typeof extraction.creditsUsed === 'number' &&
                            Number.isFinite(extraction.creditsUsed) &&
                            extraction.creditsUsed >= 0
                        ) {
                            totalCreditsConsumed += extraction.creditsUsed;
                        } else {
                            unknownUsage = true;
                        }
                        totalPagesScraped++;

                        if (!extraction.success || !extraction.data) {
                            await markCrawlRunFailed(crawlRun.id, extraction.error || "No extraction data");
                            errorsFound++;
                            continue;
                        }

                        // 6. Normalize (incorporating generated canonical_id natively via domain structure)
                        const normalizedJob = JobNormalizer.normalize(extraction.data, sourceRootDomain);
                        if (!normalizedJob || !normalizedJob.canonical_id) {
                            await markCrawlRunFailed(crawlRun.id, "Normalization failed (Missing mapping schema constraints)");
                            errorsFound++;
                            continue;
                        }

                        // 7. Explicit Database verification for metrics (instead of relying on blind UPSERT metrics)
                        let jobTargetId: string;

                        const { data: existingJob, error: checkError } = await adminClient
                            .from('jobs')
                            .select('id, raw_content_hash')
                            .eq('canonical_id', normalizedJob.canonical_id)
                            .maybeSingle();

                        if (checkError) throw checkError;

                        if (existingJob) {
                            jobTargetId = existingJob.id;
                            // Check if payload actually changed to count as an Update vs a Duplicate ping
                            if (existingJob.raw_content_hash !== normalizedJob.raw_content_hash) {
                                // Full update
                                // Explicitly exclude canonical_id (and id is already omitted) to prevent PK overwrite
                                const { canonical_id, ...updatePayload } = normalizedJob;
                                const { error: updateError } = await adminClient
                                    .from('jobs')
                                    .update({ ...updatePayload, status: 'active', last_verified_at: new Date().toISOString() })
                                    .eq('id', existingJob.id);
                                if (updateError) throw updateError;
                                jobsUpdatedCount++;
                            } else {
                                // Content unchanged, simply note it's still alive without counting as a mutation
                                await adminClient
                                    .from('jobs')
                                    .update({ last_verified_at: new Date().toISOString(), status: 'active' })
                                    .eq('id', existingJob.id);
                                duplicatesFound++;
                            }
                        } else {
                            // Net New Canonical Creation
                            const { data: newJob, error: insertError } = await adminClient
                                .from('jobs')
                                .insert({ ...normalizedJob, status: 'active', last_verified_at: new Date().toISOString() })
                                .select('id')
                                .single();

                            if (insertError) {
                                // PostgreSQL unique_violation '23505' catches race condition where another concurrent run inserted it
                                if (insertError.code === '23505') {
                                    const { data: racedJob, error: racedError } = await adminClient
                                        .from('jobs')
                                        .select('id, raw_content_hash')
                                        .eq('canonical_id', normalizedJob.canonical_id)
                                        .single();

                                    if (racedError || !racedJob) throw racedError || new Error("Failed to recover from unique violation race condition");
                                    jobTargetId = racedJob.id;

                                    if (racedJob.raw_content_hash !== normalizedJob.raw_content_hash) {
                                        const { canonical_id, ...updatePayload } = normalizedJob;
                                        await adminClient.from('jobs').update({ ...updatePayload, status: 'active', last_verified_at: new Date().toISOString() }).eq('id', racedJob.id);
                                        jobsUpdatedCount++;
                                    } else {
                                        await adminClient.from('jobs').update({ status: 'active', last_verified_at: new Date().toISOString() }).eq('id', racedJob.id);
                                        duplicatesFound++;
                                    }
                                } else {
                                    throw insertError;
                                }
                            } else if (!newJob) {
                                throw new Error("Insert returned no ID");
                            } else {
                                jobTargetId = newJob.id;
                                jobsCreatedCount++;
                            }
                        }

                        // 8. Idempotent Target Tracking - Mappings
                        // external_job_id might be null in unstructured crawls.
                        // We append .limit(1) safely so maybeSingle does NOT throw when multiple NULL IDs exist natively
                        const { data: existingMap, error: mapCheckError } = await adminClient
                            .from('job_source_mappings')
                            .select('id')
                            .eq('job_id', jobTargetId)
                            .eq('source_id', source.id)
                            .is('external_job_id', null)
                            .limit(1)
                            .maybeSingle();

                        if (mapCheckError) throw mapCheckError;

                        if (existingMap) {
                            await adminClient
                                .from('job_source_mappings')
                                .update({ last_seen_at: new Date().toISOString(), is_active: true })
                                .eq('id', existingMap.id);
                        } else {
                            await adminClient
                                .from('job_source_mappings')
                                .insert({
                                    job_id: jobTargetId,
                                    source_id: source.id,
                                    source_url: candidate.url,
                                    is_active: true,
                                    last_seen_at: new Date().toISOString()
                                });
                        }

                        // 9. Update stats globally
                        await markCrawlRunCompleted(crawlRun.id, {
                            result_status: 'success',
                            content_hash: normalizedJob.raw_content_hash
                        });

                    } catch (innerEx: unknown) {
                        const message = innerEx instanceof Error ? innerEx.message : String(innerEx);
                        await markCrawlRunFailed(crawlRun.id, `Adapter catastrophic fail: ${message}`);
                        errorsFound++;
                    }
                }

            } catch (outerEx: unknown) {
                // 10. The source broke, but we shouldn't kill the entire search! Isolated bounds constraint obeyed.
                const message = outerEx instanceof Error ? outerEx.message : String(outerEx);
                errorLogs.push({ source: source.name, error: message });
                errorsFound++;
            }
        }

        // Finalize Search Run
        await completeSearchRunWithStats(searchRunId, {
            sources_searched: sources.length,
            jobs_discovered: jobsDiscoveredCount,
            jobs_created: jobsCreatedCount,
            jobs_updated: jobsUpdatedCount,
            duplicates_found: duplicatesFound,
            failures: errorsFound,
            errors: errorLogs
        });

        runError = errorsFound > 0;

        return { runId: searchRunId, creditsUsed: totalCreditsConsumed, pagesScraped: totalPagesScraped, runError, unknownUsage };

    } catch (criticalFailure: unknown) {
        if (searchRunId) {
            const message = criticalFailure instanceof Error ? criticalFailure.message : String(criticalFailure);
            await completeSearchRunWithStats(searchRunId, {
                failures: 1, // Global break
                errors: [{ fatal: message }]
            });
        }
        throw criticalFailure;
    }
}

// ── Profile-targeted discovery (M5 profile → targeted queries → M2 pipeline) ──

export interface ProfileTargetedOptions {
    /** Hard cap on generated queries. Bounds credit spend. */
    maxQueries?: number;
    /** Results requested per query, per source. */
    resultsPerQuery?: number;
    /**
     * Run-wide ceiling on URLs handed to extraction.
     *
     * This is the primary cost control. Without it, queries × sources × results
     * multiply: 3 queries across 10 sources at 5 results each is 150 extractions
     * in a single run. Extraction is the expensive operation, so the run-wide
     * budget — not the per-query limit — is what actually bounds spend.
     */
    maxUrlsPerRun?: number;
    /**
     * Optional PER-RUN restriction to a subset of the already-active sources,
     * by hostname. This narrows a single run (e.g. to reliably-scrapable ATS
     * domains for a cost measurement); it does NOT alter the permanent
     * job_sources allow-list and cannot widen it — a host not already active
     * is still never searched.
     */
    sourceHostAllowList?: string[];
    /**
     * Sources searched in this run. Defaults to getMaxSourcesPerRun().
     * Lower values reduce search calls; the rotation still covers every source
     * across successive runs.
     */
    maxSourcesPerRun?: number;
    /** Execution budget in seconds. Defaults to getProfileSearchTimeoutSeconds(). */
    timeoutSeconds?: number;
}

export const PROFILE_SEARCH_DEFAULT_MAX_QUERIES = 3;
export const PROFILE_SEARCH_DEFAULT_RESULTS_PER_QUERY = 5;

/**
 * Sources searched per run.
 *
 * Search calls are queries × sources. With 10 active sources and 3 strategies
 * a run fired 30 calls into a ~10/min ceiling and two thirds were rejected.
 * Capping sources is the primary control: 3 sources × 3 queries = 9 calls,
 * inside the budget with headroom.
 *
 * Coverage is not lost — sources rotate by last_crawled_at, so every source is
 * reached across successive runs.
 *
 * Configurable via PROFILE_SEARCH_MAX_SOURCES.
 */
export const PROFILE_SEARCH_DEFAULT_MAX_SOURCES_PER_RUN = 3;

export function getMaxSourcesPerRun(): number {
    const raw = process.env.PROFILE_SEARCH_MAX_SOURCES;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return PROFILE_SEARCH_DEFAULT_MAX_SOURCES_PER_RUN;
}

// The run-wide URL budget and its hard ceiling live in profile-search-strategy
// so they can be unit-tested; re-exported here for callers of this module.
export {
    PROFILE_SEARCH_DEFAULT_MAX_URLS_PER_RUN,
    PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN,
} from './profile-search-strategy';

/**
 * Load the structured candidate profile and derive targeted search queries.
 * Read-only. Touches only candidate_* tables — never applications or
 * application_events.
 */
export async function buildStrategiesForUser(
    userId: string,
    options: ProfileTargetedOptions = {}
): Promise<SearchStrategy[]> {
    const adminClient = createAdminClient();

    const [profileRes, skillsRes, expRes, engRes, prefsRes] = await Promise.all([
        adminClient.from('profiles').select('headline, years_of_experience, current_location').eq('user_id', userId).maybeSingle(),
        adminClient.from('candidate_skills').select('skill_name, category, is_primary').eq('user_id', userId),
        adminClient.from('candidate_experience').select('title, is_current').eq('user_id', userId),
        adminClient.from('candidate_engagements').select('technologies, domains').eq('user_id', userId),
        adminClient.from('candidate_preferences').select('desired_roles, excluded_roles, geographic_preferences').eq('user_id', userId).maybeSingle(),
    ]);

    return buildSearchStrategies(
        {
            profile: profileRes.data ?? null,
            skills: skillsRes.data ?? [],
            experience: expRes.data ?? [],
            engagements: engRes.data ?? [],
            preferences: prefsRes.data ?? null,
        },
        { maxQueries: options.maxQueries ?? PROFILE_SEARCH_DEFAULT_MAX_QUERIES }
    );
}

/**
 * Profile-targeted job discovery.
 *
 * Resume → structured profile → targeted queries → Firecrawl search restricted
 * to the EXISTING allow-listed job_sources domains → the existing normalization,
 * dedup, source-tracking and M6 matching pipeline.
 *
 * Nothing in M2/M2.2 normalization or M6 matching is bypassed or rewritten: the
 * only change is where candidate URLs come from. Results already seen for a
 * source are skipped so the same postings are not re-crawled.
 */
export async function runProfileTargetedDiscovery(
    userId: string,
    options: ProfileTargetedOptions = {}
): Promise<{
    runId: string; creditsUsed: number; pagesScraped: number;
    runError: boolean; unknownUsage: boolean;
    strategies: SearchStrategy[];
    sourcesSearched: number;
    /** Set when another cycle already held the lock. No external work was done. */
    concurrencyAborted?: boolean;
    /** Set when the execution budget stopped the run early. */
    timedOut?: boolean;
}> {
    const adminClient = createAdminClient();
    const strategies = await buildStrategiesForUser(userId, options);

    if (strategies.length === 0) {
        // No profile signal — do not fall back to an untargeted crawl, and do
        // not spend a single credit.
        const run = await createSearchRun({
            user_id: userId,
            search_params: { initiated_by: 'profile_targeted', reason: 'no_profile_signal' },
        });
        await completeSearchRunWithStats(run.id, { sources_searched: 0 });
        return {
            runId: run.id, creditsUsed: 0, pagesScraped: 0,
            runError: false, unknownUsage: false, strategies: [], sourcesSearched: 0,
        };
    }

    // ── Cross-instance mutual exclusion ─────────────────────────────────────
    // Reuses M8's m8_cron_runs mutex. Acquired BEFORE any Firecrawl work, so a
    // losing run spends zero credits.
    const lock = await acquireDiscoveryLock(adminClient);
    if (!lock.acquired) {
        const run = await createSearchRun({
            user_id: userId,
            search_params: {
                initiated_by: 'profile_targeted',
                reason: lock.reason === 'busy' ? 'concurrency_aborted' : 'lock_error',
            },
        });
        await completeSearchRunWithStats(run.id, { sources_searched: 0 });
        return {
            runId: run.id, creditsUsed: 0, pagesScraped: 0,
            runError: lock.reason === 'error', unknownUsage: false,
            strategies, sourcesSearched: 0, concurrencyAborted: true,
        };
    }

    // Everything past this point MUST release the lock on every exit path.
    const budget = new ExecutionBudget(
        options.timeoutSeconds ?? getProfileSearchTimeoutSeconds()
    );
    let timedOut = false;
    let searchesAttempted = 0;

    try {
    const resultsPerQuery = Math.max(
        1, Math.min(options.resultsPerQuery ?? PROFILE_SEARCH_DEFAULT_RESULTS_PER_QUERY, 20)
    );

    // URLs already tracked for any source: never re-crawl a known posting.
    const { data: knownMappings } = await adminClient
        .from('job_source_mappings')
        .select('source_url');
    const alreadySeen = new Set(
        (knownMappings ?? [])
            .map((m: { source_url: string | null }) => m.source_url)
            .filter((u): u is string => typeof u === 'string')
    );

    // Guards against re-searching the same source twice within one run.
    const emittedThisRun = new Set<string>();

    // Run-wide extraction budget — the real cost control (see maxUrlsPerRun).
    // Clamped to the hard ceiling: a caller can request fewer URLs, never more.
    const maxUrlsPerRun = resolveUrlBudget(options.maxUrlsPerRun);
    let urlBudgetRemaining = maxUrlsPerRun;

    const override: DiscoverOverride = async (source, limit) => {
        if (!source.base_url) return [];

        if (urlBudgetRemaining <= 0) {
            console.log('[ProfileTargeted] run URL budget exhausted; skipping remaining sources');
            return [];
        }

        // Stop taking on new sources once the time budget is spent.
        if (timedOut || !budget.canAfford(minSearchSpacingMs())) {
            timedOut = true;
            console.warn('[ProfileTargeted] execution budget exhausted; skipping remaining sources');
            return [];
        }

        const registry = new SourceAdapterRegistry();
        const adapter = registry.getAdapterForSource(source.base_url);

        if (!adapter || typeof adapter.searchJobs !== 'function') {
            console.warn(`[ProfileTargeted] adapter for ${source.name ?? source.id} has no search capability; skipping`);
            return [];
        }

        let sourceHost: string;
        try {
            sourceHost = new URL(source.base_url).hostname;
        } catch {
            return [];
        }

        // Per-run narrowing only. Never widens the permanent allow-list.
        if (options.sourceHostAllowList && options.sourceHostAllowList.length > 0) {
            const permittedThisRun = options.sourceHostAllowList.map(h => h.toLowerCase());
            if (!permittedThisRun.includes(sourceHost.toLowerCase())) {
                console.log(`[ProfileTargeted] source=${source.name ?? source.id} skipped (not in this run's scope)`);
                return [];
            }
        }

        const perQuery = Math.min(limit || resultsPerQuery, resultsPerQuery);
        const collected: DiscoveredURL[] = [];

        for (const strategy of strategies) {
            if (urlBudgetRemaining <= 0) break;

            // Time guard: a search costs at least the rate-gate spacing (~6s).
            // Checked BEFORE starting, so an in-flight request is never
            // interrupted and no partial record is written.
            if (!budget.canAfford(minSearchSpacingMs())) {
                timedOut = true;
                console.warn(
                    `[ProfileTargeted] execution budget exhausted after ${Math.round(budget.elapsedMs() / 1000)}s; ` +
                    'stopping cleanly before the next search'
                );
                break;
            }

            searchesAttempted++;

            // Restricted to THIS source's domain, so results are inherently
            // within the existing allow-list.
            const found = await adapter.searchJobs!(strategy.query, {
                includeDomains: [sourceHost],
                limit: Math.min(perQuery, urlBudgetRemaining),
            });

            for (const item of found) {
                if (urlBudgetRemaining <= 0) break;
                if (alreadySeen.has(item.url) || emittedThisRun.has(item.url)) continue;
                emittedThisRun.add(item.url);
                collected.push(item);
                urlBudgetRemaining--;
            }
        }

        console.log(
            `[ProfileTargeted] source=${source.name ?? source.id} queries=${strategies.length} ` +
            `new_urls=${collected.length} budget_left=${urlBudgetRemaining}`
        );
        return collected;
    };

    // Read the SAME active job_sources rows with the admin client, so this path
    // works outside a Next.js request scope. The allow-list is unchanged.
    //
    // Rotation: least-recently-searched first, so successive runs cover every
    // source instead of always hitting the same top-priority few. Ordering is
    // fully deterministic — last_crawled_at, then priority, then id — so the
    // same DB state always yields the same selection.
    const { data: allActiveSources } = await adminClient
        .from('job_sources')
        .select('id, name, base_url, last_crawled_at, priority')
        .eq('active', true)
        .order('last_crawled_at', { ascending: true, nullsFirst: true })
        .order('priority', { ascending: true })
        .order('id', { ascending: true });

    // Cap sources per run. This is what keeps search calls inside the
    // provider's per-minute budget (queries × sources).
    const maxSources = options.maxSourcesPerRun ?? getMaxSourcesPerRun();
    const activeSources = (allActiveSources ?? []).slice(0, Math.max(1, maxSources));

    console.log(
        `[ProfileTargeted] sources selected ${activeSources.length}/${(allActiveSources ?? []).length} ` +
        `(cap=${maxSources}) → ${strategies.length * activeSources.length} search call(s) planned`
    );

    const result = await runJobDiscoveryForUser(
        userId,
        {
            initiated_by: 'profile_targeted',
            limit: resultsPerQuery,
            query_count: strategies.length,
        },
        override,
        activeSources
    );

    // Advance the rotation so the NEXT run picks up where this one left off.
    // Stamped after the run regardless of per-source yield: a source that was
    // searched has had its turn, so it must not be selected again ahead of
    // sources still waiting.
    if (activeSources.length > 0) {
        const { error: rotationError } = await adminClient
            .from('job_sources')
            .update({ last_crawled_at: new Date().toISOString() })
            .in('id', activeSources.map(s => s.id));

        if (rotationError) {
            // Non-fatal: the run succeeded, only the rotation pointer failed.
            console.error('[ProfileTargeted] rotation stamp failed:', rotationError.message);
        }
    }

        await releaseDiscoveryLock(
            adminClient,
            lock.runId,
            timedOut ? 'timeout' : 'completed',
            {
                searchesProcessed: searchesAttempted,
                errorLog: timedOut ? 'Execution budget reached; stopped before next search' : undefined,
            }
        );

        return {
            ...result, strategies,
            sourcesSearched: activeSources.length,
            timedOut,
        };
    } catch (err: unknown) {
        // Release on failure too, or the partial unique index blocks every
        // future run.
        await releaseDiscoveryLock(adminClient, lock.runId, 'failed', {
            searchesProcessed: searchesAttempted,
            errorLog: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}

/**
 * Public facing user-bound wrapper.
 */
export async function runJobDiscovery(): Promise<string> {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        throw new Error("Unauthorized: Identity cannot be verified.");
    }

    const { runId } = await runJobDiscoveryForUser(user.id, { initiated_by: 'manual_trigger' });
    return runId;
}
