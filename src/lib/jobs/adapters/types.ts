export interface DiscoveredURL {
    url: string;
    sourceDomain: string;
    /**
     * Search-result metadata, when the provider supplied it.
     *
     * Both are OPTIONAL and additive: the legacy discover() path sets neither,
     * so it behaves exactly as before. They exist so the pre-extraction gate can
     * judge a candidate from data the search call already returned and already
     * paid for — reading them costs no extra request and no extra credit.
     *
     * Absent means "the provider said nothing", never "the posting lacks this".
     */
    title?: string;
    snippet?: string;
}

export interface ExtractedJobData {
    title: string;
    company: string;
    description: string;
    url: string;
    contentHash: string;
    rawPayload: Record<string, unknown>;
    /**
     * Work arrangement as stated by the posting. Absent when the provider did
     * not return one — the normalizer then falls back to 'unknown' rather than
     * guessing.
     */
    workMode?: string;
    /** Primary place of work as written in the posting, if stated. */
    location?: string;
    /**
     * Eligibility scope for a remote role, verbatim (e.g. "Worldwide",
     * "US only"). Only meaningful when workMode is remote; never inferred.
     */
    remoteScope?: string;
}

export interface ExtractionResult {
    success: boolean;
    data?: ExtractedJobData;
    error?: string;
    creditsUsed?: number;
}

export interface SearchOptions {
    /**
     * Allow-listed hostnames. REQUIRED and non-empty. Enforced by the provider
     * server-side where supported, and re-validated client-side regardless.
     * This preserves the M2.2 cross-domain boundary: arbitrary web results are
     * never accepted.
     */
    includeDomains: string[];
    /** Maximum results to request. Bounds credit spend. */
    limit: number;
}

export interface JobSourceAdapter {
    /**
     * Determines whether this adapter is technologically and securely capable 
     * of managing the given source
     */
    canHandle(sourceUrl: string): boolean;

    /**
     * Finds and isolates valid candidate Job URLs from a parent domain mapping 
     */
    discover(sourceUrl: string, maxLimit?: number): Promise<DiscoveredURL[]>;

    /**
     * Fetches, strips, and formats data from a concrete job posting
     */
    extract(jobUrl: string): Promise<ExtractionResult>;

    /**
     * Optional: find candidate job URLs matching a query, restricted to the
     * supplied allow-listed domains. Adapters without search capability simply
     * omit this method; callers must feature-detect.
     */
    searchJobs?(query: string, options: SearchOptions): Promise<DiscoveredURL[]>;
}
