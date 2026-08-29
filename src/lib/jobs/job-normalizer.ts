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
export type ValidatedJobInsert = z.infer<typeof InsertJobSchema> & {
    raw_content_hash?: string;
    canonical_url?: string;
    /** Parsed location. Not a jobs column — written to job_locations. */
    location?: ParsedJobLocation | null;
};

/** Work modes the jobs table accepts. Anything else degrades to 'unknown'. */
export type JobWorkMode = 'remote' | 'hybrid' | 'office' | 'unknown';

/**
 * Aliases seen in extracted postings and in our own UI, mapped onto the job
 * schema's domain.
 *
 * `in_office` is the value the preferences form has always submitted, while
 * jobs.work_mode uses `office` — so a user choosing "In Office" could never
 * match an office job. Normalising both spellings here fixes that mismatch at
 * the single point where work modes enter the system.
 */
const WORK_MODE_ALIASES: Record<string, JobWorkMode> = {
    remote: 'remote',
    'fully remote': 'remote',
    'work from home': 'remote',
    wfh: 'remote',
    telecommute: 'remote',
    hybrid: 'hybrid',
    flexible: 'hybrid',
    office: 'office',
    in_office: 'office',
    'in office': 'office',
    'in-office': 'office',
    onsite: 'office',
    'on-site': 'office',
    'on site': 'office',
};

/**
 * Map an extracted or user-supplied work mode onto the jobs schema domain.
 *
 * Unrecognised, absent or malformed input returns 'unknown' — never a guess and
 * never a value the schema would reject.
 */
export function normalizeWorkMode(raw: unknown): JobWorkMode {
    if (typeof raw !== 'string') return 'unknown';
    const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) return 'unknown';
    return WORK_MODE_ALIASES[key] ?? 'unknown';
}

/** Trimmed non-empty string, else null — an empty field is not a value. */
function optionalText(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export interface ParsedJobLocation {
    city: string | null;
    country: string | null;
}

/**
 * Split a free-text location into city/country on the last comma.
 *
 * Deliberately conservative: a single-token value is treated as the country and
 * nothing is inferred beyond what the posting wrote. Returns null when there is
 * no usable text, so no empty location row is ever created.
 */
export function parseLocation(raw: unknown): ParsedJobLocation | null {
    const text = optionalText(raw);
    if (!text) return null;

    const parts = text.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 1) return { city: null, country: parts[0] };

    return { city: parts.slice(0, -1).join(', '), country: parts[parts.length - 1] };
}

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
            // Work mode and remote scope now come from the extraction when the
            // posting stated them. Both degrade safely: an absent or
            // unrecognised work mode is 'unknown' exactly as before, and a
            // scope is only kept for a genuinely remote role, so a
            // country-restricted remote job is never mislabelled as worldwide
            // and a non-remote job never carries a scope at all.
            const workMode = normalizeWorkMode(extracted.workMode);
            const remoteScope = workMode === 'remote' ? optionalText(extracted.remoteScope) : null;

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
                work_mode: workMode,
                remote_scope: remoteScope
            };

            // Zod executes rigorous validation verifying exact mapped matches natively avoiding DB Rejects.
            const parsed = InsertJobSchema.parse(record);
            return {
                ...parsed,
                raw_content_hash: extracted.contentHash,
                canonical_url: canonicalUrl,
                // Not a jobs column — persisted separately into job_locations.
                location: parseLocation(extracted.location)
            };
        } catch (e) {
            console.error("Normalizer rejected job record entirely due to strict schema mismatch:", e);
            return null; // Silent catch - we drop the record.
        }
    }
}
