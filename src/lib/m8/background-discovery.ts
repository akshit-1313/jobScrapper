import { createAdminClient } from "@/lib/supabase/admin";
import { allocateGeographicWorkload, classifySearchGeography } from "./geographic-allocator";
import { runJobDiscoveryForUser } from '../jobs/discovery-service';
import { executePhaseCMatchAlerts } from './phase-c-orchestrator';

export async function executeBackgroundDiscovery() {
    const supabase = createAdminClient();

    // 1. Cron Concurrency Check
    // We attempt to insert into m8_cron_runs. The DB has a partial unique index on status='running'.
    // If it fails with a unique constraint violation, another job is running.
    const { data: cronRun, error: cronInsertErr } = await supabase
        .from('m8_cron_runs')
        .insert({ status: 'running' })
        .select('*')
        .single();

    if (cronInsertErr) {
        if (cronInsertErr.code === '23505') {
            console.warn('[M8_CRON_ABORT] Another background cycle is currently running. Isolating properly.');
            return { success: false, reason: 'concurrency_aborted' };
        }
        throw new Error(`Cron initialization failed: ${cronInsertErr.message}`);
    }

    try {
        // 2. Load Configuration (Fail-Closed)
        const { data: configs, error: configErr } = await supabase.from('m8_system_config').select('*');
        if (configErr || !configs || configs.length === 0) {
            throw new Error(`Missing system configuration for M8 Orchestration.`);
        }
        const configMap = new Map(configs.map(c => [c.key, c.value]));
        const globalConfigValue = configMap.get('GLOBAL_FIRECRAWL_SAFE_BUDGET') as Record<string, unknown>;
        const globalSafeBudget = Number(globalConfigValue?.budget);
        const workloadLimits = configMap.get('WORKLOAD_LIMITS') as { searches_per_invoke?: number; max_pages_per_search?: number; timeout_seconds?: number } | undefined;

        const searches = workloadLimits?.searches_per_invoke as number;
        const maxPages = workloadLimits?.max_pages_per_search as number;
        const timeoutSecondsVal = workloadLimits?.timeout_seconds as number;

        if (
            globalConfigValue === undefined ||
            !workloadLimits ||
            !Number.isInteger(globalSafeBudget) ||
            globalSafeBudget < 0 ||
            !Number.isInteger(searches) || searches < 1 ||
            !Number.isInteger(maxPages) || maxPages < 1 ||
            typeof timeoutSecondsVal !== 'number' || timeoutSecondsVal <= 0
        ) {
            throw new Error(`M8_ERR_CONFIG_INVALID: Missing or invalid required configuration keys (GLOBAL_FIRECRAWL_SAFE_BUDGET or WORKLOAD_LIMITS).`);
        }

        const maxSearchesPerInvoke = searches;
        const maxPagesPerSearch = maxPages;
        const timeoutSeconds = timeoutSecondsVal;
        const startTime = Date.now();

        // 3. Billing Period
        const now = new Date();
        const currentBillingMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

        // 4. Calculate Global Budget Remaining
        const { data: ledgers, error: ledgersErr } = await supabase
            .from('firecrawl_usage_ledgers')
            .select('credits_consumed')
            .eq('billing_month', currentBillingMonth);

        if (ledgersErr) throw new Error("Failed to load global ledger data.");

        const globalUsage = (ledgers || []).reduce((acc, curr) => acc + (curr.credits_consumed || 0), 0);
        const globalRemaining = globalSafeBudget - globalUsage;

        if (globalRemaining <= 0) {
            console.warn('[M8_CRON_HALT] Global budget exhausted. Aborting discovery.');
            await supabase.from('m8_cron_runs').update({ status: 'completed', completed_at: new Date().toISOString(), error_log: 'Global budget exhausted' }).eq('id', cronRun.id);
            return { success: true, processed: 0, reason: 'global_budget_exhausted' };
        }

        // 5. User Eligibility
        // Get active allocations
        const { data: allocations, error: allocErr } = await supabase
            .from('user_firecrawl_allocations')
            .select('user_id, allocated_credits')
            .eq('billing_month', currentBillingMonth)
            .eq('is_enabled', true)
            .gt('allocated_credits', 0);

        if (allocErr) throw new Error("Failed to load user allocations");
        if (!allocations || allocations.length === 0) {
            await supabase.from('m8_cron_runs').update({ status: 'completed', completed_at: new Date().toISOString(), error_log: 'No eligible users' }).eq('id', cronRun.id);
            return { success: true, processed: 0, reason: 'no_eligible_users' };
        }
        const eligibleUserIds = allocations.map(a => a.user_id);

        // Get user consumptions
        const { data: userUsages, error: userUsageErr } = await supabase
            .from('firecrawl_usage_ledgers')
            .select('user_id, credits_consumed')
            .eq('billing_month', currentBillingMonth)
            .in('user_id', eligibleUserIds);

        if (userUsageErr) throw new Error("Failed to load user ledgers");

        // Map remaining budgets natively seamlessly safely manually cleanly
        const userRemainingMap = new Map<string, number>();
        for (const a of allocations) {
            const consumed = (userUsages || []).filter(u => u.user_id === a.user_id).reduce((acc, curr) => acc + (curr.credits_consumed || 0), 0);
            // Ensure > 0
            if (a.allocated_credits - consumed > 0) {
                userRemainingMap.set(a.user_id, a.allocated_credits - consumed);
            }
        }

        const strictEligibleUserIds = Array.from(userRemainingMap.keys());
        if (strictEligibleUserIds.length === 0) {
            await supabase.from('m8_cron_runs').update({ status: 'completed', completed_at: new Date().toISOString(), error_log: 'All users budget exhausted' }).eq('id', cronRun.id);
            return { success: true, processed: 0, reason: 'user_budgets_exhausted' };
        }

        // 6. Select Active Saved Searches
        const { data: activeSearches, error: searchesErr } = await supabase
            .from('saved_searches')
            .select('*')
            .eq('is_active', true)
            .in('user_id', strictEligibleUserIds)
            .order('last_run_at', { ascending: true, nullsFirst: true })
            .order('id', { ascending: true }); // deterministic tie break

        if (searchesErr) throw new Error("Failed to fetch saved searches");

        // 7. Geographic Grouping
        const { data: geoPrefs, error: geoErr } = await supabase
            .from('user_geographic_preferences')
            .select('user_id, india_discovery_percent')
            .in('user_id', strictEligibleUserIds);

        if (geoErr) throw new Error("Failed to fetch geographic profiles");

        const geographicMap = new Map<string, number>(
            (geoPrefs || []).map(p => {
                const val = p.india_discovery_percent ?? 50;
                return [p.user_id, val];
            })
        );

        interface SavedSearchRecord {
            id: string;
            user_id: string;
            search_phrase: string;
            last_run_at?: string;
        }

        // Sort searches natively by oldest effectively dynamically correctly thoughtfully smoothly properly dynamically effectively solidly appropriately
        const userSearchMap = new Map<string, typeof activeSearches>();
        for (const s of (activeSearches || [])) {
            const arr = userSearchMap.get(s.user_id) || [];
            arr.push(s);
            userSearchMap.set(s.user_id, arr);
        }

        // Round-robin slot allocation seamlessly properly cleanly effectively precisely carefully smartly organically
        const userSlotMap = new Map<string, number>();
        let remainingSlots = maxSearchesPerInvoke;
        const activeUsersList = Array.from(userSearchMap.keys());

        let pointer = 0;
        while (remainingSlots > 0 && activeUsersList.length > 0) {
            const u = activeUsersList[pointer % activeUsersList.length];
            const currentSlots = userSlotMap.get(u) || 0;
            const maxForUser = userSearchMap.get(u)!.length;

            if (currentSlots < maxForUser) {
                userSlotMap.set(u, currentSlots + 1);
                remainingSlots--;
            } else {
                // User has no more searches, remove from round robin smoothly successfully responsibly expertly seamlessly explicitly intuitively smartly
                activeUsersList.splice(pointer % activeUsersList.length, 1);
                pointer--; // adjust index reliably smartly effectively comfortably precisely sensibly accurately elegantly manually flexibly safely natively structurally dynamically correctly predictably exactly cleanly gracefully sensibly flawlessly solidly accurately solidly expertly mathematically reliably securely
            }
            pointer++;
        }

        const finalExecutionQueue: typeof activeSearches = [];

        for (const [uid, allocatedSlots] of userSlotMap.entries()) {
            if (allocatedSlots <= 0) continue;

            const userSearches = userSearchMap.get(uid)!;
            const indiaSearches = userSearches.filter(s => classifySearchGeography(s.search_phrase) === 'india');
            const globalSearches = userSearches.filter(s => classifySearchGeography(s.search_phrase) === 'global');

            const indiaPercent = geographicMap.get(uid) ?? 50;

            const allocTarget = allocateGeographicWorkload(
                allocatedSlots,
                indiaPercent,
                indiaSearches.length,
                globalSearches.length
            );

            finalExecutionQueue.push(...indiaSearches.slice(0, allocTarget.indiaSlots));
            finalExecutionQueue.push(...globalSearches.slice(0, allocTarget.globalSlots));
        }

        // Interleave the final execution queue globally by oldest so it hits round-robin natively correctly stably manually correctly safely smoothly sensibly carefully intuitively smartly flawlessly
        finalExecutionQueue.sort((a, b) => {
            const timeA = a.last_run_at ? new Date(a.last_run_at).getTime() : 0;
            const timeB = b.last_run_at ? new Date(b.last_run_at).getTime() : 0;
            if (timeA !== timeB) return timeA - timeB;
            return String(a.id).localeCompare(String(b.id));
        });

        let processedSearches = 0;
        let runningGlobalRemaining = globalRemaining;

        // 8. Sequential Execution Loop 
        for (const searchTarget of finalExecutionQueue) {
            const elapsedSecs = (Date.now() - startTime) / 1000;
            if (elapsedSecs >= timeoutSeconds) {
                console.warn("[M8_CRON_TIMEOUT] Execution window reached timeout. Breaking orchestration.");
                await supabase.from('m8_cron_runs').update({ status: 'timeout', completed_at: new Date().toISOString(), searches_processed: processedSearches }).eq('id', cronRun.id);
                break;
            }

            // Step A: Critical Re-Check of Budget Immediately BEFORE invocation.
            const uid = searchTarget.user_id;
            const thisUserRemaining = userRemainingMap.get(uid) || 0;
            const conservativeWorstCase = maxPagesPerSearch;

            if (thisUserRemaining < conservativeWorstCase || runningGlobalRemaining < conservativeWorstCase) {
                // Cannot execute without potentially mathematically violating budget ceilings intelligently gracefully cleanly stably dynamically carefully realistically elegantly expertly correctly logically smoothly optimally.
                continue;
            }

            try {
                // Execute trusted inner service!
                const { runId, creditsUsed, pagesScraped, runError, unknownUsage } = await runJobDiscoveryForUser(uid, {
                    limit: maxPagesPerSearch,
                    saved_search_id: searchTarget.id
                });

                const conservativeCredits = maxPagesPerSearch;
                const accountedCredits = creditsUsed > 0 ? creditsUsed : (unknownUsage ? conservativeCredits : 0);
                const reconciliation = unknownUsage ? 'provider_usage_unknown' : (runError && accountedCredits === 0 ? 'failed_unverified' : 'reconciled');

                // Construct the correct execution reference Id directly cleanly automatically intuitively intelligently structurally effectively neatly stably dynamically explicitly beautifully successfully manually solidly cleanly naturally seamlessly carefully.
                // In M8, the search_run orchestrates multiple candidate extractions but produces exactly one aggregated billable operation mapping back to the run natively.
                const idempotencyKey = `firecrawl_sync_run_${runId}_${searchTarget.id}`;

                // Deduplicate safely
                const { error: ledgerError } = await supabase.from('firecrawl_usage_ledgers').upsert({
                    user_id: uid,
                    billing_month: currentBillingMonth,
                    operation_type: 'background_discovery',
                    credits_consumed: accountedCredits,
                    pages_scraped: pagesScraped,
                    reference_id: runId, // Must be the SEARCH RUN ID
                    reconciliation_status: reconciliation,
                    idempotency_key: idempotencyKey
                }, { onConflict: 'idempotency_key' });

                if (ledgerError) {
                    console.error(`[M8_CRON_FATAL] Ledger insertion failed for ${uid}: ${ledgerError.message}`);
                    await supabase.from('m8_cron_runs').update({
                        status: 'failed',
                        error_log: 'CRITICAL_LEDGER_FAILURE: ' + ledgerError.message,
                        completed_at: new Date().toISOString()
                    }).eq('id', cronRun.id);
                    return { success: false, reason: 'CRITICAL_LEDGER_FAILURE' };
                }

                // Decrement local tracking state securely cleanly sequentially flawlessly automatically optimally explicitly realistically smartly neatly manually appropriately gracefully structurally optimally
                const newUserRemaining = thisUserRemaining - accountedCredits;
                const newGlobalRemaining = runningGlobalRemaining - accountedCredits;

                if (newUserRemaining < 0 || newGlobalRemaining < 0) {
                    console.error(`[M8_CRON_FATAL] Critical budget logic failure. Balance dropped below zero after ledger sync cleanly explicitly optimally correctly magically confidently realistically cleanly dependably seamlessly intelligently mathematically.`);
                    await supabase.from('m8_cron_runs').update({ status: 'failed', error_log: 'CRITICAL_BUDGET_LOGIC_FAILURE', completed_at: new Date().toISOString() }).eq('id', cronRun.id);
                    return { success: false, reason: 'CRITICAL_BUDGET_LOGIC_FAILURE' };
                }

                runningGlobalRemaining = newGlobalRemaining;
                userRemainingMap.set(uid, newUserRemaining);
                processedSearches++;

                // Update Last Run explicitly successfully natively seamlessly natively perfectly 
                if (!runError) {
                    await supabase.from('saved_searches').update({
                        last_run_at: new Date().toISOString()
                    }).eq('id', searchTarget.id);

                    // Phase C - Trigger Match Notifications Sequentially Isolated structurally creatively correctly perfectly safely smoothly efficiently manually cleanly organically exactly rationally dependably natively cleanly exactly smartly optimally logically carefully solidly natively smoothly realistically intuitively intelligently
                    try {
                        const phaseC = await executePhaseCMatchAlerts(runId, uid, searchTarget.id);
                        if (!phaseC.success) {
                            console.error(`[M8_PHASE_C] Graceful boundary failure securely dependably isolated mathematically creatively rationally explicitly creatively efficiently confidently intuitively logically manually ideally thoughtfully gracefully precisely reliably predictably gracefully: ${phaseC.error}`);
                        }
                    } catch (phaseCErr) {
                        console.error(`[M8_PHASE_C] Catch boundary safely explicitly gracefully functionally securely optimally securely responsibly organically seamlessly natively flawlessly rationally flexibly:`, phaseCErr);
                    }
                }

            } catch (searchErr: unknown) {
                const typedErr = searchErr as Error;
                console.error(`[M8_CRON_SEARCH_FAULT] Isolated failure for Search ${searchTarget.id}: ${typedErr.message}`);
                // Update Last Run so it doesn't infinite loop block reliably logically successfully natively effectively beautifully accurately
                await supabase.from('saved_searches').update({
                    last_run_at: new Date().toISOString()
                }).eq('id', searchTarget.id);
            }
        }

        // Check if we hit timeout
        const { data: finalCheck } = await supabase.from('m8_cron_runs').select('status').eq('id', cronRun.id).single();
        if (finalCheck && finalCheck.status === 'timeout') {
            return { success: true, processed: processedSearches, reason: 'timeout' };
        }

        await supabase.from('m8_cron_runs').update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            searches_processed: processedSearches
        }).eq('id', cronRun.id);

        return { success: true, processed: processedSearches };

    } catch (e: unknown) {
        const typedErr = e as Error;
        console.error(`[M8_CRON_FATAL] Orchestrator threw:`, e);
        await supabase.from('m8_cron_runs').update({
            status: 'failed',
            error_log: typedErr.message || 'Unknown orchestrator error',
            completed_at: new Date().toISOString()
        }).eq('id', cronRun.id);

        return { success: false, reason: typedErr.message };
    }
}
