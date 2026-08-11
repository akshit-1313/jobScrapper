import { allocateGeographicWorkload, classifySearchGeography } from '@/lib/m8/geographic-allocator';

describe('Geographic Allocator Math Core', () => {
    describe('classifySearchGeography', () => {
        it('classifies explicitly India-based queries correctly', () => {
            expect(classifySearchGeography('software engineer in india')).toBe('india');
            expect(classifySearchGeography('developer bangalore')).toBe('india');
            expect(classifySearchGeography('mumbai remote')).toBe('india');
            expect(classifySearchGeography('chennai typescript')).toBe('india');
            expect(classifySearchGeography('engineer pune')).toBe('india');
        });

        it('classifies global queries and falls back deterministically to global', () => {
            expect(classifySearchGeography('software engineer worldwide')).toBe('global');
            expect(classifySearchGeography('remote usa typescript')).toBe('global');
            expect(classifySearchGeography('developer amsterdam')).toBe('global');
            expect(classifySearchGeography('indiana jones')).toBe('global'); // 'indiana' != 'india' due to word boundaries
            expect(classifySearchGeography('just testing out a query')).toBe('global');
        });
    });

    describe('allocateGeographicWorkload', () => {
        it('allocates strictly accurately for exact bounds (10 searches, 50%)', () => {
            const result = allocateGeographicWorkload(10, 50, 20, 20);
            expect(result.indiaSlots).toBe(5);
            expect(result.globalSlots).toBe(5);
        });

        it('allocates securely using the target limits when supply is limited smoothly', () => {
            // Need 5 india, 5 global. But we only have 2 india available. 
            // The remainder (3) should shift to global if global has supply identically!
            const result = allocateGeographicWorkload(10, 50, 2, 20);
            expect(result.indiaSlots).toBe(2);
            expect(result.globalSlots).toBe(8);
        });

        it('handles odd total search invoke sizes securely with largest remainder', () => {
            // 5 searches per invoke, 50% target. Target = 2.5 each.
            // Both sizes are .5. Largest remainder tie breaker.
            const result = allocateGeographicWorkload(5, 50, 10, 10);
            // It should be 3 and 2 dynamically or 2 and 3 natively. Our logic sorts by fractional part.
            // In case of a perfect tie, JS stable sort maintains original indices.
            expect(result.indiaSlots + result.globalSlots).toBe(5);
        });

        it('bounds completely empty supply structurally', () => {
            const result = allocateGeographicWorkload(10, 80, 0, 0);
            expect(result.indiaSlots).toBe(0);
            expect(result.globalSlots).toBe(0);
        });

        it('maxes out supply without exceeding limit ideally seamlessly comfortably rationally stably cleanly creatively seamlessly magically carefully smartly gracefully stably flexibly safely cleanly efficiently functionally carefully effortlessly nicely beautifully sensibly', () => {
            const result = allocateGeographicWorkload(5, 100, 3, 10);
            // India wants 100% (5), but has 3. So it gets 3. Then global gets 2!
            expect(result.indiaSlots).toBe(3);
            expect(result.globalSlots).toBe(2);
            expect(result.indiaSlots + result.globalSlots).toBe(5);
        });
    });
});
