/**
 * @jest-environment node
 */

/**
 * Generic role rotation.
 *
 * The engine must not know what profession it is searching for. A user who
 * changes career should only have to change Search Parameters, so almost every
 * fixture here is deliberately abstract (A/B/C/D, Alpha/Beta) and the concrete
 * professions that do appear — Salesforce, Java, product management, nursing —
 * are ordinary interchangeable examples, never special cases in the algorithm.
 *
 * The property under test is that no explicitly listed role can be starved: not
 * by a synonym of an earlier role, and not by simply sitting past the query
 * limit. Nothing here calls Firecrawl or touches a database.
 */
import {
    buildSearchStrategies,
    selectTitles,
    normaliseRotationOffset,
    advanceRotationOffset,
    type StrategyInput,
} from '@/lib/jobs/profile-search-strategy';

const MANUAL_QUERIES = 3;
const SCHEDULED_QUERIES = 2;

/** A profile with no signal of its own, so tests isolate the role list. */
function input(roles: string[], extra: Partial<StrategyInput> = {}): StrategyInput {
    return {
        profile: null,
        skills: [],
        experience: [],
        engagements: [],
        preferences: { desired_roles: roles },
        ...extra,
    } as StrategyInput;
}

/** Titles chosen for one run, lower-cased by the builder. */
function titlesFor(roles: string[], k: number, offset: number): string[] {
    return selectTitles(input(roles), k, offset).titles;
}

/**
 * Walk the rotation the way production does: select, then advance by what was
 * consumed. Returns one entry per run.
 */
function simulate(roles: string[], k: number, runs: number): string[][] {
    let offset = 0;
    const out: string[][] = [];
    for (let i = 0; i < runs; i++) {
        const { titles, rolesConsumed } = selectTitles(input(roles), k, offset);
        out.push(titles);
        offset = advanceRotationOffset(offset, rolesConsumed, roles.length);
    }
    return out;
}

describe('Offset normalisation', () => {
    it('is identity inside the range', () => {
        expect(normaliseRotationOffset(0, 4)).toBe(0);
        expect(normaliseRotationOffset(3, 4)).toBe(3);
    });

    it('wraps an offset at or past the end — a shrunken list needs no reset', () => {
        expect(normaliseRotationOffset(4, 4)).toBe(0);
        expect(normaliseRotationOffset(9, 4)).toBe(1);
        // Five roles rotated to position 4, then two were removed.
        expect(normaliseRotationOffset(4, 3)).toBe(1);
    });

    it('folds a negative offset into range rather than throwing', () => {
        expect(normaliseRotationOffset(-1, 4)).toBe(3);
        expect(normaliseRotationOffset(-7, 4)).toBe(1);
    });

    it('degrades to 0 for values a corrupt row could hold', () => {
        for (const bad of [null, undefined, NaN, Infinity, -Infinity]) {
            expect(normaliseRotationOffset(bad as number, 4)).toBe(0);
        }
        expect(normaliseRotationOffset(2.7, 4)).toBe(2);
    });

    it('is 0 when there is nothing to rotate', () => {
        expect(normaliseRotationOffset(5, 0)).toBe(0);
        expect(advanceRotationOffset(5, 3, 0)).toBe(0);
    });

    it('advances by the window width so runs tile the list', () => {
        expect(advanceRotationOffset(0, 3, 4)).toBe(3);
        expect(advanceRotationOffset(3, 3, 4)).toBe(2);
        expect(advanceRotationOffset(2, 3, 4)).toBe(1);
        expect(advanceRotationOffset(1, 3, 4)).toBe(0);
    });
});

describe('Manual rotation — the specified sequence, N=4 k=3', () => {
    const ROLES = ['A', 'B', 'C', 'D'];

    it('produces A B C, D A B, C D A, B C D', () => {
        expect(simulate(ROLES, MANUAL_QUERIES, 4)).toEqual([
            ['a', 'b', 'c'],
            ['d', 'a', 'b'],
            ['c', 'd', 'a'],
            ['b', 'c', 'd'],
        ]);
    });

    it('returns to the start on the fifth run', () => {
        expect(simulate(ROLES, MANUAL_QUERIES, 5)[4]).toEqual(['a', 'b', 'c']);
    });
});

describe('Scheduled rotation — the specified sequence, N=4 k=2', () => {
    const ROLES = ['A', 'B', 'C', 'D'];

    it('produces A B, C D, A B, C D', () => {
        expect(simulate(ROLES, SCHEDULED_QUERIES, 4)).toEqual([
            ['a', 'b'], ['c', 'd'], ['a', 'b'], ['c', 'd'],
        ]);
    });
});

describe('No permanent starvation, for any N and k', () => {
    const alphabet = (n: number) => Array.from({ length: n }, (_, i) => `role${i + 1}`);

    for (const k of [1, 2, 3]) {
        for (const N of [1, 2, 3, 4, 5, 10, 20]) {
            it(`every one of ${N} role(s) is reached within ceil(N/${k}) runs`, () => {
                const roles = alphabet(N);
                const needed = Math.ceil(N / k);
                const seen = new Set(simulate(roles, k, needed).flat());
                for (const r of roles) {
                    expect(seen.has(r.toLowerCase())).toBe(true);
                }
            });
        }
    }

    it('reaches a role sitting far past the query limit', () => {
        const roles = alphabet(20);
        const seen = new Set(simulate(roles, MANUAL_QUERIES, Math.ceil(20 / 3)).flat());
        expect(seen.has('role20')).toBe(true);
    });

    it('never repeats a role inside one run', () => {
        for (const N of [1, 2, 3, 4, 10]) {
            for (const run of simulate(alphabet(N), MANUAL_QUERIES, 6)) {
                expect(new Set(run).size).toBe(run.length);
            }
        }
    });
});

describe('Role counts', () => {
    it('no explicit roles falls back to the profile, unchanged', () => {
        const fallback = selectTitles(
            {
                profile: { headline: 'Widget Inspector' },
                skills: [],
                experience: [{ title: 'Widget Technician', is_current: true }],
                engagements: [],
                preferences: { desired_roles: [] },
            } as unknown as StrategyInput,
            MANUAL_QUERIES,
            0
        );
        expect(fallback.explicitCount).toBe(0);
        expect(fallback.rolesConsumed).toBe(0);
        expect(fallback.titles[0]).toBe('widget inspector');
        expect(fallback.titles.length).toBeGreaterThan(0);
    });

    it('one role still fills every slot, using alternatives', () => {
        const { titles, rolesConsumed } = selectTitles(input(['Data Engineer']), MANUAL_QUERIES, 0);
        expect(rolesConsumed).toBe(1);
        expect(titles).toHaveLength(MANUAL_QUERIES);
        expect(titles[0]).toBe('data engineer');
        // The remaining slots come from the synonym vocabulary, not repetition.
        expect(new Set(titles).size).toBe(MANUAL_QUERIES);
    });

    it('two roles lead, then alternatives fill the third slot', () => {
        const { titles, rolesConsumed } = selectTitles(input(['Alpha Engineer', 'Beta Analyst']), MANUAL_QUERIES, 0);
        expect(rolesConsumed).toBe(2);
        expect(titles.slice(0, 2)).toEqual(['alpha engineer', 'beta analyst']);
        expect(titles).toHaveLength(MANUAL_QUERIES);
    });

    it('three roles exactly fill the slots with no expansion', () => {
        const { titles } = selectTitles(input(['A', 'B', 'C']), MANUAL_QUERIES, 0);
        expect(titles).toEqual(['a', 'b', 'c']);
    });

    it('more roles than slots keeps the surplus for later runs', () => {
        const { titles, rolesConsumed, explicitCount } = selectTitles(input(['A', 'B', 'C', 'D', 'E']), MANUAL_QUERIES, 0);
        expect(explicitCount).toBe(5);
        expect(rolesConsumed).toBe(3);
        expect(titles).toEqual(['a', 'b', 'c']);
    });
});

describe('Explicit roles outrank synonyms', () => {
    /**
     * The original defect: "developer", "engineer" and "programmer" are one
     * synonym group, so expanding the first role depth-first consumed all three
     * slots and the second role was never reached.
     */
    it('a synonym of role 1 never displaces role 2', () => {
        const { titles } = selectTitles(input(['Salesforce Developer', 'Salesforce Admin']), MANUAL_QUERIES, 0);
        expect(titles[0]).toBe('salesforce developer');
        expect(titles[1]).toBe('salesforce admin');
    });

    it('holds for a completely different profession', () => {
        const { titles } = selectTitles(input(['Java Developer', 'Product Manager']), MANUAL_QUERIES, 0);
        expect(titles.slice(0, 2)).toEqual(['java developer', 'product manager']);
    });

    it('every explicit role in the window precedes every alternative', () => {
        const roles = ['Alpha Developer', 'Beta Manager', 'Gamma Analyst'];
        const { titles } = selectTitles(input(roles), 5, 0);
        expect(titles.slice(0, 3)).toEqual(['alpha developer', 'beta manager', 'gamma analyst']);
        expect(titles.length).toBeGreaterThan(3);
    });

    it('an explicit role outranks the profile headline', () => {
        const { titles } = selectTitles(
            {
                profile: { headline: 'Inferred Title' },
                skills: [], experience: [], engagements: [],
                preferences: { desired_roles: ['Explicit Role'] },
            } as unknown as StrategyInput,
            MANUAL_QUERIES,
            0
        );
        expect(titles[0]).toBe('explicit role');
    });

    it('alternatives are still produced once explicit roles are placed', () => {
        const { titles } = selectTitles(input(['Payments Developer']), MANUAL_QUERIES, 0);
        // The synonym vocabulary is intact, only its priority changed.
        expect(titles).toContain('payments engineer');
    });

    it('fills leftover slots breadth-first, so one seed cannot monopolise them', () => {
        const { titles } = selectTitles(input(['Alpha Developer', 'Beta Developer']), 4, 0);
        expect(titles.slice(0, 2)).toEqual(['alpha developer', 'beta developer']);
        // Slot 3 is the FIRST alternative of seed 1, not seed 1's second.
        expect(titles[2]).toBe('alpha engineer');
    });
});

describe('Role list changes need no reset and no code change', () => {
    it('an added role is reached on a later run', () => {
        const before = ['A', 'B', 'C'];
        expect(simulate(before, MANUAL_QUERIES, 1)[0]).toEqual(['a', 'b', 'c']);

        // The user adds a fourth role; the stored offset is already 3.
        const after = ['A', 'B', 'C', 'D'];
        expect(titlesFor(after, MANUAL_QUERIES, 3)).toEqual(['d', 'a', 'b']);
    });

    it('a removed role leaves a stale offset that self-corrects', () => {
        // Offset 4 was valid for five roles; two are now gone.
        expect(titlesFor(['A', 'B', 'C'], MANUAL_QUERIES, 4)).toEqual(['b', 'c', 'a']);
    });

    it('replacing every role rotates the new list normally', () => {
        const replaced = ['Nurse Practitioner', 'Clinical Lead'];
        const { titles } = selectTitles(input(replaced), SCHEDULED_QUERIES, 0);
        expect(titles).toEqual(['nurse practitioner', 'clinical lead']);
    });

    it('reordering changes the search order', () => {
        expect(titlesFor(['A', 'B', 'C', 'D'], SCHEDULED_QUERIES, 0)).toEqual(['a', 'b']);
        expect(titlesFor(['D', 'C', 'B', 'A'], SCHEDULED_QUERIES, 0)).toEqual(['d', 'c']);
    });

    it('deduplicates repeated roles, including by case and punctuation', () => {
        const { titles, explicitCount } = selectTitles(input(['A', 'a', 'A ']), MANUAL_QUERIES, 0);
        expect(explicitCount).toBe(1);
        expect(titles.filter(t => t === 'a')).toHaveLength(1);
    });

    it('honours excluded_roles', () => {
        const { titles } = selectTitles(
            {
                profile: null, skills: [], experience: [], engagements: [],
                preferences: { desired_roles: ['Alpha Manager', 'Beta Analyst'], excluded_roles: ['Manager'] },
            } as unknown as StrategyInput,
            MANUAL_QUERIES,
            0
        );
        expect(titles).not.toContain('alpha manager');
        expect(titles[0]).toBe('beta analyst');
    });
});

describe('Determinism', () => {
    it('same roles, offset and options give the same result', () => {
        const roles = ['A', 'B', 'C', 'D', 'E'];
        for (const offset of [0, 1, 4, 12]) {
            expect(titlesFor(roles, MANUAL_QUERIES, offset)).toEqual(titlesFor(roles, MANUAL_QUERIES, offset));
        }
    });

    it('the full sequence is reproducible', () => {
        const a = simulate(['A', 'B', 'C', 'D', 'E'], MANUAL_QUERIES, 8);
        const b = simulate(['A', 'B', 'C', 'D', 'E'], MANUAL_QUERIES, 8);
        expect(a).toEqual(b);
    });
});

describe('Query limits and diversity are unchanged', () => {
    const PROFILE: StrategyInput = {
        profile: { headline: 'Alpha Developer' },
        skills: [
            { skill_name: 'Widget API', category: 'tool', is_primary: true },
            { skill_name: 'Gadget DB', category: 'database', is_primary: true },
            { skill_name: 'Sprocket JS', category: 'language', is_primary: false },
            { skill_name: 'Cog Framework', category: 'framework', is_primary: false },
        ],
        experience: [{ title: 'Alpha Technician', is_current: true }],
        engagements: [],
        preferences: {
            desired_roles: ['Alpha Developer', 'Beta Manager', 'Gamma Analyst', 'Delta Architect'],
            work_modes: ['remote'],
            geographic_preferences: ['Worldwide'],
            remote_search_terms: ['remote', 'work from anywhere', 'remote-first'],
            desired_skills: ['Widget API'],
            excluded_skills: [],
            excluded_roles: [],
        },
    } as unknown as StrategyInput;

    it('manual produces at most 3', () => {
        expect(buildSearchStrategies(PROFILE, { maxQueries: MANUAL_QUERIES })).toHaveLength(3);
    });

    it('scheduled produces at most 2', () => {
        expect(buildSearchStrategies(PROFILE, { maxQueries: SCHEDULED_QUERIES })).toHaveLength(2);
    });

    it('remote terms still rotate one per query', () => {
        const s = buildSearchStrategies(PROFILE, { maxQueries: MANUAL_QUERIES });
        expect(s.map(x => x.remoteTerm)).toEqual(['remote', 'work from anywhere', 'remote-first']);
    });

    it('Worldwide contributes no geographic token', () => {
        const s = buildSearchStrategies(PROFILE, { maxQueries: MANUAL_QUERIES });
        expect(s.every(x => x.geoTerm === undefined)).toBe(true);
        expect(s.map(x => x.query).join(' ').toLowerCase()).not.toContain('worldwide');
    });

    it('an explicit keyword still leads the skill pool', () => {
        const s = buildSearchStrategies(PROFILE, { maxQueries: MANUAL_QUERIES });
        expect(s[0].skills).toContain('Widget API');
    });

    it('skill clusters still differ between queries', () => {
        const s = buildSearchStrategies(PROFILE, { maxQueries: MANUAL_QUERIES });
        const clusters = s.map(x => x.skills.join('|'));
        expect(new Set(clusters).size).toBeGreaterThan(1);
    });

    it('queries are distinct', () => {
        const s = buildSearchStrategies(PROFILE, { maxQueries: MANUAL_QUERIES });
        expect(new Set(s.map(x => x.query)).size).toBe(s.length);
    });

    it('the rotation changes which roles are searched, not how many', () => {
        for (const offset of [0, 1, 2, 3]) {
            const s = buildSearchStrategies(PROFILE, { maxQueries: MANUAL_QUERIES, rotationOffset: offset });
            expect(s).toHaveLength(3);
        }
        const first = buildSearchStrategies(PROFILE, { maxQueries: MANUAL_QUERIES, rotationOffset: 0 });
        const later = buildSearchStrategies(PROFILE, { maxQueries: MANUAL_QUERIES, rotationOffset: 3 });
        expect(first[0].title).not.toEqual(later[0].title);
    });

    it('defaults to offset 0 when none is supplied', () => {
        expect(buildSearchStrategies(PROFILE, { maxQueries: MANUAL_QUERIES }))
            .toEqual(buildSearchStrategies(PROFILE, { maxQueries: MANUAL_QUERIES, rotationOffset: 0 }));
    });
});

describe('The engine carries no profession-specific logic', () => {
    /** The same code, three unrelated careers, identical guarantees. */
    const CAREERS: Array<[string, string[]]> = [
        ['platform', ['Salesforce Developer', 'Salesforce Admin', 'Salesforce Engineer', 'Salesforce Programmer']],
        ['backend', ['Java Developer', 'Backend Engineer', 'Spring Boot Developer', 'Microservices Engineer', 'Python Developer']],
        ['product', ['Product Manager', 'Technical Product Manager', 'Program Manager']],
        ['clinical', ['Registered Nurse', 'Clinical Coordinator', 'Charge Nurse']],
    ];

    it.each(CAREERS)('%s: every role is reached within ceil(N/3) runs', (_label, roles) => {
        const seen = new Set(simulate(roles, MANUAL_QUERIES, Math.ceil(roles.length / 3)).flat());
        for (const r of roles) expect(seen.has(r.toLowerCase())).toBe(true);
    });

    it.each(CAREERS)('%s: the first run leads with the first listed roles', (_label, roles) => {
        const expected = roles.slice(0, Math.min(roles.length, MANUAL_QUERIES)).map(r => r.toLowerCase());
        expect(titlesFor(roles, MANUAL_QUERIES, 0).slice(0, expected.length)).toEqual(expected);
    });

    it('the previously starved role now gets a slot', () => {
        const roles = ['Salesforce Developer', 'Salesforce Admin', 'Salesforce Engineer', 'Salesforce Programmer'];
        const runs = simulate(roles, MANUAL_QUERIES, 2);
        expect(runs[0]).toContain('salesforce admin');
        expect(runs.flat()).toContain('salesforce programmer');
    });
});
