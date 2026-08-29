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

/**
 * Parsed location, shaped to the EXISTING job_locations columns.
 *
 * No new schema: job_locations has carried country/state/city/region/
 * remote_allowed/remote_region since migration 003.
 */
export interface ParsedJobLocation {
    city: string | null;
    state: string | null;
    country: string | null;
    region: string | null;
    remote_allowed: boolean;
    remote_region: string | null;
}

/**
 * Countries recognised by name, so the LAST comma-separated token becomes a
 * country only when it actually is one.
 *
 * Bounded and static, matching how the codebase already handles skill
 * categories and role synonyms. A token absent from this list becomes a city
 * with country null — the parser never invents a country. Extending the list
 * is additive and safe.
 */
const COUNTRY_ALIASES: Record<string, string> = {
    'india': 'India',
    'united states': 'United States', 'usa': 'United States', 'us': 'United States',
    'u.s.': 'United States', 'u.s.a.': 'United States', 'america': 'United States',
    'united kingdom': 'United Kingdom', 'uk': 'United Kingdom',
    'great britain': 'United Kingdom', 'england': 'United Kingdom',
    'scotland': 'United Kingdom', 'wales': 'United Kingdom',
    'canada': 'Canada', 'australia': 'Australia', 'new zealand': 'New Zealand',
    'ireland': 'Ireland', 'germany': 'Germany', 'france': 'France',
    'spain': 'Spain', 'portugal': 'Portugal', 'italy': 'Italy',
    'netherlands': 'Netherlands', 'the netherlands': 'Netherlands',
    'belgium': 'Belgium', 'switzerland': 'Switzerland', 'austria': 'Austria',
    'poland': 'Poland', 'romania': 'Romania', 'czech republic': 'Czech Republic',
    'sweden': 'Sweden', 'norway': 'Norway', 'denmark': 'Denmark', 'finland': 'Finland',
    'singapore': 'Singapore', 'japan': 'Japan', 'china': 'China',
    'south korea': 'South Korea', 'philippines': 'Philippines',
    'indonesia': 'Indonesia', 'malaysia': 'Malaysia', 'vietnam': 'Vietnam',
    'thailand': 'Thailand', 'israel': 'Israel', 'turkey': 'Turkey',
    'united arab emirates': 'United Arab Emirates', 'uae': 'United Arab Emirates',
    'saudi arabia': 'Saudi Arabia', 'qatar': 'Qatar',
    'south africa': 'South Africa', 'nigeria': 'Nigeria', 'kenya': 'Kenya', 'egypt': 'Egypt',
    'brazil': 'Brazil', 'mexico': 'Mexico', 'argentina': 'Argentina',
    'chile': 'Chile', 'colombia': 'Colombia',
};

/** Multi-country areas that belong in `region`, not `country`. */
const REGION_NAMES: Record<string, string> = {
    'emea': 'EMEA', 'apac': 'APAC', 'latam': 'LATAM', 'nam': 'NAM',
    'europe': 'Europe', 'asia': 'Asia', 'africa': 'Africa',
    'north america': 'North America', 'south america': 'South America',
    'middle east': 'Middle East', 'european union': 'European Union', 'eu': 'European Union',
};

/** Values meaning "no geographic restriction" rather than a place. */
const WORLDWIDE_LOCATIONS = new Set([
    'worldwide', 'world wide', 'global', 'globally', 'anywhere',
    'work from anywhere', 'remote worldwide', 'any', 'any location',
]);

function normaliseKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function asCountry(token: string): string | null {
    return COUNTRY_ALIASES[normaliseKey(token)] ?? null;
}

function asRegion(token: string): string | null {
    return REGION_NAMES[normaliseKey(token)] ?? null;
}

const EMPTY_LOCATION: ParsedJobLocation = {
    city: null, state: null, country: null, region: null,
    remote_allowed: false, remote_region: null,
};

/**
 * Parse a free-text location into the job_locations columns.
 *
 * Nothing is invented. The last comma-separated token becomes `country` only
 * when it appears in the bounded dictionary above; otherwise it stays a city or
 * state. A bare "Bangalore" is therefore a CITY with an unknown country — the
 * previous implementation stored it as the country, which was simply wrong and
 * was observed in Production on 2026-08-29.
 *
 * Returns null when the input carries no usable geography, so no empty
 * job_locations row is ever created.
 */
export function parseLocation(raw: unknown): ParsedJobLocation | null {
    const text = optionalText(raw);
    if (!text) return null;

    const result: ParsedJobLocation = { ...EMPTY_LOCATION };

    // "Worldwide" / "Anywhere" express the ABSENCE of a restriction.
    if (WORLDWIDE_LOCATIONS.has(normaliseKey(text))) {
        return { ...result, remote_allowed: true, remote_region: 'Worldwide' };
    }

    // A leading remote marker, optionally followed by its scope:
    //   "Remote", "Remote - US only", "Remote — EMEA", "Remote, India"
    let body = text;
    const remoteMatch = /^remote\b\s*[-–—:,]?\s*(.*)$/i.exec(text);
    if (remoteMatch) {
        result.remote_allowed = true;
        const scope = remoteMatch[1].trim();
        if (!scope) return result;                       // bare "Remote"
        if (WORLDWIDE_LOCATIONS.has(normaliseKey(scope))) {
            return { ...result, remote_region: 'Worldwide' };
        }
        // Preserve the stated scope verbatim; never reshape it into a country.
        result.remote_region = scope;
        body = scope;
    }

    const parts = body.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) {
        return result.remote_allowed ? result : null;
    }

    const last = parts[parts.length - 1];
    const lastCountry = asCountry(last);
    const lastRegion = lastCountry ? null : asRegion(last);

    if (parts.length === 1) {
        if (lastCountry) result.country = lastCountry;
        else if (lastRegion) result.region = lastRegion;
        else result.city = last;                          // "Bangalore" → city
    } else {
        const head = parts.slice(0, -1);
        if (lastCountry || lastRegion) {
            if (lastCountry) result.country = lastCountry;
            else result.region = lastRegion;
            result.city = head[0];
            if (head.length > 1) result.state = head.slice(1).join(', ');
        } else {
            // No recognised country: treat the tail as a state/subdivision.
            result.city = head[0];
            result.state = parts.slice(1).join(', ');
        }
    }

    const hasGeography = Boolean(
        result.city || result.state || result.country || result.region ||
        result.remote_allowed || result.remote_region
    );

    return hasGeography ? result : null;
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
