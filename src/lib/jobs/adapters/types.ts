export interface DiscoveredURL {
    url: string;
    sourceDomain: string;
}

export interface ExtractedJobData {
    title: string;
    company: string;
    description: string;
    url: string;
    contentHash: string;
    rawPayload: Record<string, unknown>;
}

export interface ExtractionResult {
    success: boolean;
    data?: ExtractedJobData;
    error?: string;
    creditsUsed?: number;
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
}
