import { JobSourceAdapter } from './types';
import { FirecrawlAdapter } from './firecrawl-adapter';

/**
 * SourceAdapterRegistry establishes the fallback logic to route jobs to the correct adapter 
 * (ATS APIs in the future, currently just standard Firecrawl DOM scraping).
 */
export class SourceAdapterRegistry {
    private adapters: JobSourceAdapter[];

    constructor() {
        this.adapters = [
            new FirecrawlAdapter()
        ];
    }

    /**
     * Resolves the highest precedence adapter that is technologically capable of handling this specific source url.
     */
    getAdapterForSource(sourceUrl: string): JobSourceAdapter | null {
        for (const adapter of this.adapters) {
            if (adapter.canHandle(sourceUrl)) {
                return adapter;
            }
        }

        return null;
    }
}
