export interface WorkloadTarget {
    indiaSlots: number;
    globalSlots: number;
}

export function allocateGeographicWorkload(
    totalSlots: number,
    indiaPercent: number,
    eligibleIndiaSearches: number,
    eligibleGlobalSearches: number
): WorkloadTarget {
    // 1. Base proportional allocation (Largest Remainder method)
    const indiaFrac = totalSlots * (indiaPercent / 100);
    const globalFrac = totalSlots * ((100 - indiaPercent) / 100);

    let baseIndia = Math.floor(indiaFrac);
    let baseGlobal = Math.floor(globalFrac);

    // Remaining fractional slots
    let remaining = totalSlots - (baseIndia + baseGlobal);
    if (remaining > 0) {
        if (indiaFrac - baseIndia >= globalFrac - baseGlobal) {
            baseIndia++;
            remaining--;
        }
        if (remaining > 0) {
            baseGlobal++;
        }
    }

    let allocatedIndia = baseIndia;
    let allocatedGlobal = baseGlobal;

    // 2. Transfer unused capacity
    if (allocatedIndia > eligibleIndiaSearches) {
        const excess = allocatedIndia - eligibleIndiaSearches;
        allocatedIndia = eligibleIndiaSearches;
        allocatedGlobal += excess;
    } else if (allocatedGlobal > eligibleGlobalSearches) {
        const excess = allocatedGlobal - eligibleGlobalSearches;
        allocatedGlobal = eligibleGlobalSearches;
        allocatedIndia += excess;
    }

    // Safety caps based on available total inventory
    allocatedIndia = Math.min(allocatedIndia, eligibleIndiaSearches);
    allocatedGlobal = Math.min(allocatedGlobal, eligibleGlobalSearches);

    return {
        indiaSlots: allocatedIndia,
        globalSlots: allocatedGlobal
    };
}

/**
 * Deterministically classifies a search phrase using predefined India vs Global maps.
 * Ambiguous queries immediately fallback to global. 
 */
export function classifySearchGeography(query: string): 'india' | 'global' {
    if (!query) return 'global';

    const normalized = query.toLowerCase();

    const indiaTokens = [
        'india', 'mumbai', 'delhi', 'bangalore', 'bengaluru',
        'pune', 'hyderabad', 'chennai', 'kolkata', 'ahmedabad',
        'gurgaon', 'gurugram', 'noida'
    ];

    // Check if the query contains any exact India token bound by word boundaries
    // Since search phrases could be "manager india", we use a rudimentary word inclusion.
    const words = normalized.split(/[^a-z0-9]+/);
    const hasIndia = indiaTokens.some(token => words.includes(token));

    return hasIndia ? 'india' : 'global';
}
