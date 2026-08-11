import { createHash } from 'crypto';
import FirecrawlApp from '@mendable/firecrawl-js';
import { JobSourceAdapter, DiscoveredURL, ExtractionResult } from './types';

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

    async extract(jobUrl: string): Promise<ExtractionResult> {
        try {
            const prompt = `Extract the exact details of this job posting. Format strictly into JSON with NO OTHER TEXT containing exactly: title, company, description, rawPayload (any other unmapped metadata detected). If it's not a job posting, return empty strings.`;

            const scrapeResult = await (this.app.scrapeUrl(jobUrl, {
                formats: ['extract'],
                extract: {
                    prompt,
                    schema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            company: { type: 'string' },
                            description: { type: 'string' },
                            rawPayload: { type: 'object' }
                        },
                        required: ['title', 'company', 'description']
                    }
                },
            } as unknown as Record<string, unknown>) as Promise<unknown>);

            const resultObj = scrapeResult as Record<string, unknown>;

            if (resultObj && resultObj.success === false) {
                const errMsg = typeof resultObj.error === 'string' ? resultObj.error : 'Unknown firecrawl extraction failure';
                return { success: false, error: errMsg };
            }

            // Validate the extracted payload is actually an object
            const rawExtract: unknown = resultObj?.extract ?? resultObj?.data;
            const payload: { title?: string; company?: string; description?: string; rawPayload?: unknown } =
                rawExtract !== null && typeof rawExtract === 'object' && !Array.isArray(rawExtract)
                    ? (rawExtract as { title?: string; company?: string; description?: string; rawPayload?: unknown })
                    : {};

            const metadataPayload = resultObj?.metadata as Record<string, unknown> | undefined;
            const actualCreditsUsed = metadataPayload?.creditsUsed as number | undefined;

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
