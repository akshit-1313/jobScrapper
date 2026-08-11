import { z } from "zod";

// Job Source Types
export const SourceTypeSchema = z.enum([
    'company_careers',
    'ats',
    'job_board',
    'search_engine',
    'recruiter',
    'other'
]);

export const JobSourceSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    domain: z.string().nullable().optional(),
    source_type: SourceTypeSchema,
    base_url: z.string().nullable().optional(),
    active: z.boolean(),
    priority: z.number().int().min(1).max(10),
    crawl_frequency: z.string().nullable().optional(),
    last_crawled_at: z.string().nullable().optional(),
    crawl_status: z.string().nullable().optional(),
    restriction_notes: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string()
});

export type JobSource = z.infer<typeof JobSourceSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;

// Crawl Run Types
export const CrawlRunSchema = z.object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    source_id: z.string().uuid().nullable().optional(),
    search_run_id: z.string().uuid().nullable().optional(),
    url: z.string().url(),
    status: z.string(), // Extracted directly as string, usually 'pending', etc.
    result_status: z.string().nullable().optional(),
    extraction_status: z.string().nullable().optional(),
    error_message: z.string().nullable().optional(),
    content_hash: z.string().nullable().optional(),
    started_at: z.string(),
    completed_at: z.string().nullable().optional(),
    created_at: z.string()
});

export type CrawlRun = z.infer<typeof CrawlRunSchema>;

// Search Run Types (Where Statistics Reside)
export const SearchRunSchema = z.object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    saved_search_id: z.string().uuid().nullable().optional(),
    search_params: z.record(z.string(), z.unknown()).nullable().optional(), // JSONB
    sources_searched: z.number().int().nullable().optional(),
    jobs_discovered: z.number().int().nullable().optional(),
    jobs_created: z.number().int().nullable().optional(),
    jobs_updated: z.number().int().nullable().optional(),
    duplicates_found: z.number().int().nullable().optional(),
    failures: z.number().int().nullable().optional(),
    errors: z.array(z.unknown()).nullable().optional(), // JSONB
    started_at: z.string(),
    completed_at: z.string().nullable().optional(),
    created_at: z.string()
});

export type SearchRun = z.infer<typeof SearchRunSchema>;

// Input Types for Services
export type CreateJobSourceInput = Omit<JobSource, 'id' | 'created_at' | 'updated_at'>;
export type CreateCrawlRunInput = Pick<CrawlRun, 'user_id' | 'source_id' | 'search_run_id' | 'url'>;
export type CreateSearchRunInput = Pick<SearchRun, 'saved_search_id' | 'search_params'>;
