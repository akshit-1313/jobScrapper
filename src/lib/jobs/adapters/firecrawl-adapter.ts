import { createHash } from 'crypto';
import FirecrawlApp from '@mendable/firecrawl-js';
import { JobSourceAdapter, DiscoveredURL, ExtractionResult, SearchOptions } from './types';

/**
 * Recursively serialises a value to a stable JSON string where every plain
 * object's keys are sorted alphabetically at every nesting level.
 * Arrays preserve their original element order.
 *
 * This implementation is deterministic for JSON-compatible values (arrays,
 * objects, primitives, null). It is explicitly not a full drop-in replacement
 * for JSON.stringify for unsupported JS values (e.g. Map, Set, function, Date).
 * Because Firecrawl API responses are strictly JSON-parseable objects, this
 * handles all expected payloads predictably without overengineering unsupported types.
 */
export function stableStringify(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).join(',') + ']';
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const sortedKeys = Object.keys(obj).sort();
        const pairs = sortedKeys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k]));
        return '{' + pairs.join(',') + '}';
    }
    // Firecrawl API JSON-compatible inputs are the only supported domain.
    // Explicitly fallback to 'null' for unsupported JS values (undefined, function, symbol). 
    return 'null';
}

// The adapter ensures we do not leak generic Firecrawl imports or keys into the rest of the app.
// ── Search rate limiting ────────────────────────────────────────────────────
//
// Firecrawl enforces a per-minute request ceiling. A live run previously fired
// 30 sequential search calls inside one window and 20 returned
// "Rate limit exceeded".
//
// The gate below serializes AND spaces every search request. It is module-level
// on purpose: two overlapping discovery runs in the same process share one
// chain, so concurrency cannot defeat the spacing.
//
// NOTE: this is per-process. It does not coordinate across separate server
// instances — the source cap in discovery-service is what keeps a single run
// comfortably inside the budget.

export const DEFAULT_SEARCH_REQUESTS_PER_MINUTE = 10;

/** Configurable without touching the adapter: FIRECRAWL_SEARCH_RPM. */
export function getSearchRequestsPerMinute(): number {
    const raw = process.env.FIRECRAWL_SEARCH_RPM;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return DEFAULT_SEARCH_REQUESTS_PER_MINUTE;
}

/** Minimum milliseconds between two search requests. */
export function minSearchSpacingMs(): number {
    return Math.ceil(60_000 / getSearchRequestsPerMinute());
}

let searchChain: Promise<void> = Promise.resolve();
let lastSearchAt = 0;

/** Test seam — resets the shared gate between cases. */
export function __resetSearchRateGate(): void {
    searchChain = Promise.resolve();
    lastSearchAt = 0;
}

/**
 * Wait for a slot in the shared search-rate budget.
 *
 * Every caller queues on one promise chain, so requests are strictly ordered
 * and separated by at least `minSearchSpacingMs()`. This throttles; it never
 * retries a rejected request.
 */
async function acquireSearchSlot(): Promise<void> {
    const spacing = minSearchSpacingMs();

    const slot = searchChain.then(async () => {
        const waitMs = lastSearchAt + spacing - Date.now();
        if (waitMs > 0) {
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
        lastSearchAt = Date.now();
    });

    // Keep the chain alive even if a caller throws downstream.
    searchChain = slot.catch(() => undefined);
    return slot;
}

function isBlank(value: unknown): boolean {
    return typeof value !== 'string' || value.trim().length === 0;
}

/**
 * Accept a non-empty string, otherwise undefined.
 *
 * The extractor is instructed to return an empty string when a field is not
 * stated, so an empty value must NOT become a persisted value.
 */
function asOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * True when an extraction carries enough signal to be a real job posting.
 *
 * Aggregator and listing pages scrape successfully but yield nothing: the
 * extractor is instructed to return empty strings when a page is not a job
 * posting, and those empties were previously defaulted to
 * "Unknown Title" / "Unknown Company" and persisted as real jobs.
 *
 * The bar is deliberately low — ANY of title, company or description being
 * present is enough — so partial-but-genuine postings still pass. Only a
 * completely empty extraction is rejected.
 */
export function hasUsableJobData(payload: {
    title?: unknown; company?: unknown; description?: unknown;
}): boolean {
    return !(isBlank(payload.title) && isBlank(payload.company) && isBlank(payload.description));
}

export class FirecrawlAdapter implements JobSourceAdapter {
    private app: FirecrawlApp;

    constructor() {
        const apiKey = process.env.FIRECRAWL_API_KEY;
        if (!apiKey) {
            throw new Error("FIRECRAWL_API_KEY is not configured.");
        }
        this.app = new FirecrawlApp({ apiKey });
    }

    canHandle(sourceUrl: string): boolean {
        return sourceUrl.startsWith('http');
    }

    async discover(sourceUrl: string, maxLimit = 10): Promise<DiscoveredURL[]> {
        try {
            const mapResult = await (this.app.mapUrl(sourceUrl, {
                limit: maxLimit
            }) as Promise<unknown>);

            // Runtime guard: reject null, primitives, and arrays before casting
            if (
                mapResult === null ||
                mapResult === undefined ||
                typeof mapResult !== 'object' ||
                Array.isArray(mapResult)
            ) {
                console.error(`[FirecrawlAdapter] discover: unexpected response type for ${sourceUrl}:`, typeof mapResult);
                return [];
            }
            const resultObj = mapResult as Record<string, unknown>;

            if (resultObj && resultObj.success === false) {
                const errMsg = typeof resultObj.error === 'string' ? resultObj.error : 'Unknown map failure';
                console.error(`[FirecrawlAdapter] discover mapping failed for ${sourceUrl}:`, errMsg);
                return [];
            }

            // Validate that links is actually an array before using it
            // Safe to check directly as resultObj is known to be an object
            const rawLinks: unknown = resultObj.links ?? [];
            if (!Array.isArray(rawLinks)) {
                console.error(`[FirecrawlAdapter] discover: mapResult.links is not an array for ${sourceUrl}`);
                return [];
            }

            const discovered: DiscoveredURL[] = [];
            for (const l of rawLinks) {
                const urlStr = typeof l === 'string' ? l : (l != null ? String(l) : null);
                if (!urlStr) continue;

                let domainHostname: string;
                try {
                    domainHostname = new URL(urlStr).hostname;
                } catch {
                    // Malformed URL — skip this link rather than crashing discovery
                    console.warn(`[FirecrawlAdapter] discover: skipping malformed URL: ${urlStr}`);
                    continue;
                }

                discovered.push({ url: urlStr, sourceDomain: domainHostname });
            }

            return discovered;

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[FirecrawlAdapter] discover threw error for ${sourceUrl}:`, msg);
            return [];
        }
    }

    /**
     * Query-driven discovery, restricted to allow-listed domains.
     *
     * The domain restriction is applied TWICE by design:
     *   1. server-side via Firecrawl's `includeDomains`, so off-list results are
     *      never returned and never billed;
     *   2. client-side below, because a provider response is never trusted to
     *      have honoured the constraint.
     *
     * This preserves the M2.2 cross-domain boundary — `isDomainAllowed` in the
     * discovery service still runs downstream and is not weakened.
     */
    async searchJobs(query: string, options: SearchOptions): Promise<DiscoveredURL[]> {
        // An empty allow-list must never mean "search the whole web".
        if (!options.includeDomains || options.includeDomains.length === 0) {
            console.error('[FirecrawlAdapter] searchJobs refused: empty domain allow-list');
            return [];
        }

        const limit = Math.max(1, Math.min(options.limit ?? 5, 20));

        // Throttle before every outbound search. Never retries — a rate-limited
        // request still degrades to [] via the catch below.
        await acquireSearchSlot();

        try {
            const response = await (this.app.search(query, {
                limit,
                sources: ['web'],
                includeDomains: options.includeDomains,
            }) as Promise<unknown>);

            if (response === null || response === undefined || typeof response !== 'object' || Array.isArray(response)) {
                console.error('[FirecrawlAdapter] searchJobs: unexpected response type:', typeof response);
                return [];
            }

            const webResults: unknown = (response as Record<string, unknown>).web ?? [];
            if (!Array.isArray(webResults)) {
                console.error('[FirecrawlAdapter] searchJobs: response.web is not an array');
                return [];
            }

            const allowed = new Set(options.includeDomains.map(d => d.toLowerCase()));
            const discovered: DiscoveredURL[] = [];
            const seen = new Set<string>();

            for (const item of webResults) {
                if (!item || typeof item !== 'object') continue;
                const urlStr = (item as Record<string, unknown>).url;
                if (typeof urlStr !== 'string' || !urlStr) continue;

                let hostname: string;
                try {
                    hostname = new URL(urlStr).hostname.toLowerCase();
                } catch {
                    console.warn('[FirecrawlAdapter] searchJobs: skipping malformed URL');
                    continue;
                }

                // Client-side re-validation: exact host or a subdomain of an allowed host.
                const permitted = [...allowed].some(
                    d => hostname === d || hostname.endsWith(`.${d}`)
                );
                if (!permitted) {
                    console.warn(`[FirecrawlAdapter] searchJobs: rejected off-allow-list host ${hostname}`);
                    continue;
                }

                if (seen.has(urlStr)) continue;
                seen.add(urlStr);

                // SearchResultWeb also carries title and description. They were
                // previously discarded; keeping them lets the pre-extraction
                // gate reject an obvious non-posting without a second request.
                const rec = item as Record<string, unknown>;
                const asText = (v: unknown): string | undefined =>
                    typeof v === 'string' && v.trim().length > 0 ? v : undefined;

                discovered.push({
                    url: urlStr,
                    sourceDomain: hostname,
                    title: asText(rec.title),
                    snippet: asText(rec.description),
                });
            }

            // Observability for credit accounting: how many results the provider
            // returned vs how many survived allow-list validation.
            console.log(
                `[FirecrawlAdapter] searchJobs done raw=${webResults.length} ` +
                `accepted=${discovered.length} rejected=${webResults.length - discovered.length}`
            );

            return discovered;

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[FirecrawlAdapter] searchJobs threw error:', msg);
            return [];
        }
    }

    async extract(jobUrl: string): Promise<ExtractionResult> {
        try {
            const prompt = `Extract the exact details of this job posting. Format strictly into JSON with NO OTHER TEXT containing exactly: title, company, description, workMode, location, remoteScope, rawPayload (any other unmapped metadata detected). ` +
                `workMode must be one of "remote", "hybrid", "office" or "unknown" — use "unknown" if the posting does not say. ` +
                `location is the primary place of work as written in the posting (e.g. "Bengaluru, India"), or an empty string if none is stated. ` +
                `remoteScope applies only when workMode is "remote": copy the stated eligibility (e.g. "Worldwide", "US only", "India only", "EMEA"), or an empty string if the posting does not state one. Never guess a scope. ` +
                `If it's not a job posting, return empty strings.`;

            // Firecrawl v2 request shape (@mendable/firecrawl-js v4):
            //   formats: [{ type: 'json', prompt, schema }]
            //
            // The former v1 shape (formats: ['extract'] + a sibling `extract`
            // object) is rejected by the v2 endpoint with
            // "Unrecognized key in body", which failed every extraction.
            const scrapeResult = await (this.app.scrape(jobUrl, {
                formats: [{
                    type: 'json',
                    prompt,
                    schema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            company: { type: 'string' },
                            description: { type: 'string' },
                            // Additive: absent or unrecognised values degrade to
                            // 'unknown' / null in the normalizer, so a provider
                            // that omits them behaves exactly as before.
                            workMode: { type: 'string' },
                            location: { type: 'string' },
                            remoteScope: { type: 'string' },
                            rawPayload: { type: 'object' }
                        },
                        required: ['title', 'company', 'description']
                    }
                }],
            }) as Promise<unknown>);

            const resultObj = scrapeResult as Record<string, unknown>;

            // v2 scrape() resolves to a Document and throws on failure, but a
            // v1-style error envelope is still tolerated defensively.
            if (resultObj && resultObj.success === false) {
                const errMsg = typeof resultObj.error === 'string' ? resultObj.error : 'Unknown firecrawl extraction failure';
                return { success: false, error: errMsg };
            }

            // v2 returns the structured result on `json`. `extract` / `data` are
            // accepted as fallbacks so a v1-shaped response still parses.
            const rawExtract: unknown = resultObj?.json ?? resultObj?.extract ?? resultObj?.data;
            type ExtractPayload = {
                title?: string; company?: string; description?: string;
                workMode?: unknown; location?: unknown; remoteScope?: unknown;
                rawPayload?: unknown;
            };
            const payload: ExtractPayload =
                rawExtract !== null && typeof rawExtract === 'object' && !Array.isArray(rawExtract)
                    ? (rawExtract as ExtractPayload)
                    : {};

            const metadataPayload = resultObj?.metadata as Record<string, unknown> | undefined;
            const actualCreditsUsed = metadataPayload?.creditsUsed as number | undefined;

            // Validation gate: reject a non-job page BEFORE any placeholder is
            // manufactured, so it can never reach JobNormalizer or the jobs table.
            // Reuses the existing ExtractionResult failure channel, which
            // discovery-service already handles via markCrawlRunFailed.
            if (!hasUsableJobData(payload)) {
                return {
                    success: false,
                    creditsUsed: actualCreditsUsed,
                    error: 'Invalid extraction: no job data found (title, company and description all empty) — likely a listing or aggregator page, not a job posting',
                };
            }

            // Normalize rawPayload: only accept a plain object, otherwise fall back to {}
            const rawPayloadNorm: Record<string, unknown> =
                payload.rawPayload !== null &&
                    typeof payload.rawPayload === 'object' &&
                    !Array.isArray(payload.rawPayload)
                    ? (payload.rawPayload as Record<string, unknown>)
                    : {};

            // SHA-256 content hash over a stable (sorted-keys) JSON representation
            const stablePayload = {
                title: payload.title ?? '',
                company: payload.company ?? '',
                description: payload.description ?? '',
                rawPayload: rawPayloadNorm,
            };
            const contentHash = createHash('sha256')
                .update(stableStringify(stablePayload))
                .digest('hex');

            return {
                success: true,
                creditsUsed: actualCreditsUsed,
                data: {
                    title: payload.title || 'Unknown Title',
                    company: payload.company || 'Unknown Company',
                    description: payload.description || '',
                    url: jobUrl,
                    contentHash,
                    // Passed through verbatim; the normalizer validates them
                    // against the jobs schema and falls back safely.
                    workMode: asOptionalString(payload.workMode),
                    location: asOptionalString(payload.location),
                    remoteScope: asOptionalString(payload.remoteScope),
                    rawPayload: rawPayloadNorm,
                }
            };

        } catch (e: unknown) {
            const errStr = e instanceof Error ? e.message : String(e);
            return {
                success: false,
                error: `Adapter Exception: ${errStr}`
            };
        }
    }
}
