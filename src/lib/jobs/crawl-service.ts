import { createAdminClient } from '@/lib/supabase/admin';
import { CrawlRun, SearchRun } from './job-source-types';

/**
 * Service for interacting with Crawl Runs and Search Runs.
 * 
 * Note on RLS (Row Level Security):
 * The database strictly limits authenticated users to READ-ONLY on their own 
 * `crawl_runs` and `search_runs`. Any INSERT/UPDATE operations MUST be performed 
 * via a service-role (admin) client. This is a system-level operation.
 */

// ==========================================
// CRAWL RUNS (Individual page/source crawls)
// ==========================================

export async function createCrawlRun(
    runData: {
        user_id: string;
        source_id?: string;
        search_run_id?: string;
        url: string;
    }
): Promise<CrawlRun> {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
        .from('crawl_runs')
        .insert({
            ...runData,
            status: 'pending'
        })
        .select()
        .single();

    if (error) {
        throw new Error(`Failed to create crawl run: ${error.message}`);
    }

    return data as CrawlRun;
}

export async function markCrawlRunRunning(
    crawlRunId: string
): Promise<CrawlRun> {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
        .from('crawl_runs')
        .update({ status: 'running' })
        .eq('id', crawlRunId)
        .select()
        .single();

    if (error) {
        throw new Error(`Failed to update crawl run to running: ${error.message}`);
    }

    return data as CrawlRun;
}

export async function markCrawlRunCompleted(
    crawlRunId: string,
    resultData?: {
        result_status?: string;
        content_hash?: string;
        extraction_status?: string;
    }
): Promise<CrawlRun> {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
        .from('crawl_runs')
        .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            ...resultData
        })
        .eq('id', crawlRunId)
        .select()
        .single();

    if (error) {
        throw new Error(`Failed to complete crawl run: ${error.message}`);
    }

    return data as CrawlRun;
}

export async function markCrawlRunFailed(
    crawlRunId: string,
    errorMessage: string
): Promise<CrawlRun> {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
        .from('crawl_runs')
        .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: errorMessage,
            result_status: 'error'
        })
        .eq('id', crawlRunId)
        .select()
        .single();

    if (error) {
        throw new Error(`Failed to fail crawl run: ${error.message}`);
    }

    return data as CrawlRun;
}

// ==========================================
// SEARCH RUNS (Tracks higher-level discovery executions, owns the metrics)
// ==========================================

export async function createSearchRun(
    runData: {
        user_id: string;
        saved_search_id?: string;
        search_params?: Record<string, unknown>;
    }
): Promise<SearchRun> {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
        .from('search_runs')
        .insert(runData)
        .select()
        .single();

    if (error) {
        throw new Error(`Failed to create search run: ${error.message}`);
    }

    return data as SearchRun;
}

export async function completeSearchRunWithStats(
    searchRunId: string,
    stats: {
        sources_searched?: number;
        jobs_discovered?: number;
        jobs_created?: number;
        jobs_updated?: number;
        duplicates_found?: number;
        failures?: number;
        errors?: unknown[];
    }
): Promise<SearchRun> {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
        .from('search_runs')
        .update({
            ...stats,
            completed_at: new Date().toISOString()
        })
        .eq('id', searchRunId)
        .select()
        .single();

    if (error) {
        throw new Error(`Failed to complete search run with stats: ${error.message}`);
    }

    return data as SearchRun;
}
