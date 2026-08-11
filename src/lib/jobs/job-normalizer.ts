import { ExtractedJobData } from './adapters/types';
import { JobSource } from './job-source-types'; // Keep import clean
import { z } from 'zod';
import { JobSchema } from '../types/jobs';

/**
 * JobNormalizer orchestrates mapping from arbitrary DOM extractions strictly back to the 
 * existing PostgreSQL jobs entity fields without inventing artificial database columns.
 */

// Construct a limited Insertable subset mirroring the valid canonical schema constraints precisely
const InsertJobSchema = JobSchema.omit({ id: true });
export type ValidatedJobInsert = z.infer<typeof InsertJobSchema> & { raw_content_hash?: string; canonical_url?: string };

export class JobNormalizer {
    /**
     * Re-formats raw proxy extracted attributes safely against the database bounds
     */
    static normalize(extracted: ExtractedJobData, sourceDomain?: string): ValidatedJobInsert | null {
        try {
            // Cleanup Whitespace natively
            const cleanTitle = extracted.title.trim().replace(/\s+/g, ' ');
            const cleanCompany = extracted.company.trim().replace(/\s+/g, ' ');

            // Build the string-matched canonical hash mapping
            // Note: Jobs table sets `canonical_id` as UNIQUE. 
            // We combine external Domain mapped URL deterministic patterns to resolve Upsert tracking safely mapped.
            const urlParts = new URL(extracted.url);
            // Ignore query params which often include unpredictable tracking fragments 
            // EXCEPT for sources where the exact param designates the job ID. 
            // We'll trust the full URL for now but clean URL hashes will be better.
            const canonicalUrl = `${urlParts.protocol}//${urlParts.host}${urlParts.pathname}`;
            const generatedCanonicalId = `${cleanCompany}-${cleanTitle}-${canonicalUrl.substring(0, 30)}`
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-');

            // Evaluate valid fields. Using `unknown` as all Enums per schema strict restrictions.
            // Currently, Firecrawl doesn't natively glean salary without AI embeddings safely. We leave them absent.
            const record = {
                canonical_id: generatedCanonicalId,
                canonical_url: canonicalUrl,
                job_url: extracted.url,
                title: cleanTitle,
                normalized_title: cleanTitle.toLowerCase(),
                company_name: cleanCompany,
                description: extracted.description.trim(),
                raw_content_hash: extracted.contentHash,
                discovered_at: new Date().toISOString(),
                status: 'discovered' as const,
                employment_type: 'unknown' as const,
                work_mode: 'unknown' as const
            };

            // Zod executes rigorous validation verifying exact mapped matches natively avoiding DB Rejects.
            const parsed = InsertJobSchema.parse(record);
            return {
                ...parsed,
                raw_content_hash: extracted.contentHash,
                canonical_url: canonicalUrl
            };
        } catch (e) {
            console.error("Normalizer rejected job record entirely due to strict schema mismatch:", e);
            return null; // Silent catch - we drop the record.
        }
    }
}
