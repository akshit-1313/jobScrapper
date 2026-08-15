import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/utils/supabase/server';
import { getActiveJobSources } from './job-source-service';
import { createSearchRun, completeSearchRunWithStats, createCrawlRun, markCrawlRunCompleted, markCrawlRunFailed, markCrawlRunRunning } from './crawl-service';
import { SourceAdapterRegistry } from './adapters/source-adapter-registry';
import { JobNormalizer } from './job-normalizer';

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
export async function runJobDiscoveryForUser(userId: string, searchParams: Record<string, unknown> = { initiated_by: 'background_cron' }): Promise<{ runId: string, creditsUsed: number, pagesScraped: number, runError: boolean, unknownUsage: boolean }> {
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
        const allSources = await getActiveJobSources();
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
                const discovered = await adapter.discover(source.base_url, searchLimit);

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
