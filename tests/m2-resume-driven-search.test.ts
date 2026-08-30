/**
 * @jest-environment node
 */

/**
 * Resume-driven search expansion.
 *
 * Explicit Target Roles say what the user asked for; the resume says what they
 * are actually qualified for. This layer turns the second into extra search
 * intents so a run can reach adjacent jobs the user never thought to type —
 * without spending another search call and without inventing qualifications.
 *
 * The engine must know nothing about any profession. Fixtures here are mostly
 * invented vocabulary (Zorb, Quilt, Marrow) precisely so that a passing test
 * cannot be explained by a hardcoded real-world term; the recognisable
 * professions appear only to show the same code carrying different careers.
 *
 * Nothing here calls Firecrawl or touches a database.
 */
import {
    buildSearchStrategies,
    buildSearchPortfolio,
    explainPortfolio,
    extractQualifiers,
    deriveRoleNoun,
    selectTitles,
    advanceRotationOffset,
    QUALIFIER_MIN_FREQUENCY,
    type StrategyInput,
} from '@/lib/jobs/profile-search-strategy';

const MANUAL = 3;
const SCHEDULED = 2;

/** Builds a profile from plain parts, so each test states only what it needs. */
function profile(parts: {
    headline?: string;
    roles?: string[];
    skills?: Array<[string, string, boolean]>;
    engagements?: Array<{ tech?: string[]; domains?: string[] }>;
    experience?: Array<[string, boolean]>;
    excludedRoles?: string[];
    excludedSkills?: string[];
    desiredSkills?: string[];
}): StrategyInput {
    return {
        profile: parts.headline ? { headline: parts.headline } : null,
        skills: (parts.skills ?? []).map(([skill_name, category, is_primary]) => ({
            skill_name, category, is_primary,
        })),
        experience: (parts.experience ?? []).map(([title, is_current]) => ({ title, is_current })),
        engagements: (parts.engagements ?? []).map(e => ({
            technologies: e.tech ?? [], domains: e.domains ?? [],
        })),
        preferences: {
            desired_roles: parts.roles ?? [],
            desired_skills: parts.desiredSkills ?? [],
            excluded_roles: parts.excludedRoles ?? [],
            excluded_skills: parts.excludedSkills ?? [],
            work_modes: ['remote'],
            geographic_preferences: ['Worldwide'],
            remote_search_terms: ['remote', 'work from anywhere', 'remote-first'],
        },
    } as unknown as StrategyInput;
}

/** A profile whose resume repeats one qualifier across separate engagements. */
const RECURRING = profile({
    headline: 'Zorb Developer',
    roles: ['Zorb Developer'],
    skills: [
        ['Zorb', 'framework', true],
        ['Quilt', 'language', true],
        ['Marrow', 'tool', false],
    ],
    engagements: [
        { tech: ['Zorb', 'Quilt'], domains: ['grafting'] },
        { tech: ['Zorb', 'Marrow'], domains: ['grafting'] },
        { tech: ['grafting'], domains: ['grafting'] },
    ],
});

describe('Qualifier extraction is evidence-based', () => {
    it('accepts a term that recurs across engagements', () => {
        const q = extractQualifiers(RECURRING.skills, RECURRING.engagements);
        expect(q.map(x => x.term)).toContain('zorb');
        expect(q.find(x => x.term === 'zorb')!.frequency).toBeGreaterThanOrEqual(QUALIFIER_MIN_FREQUENCY);
    });

    it('accepts an explicitly primary skill even when mentioned once', () => {
        const q = extractQualifiers(RECURRING.skills, RECURRING.engagements);
        expect(q.find(x => x.term === 'quilt')?.primary).toBe(true);
    });

    it('rejects a one-off, non-primary mention — an anecdote is not a role', () => {
        const q = extractQualifiers(
            [],
            [{ technologies: ['Solo'], domains: [] }] as never
        );
        expect(q.map(x => x.term)).not.toContain('solo');
    });

    it('rejects role nouns — a role is not a thing the role works on', () => {
        const q = extractQualifiers(
            [{ skill_name: 'developer', category: 'other', is_primary: true }] as never,
            [{ technologies: ['developer', 'engineer'], domains: ['developer'] }] as never
        );
        expect(q.map(x => x.term)).not.toContain('developer');
        expect(q.map(x => x.term)).not.toContain('engineer');
    });

    it('rejects seniority words and generic filler', () => {
        const q = extractQualifiers(
            [] as never,
            [
                { technologies: ['senior', 'documentation', 'and'], domains: [] },
                { technologies: ['senior', 'documentation', 'and'], domains: [] },
            ] as never
        );
        expect(q.map(x => x.term)).toEqual([]);
    });

    it('rejects long phrases that would make an unnatural title', () => {
        const long = 'data migration using custom scripts';
        const q = extractQualifiers(
            [] as never,
            [{ technologies: [long], domains: [] }, { technologies: [long], domains: [] }] as never
        );
        expect(q.map(x => x.term)).not.toContain(long);
    });

    it('ranks stronger evidence first and is deterministic on ties', () => {
        const q = extractQualifiers(RECURRING.skills, RECURRING.engagements);
        for (let i = 1; i < q.length; i++) {
            expect(q[i - 1].score).toBeGreaterThanOrEqual(q[i].score);
        }
        expect(q).toEqual(extractQualifiers(RECURRING.skills, RECURRING.engagements));
    });

    it('returns nothing when the profile has no engagements or primary skills', () => {
        expect(extractQualifiers([], [])).toEqual([]);
    });
});

describe('Role noun comes from the user, not a dictionary', () => {
    it('finds a noun the vocabulary knows', () => {
        expect(deriveRoleNoun(['zorb developer'])).toBe('developer');
    });

    it('falls back to the last meaningful word for an unknown profession', () => {
        expect(deriveRoleNoun(['senior widget wrangler'])).toBe('wrangler');
    });

    it('ignores seniority when falling back', () => {
        expect(deriveRoleNoun(['principal marrow tender'])).toBe('tender');
    });

    it('returns null with nothing to read', () => {
        expect(deriveRoleNoun([])).toBeNull();
        expect(deriveRoleNoun([''])).toBeNull();
    });
});

describe('Derived intents are grounded in the resume', () => {
    it('composes a repeated qualifier with the profile role noun', () => {
        const derived = buildSearchPortfolio(RECURRING).filter(i => i.kind === 'derived');
        expect(derived.map(i => i.title)).toContain('grafting developer');
    });

    it('explains its evidence', () => {
        const g = buildSearchPortfolio(RECURRING).find(i => i.title === 'grafting developer');
        expect(g!.reason).toMatch(/engagements/);
    });

    it('invents nothing when the resume supports nothing', () => {
        const bare = profile({ headline: 'Zorb Developer', roles: ['Zorb Developer'] });
        expect(buildSearchPortfolio(bare).filter(i => i.kind === 'derived')).toEqual([]);
    });

    it('ranks explicit above profile above derived above synonym', () => {
        const kinds = buildSearchPortfolio(RECURRING).map(i => i.kind);
        const rank = { explicit: 0, profile: 1, derived: 2, synonym: 3 } as const;
        const positions = kinds.map(k => rank[k]);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });

    it('never contains a duplicate title', () => {
        const titles = buildSearchPortfolio(RECURRING).map(i => i.title);
        expect(new Set(titles).size).toBe(titles.length);
    });

    it('honours excluded roles throughout the portfolio', () => {
        const p = profile({
            headline: 'Zorb Developer',
            roles: ['Zorb Developer'],
            skills: [['Grafting', 'tool', true]],
            engagements: [{ tech: ['grafting'] }, { tech: ['grafting'] }],
            excludedRoles: ['grafting'],
        });
        expect(buildSearchPortfolio(p).every(i => !i.title.includes('grafting'))).toBe(true);
    });
});

describe('Explicit roles are never displaced', () => {
    it('a derived intent cannot outrank an explicit role', () => {
        const p = profile({
            headline: 'Zorb Developer',
            roles: ['Alpha Role', 'Beta Role'],
            skills: [['Grafting', 'tool', true]],
            engagements: [{ tech: ['grafting'] }, { tech: ['grafting'] }],
        });
        const { titles } = selectTitles(p, MANUAL, 0);
        expect(titles.slice(0, 2)).toEqual(['alpha role', 'beta role']);
    });

    it('derived intents only ever fill slots the explicit roles left over', () => {
        const p = profile({
            roles: ['A', 'B', 'C'],
            skills: [['Grafting', 'tool', true]],
            engagements: [{ tech: ['grafting'] }, { tech: ['grafting'] }],
        });
        expect(selectTitles(p, MANUAL, 0).titles).toEqual(['a', 'b', 'c']);
    });

    it('derived intents outrank generic synonyms when both could fill a slot', () => {
        const { titles } = selectTitles(RECURRING, MANUAL, 0);
        // 'zorb engineer' is a synonym swap; 'grafting developer' is evidence.
        expect(titles).toContain('grafting developer');
    });
});

describe('Query budget is unchanged', () => {
    it('manual still yields at most 3', () => {
        expect(buildSearchStrategies(RECURRING, { maxQueries: MANUAL })).toHaveLength(3);
    });

    it('scheduled still yields at most 2', () => {
        expect(buildSearchStrategies(RECURRING, { maxQueries: SCHEDULED })).toHaveLength(2);
    });

    it('a richer resume does not produce more queries', () => {
        const rich = profile({
            headline: 'Zorb Developer',
            roles: ['Zorb Developer'],
            skills: Array.from({ length: 30 }, (_, i) => [`Skill${i}`, 'tool', i < 10] as [string, string, boolean]),
            engagements: Array.from({ length: 10 }, () => ({ tech: ['grafting', 'zorb'], domains: ['grafting'] })),
        });
        expect(buildSearchStrategies(rich, { maxQueries: MANUAL })).toHaveLength(3);
        expect(buildSearchStrategies(rich, { maxQueries: SCHEDULED })).toHaveLength(2);
    });
});

describe('Diversity within the budget', () => {
    const s = () => buildSearchStrategies(RECURRING, { maxQueries: MANUAL });

    it('every query targets a different title', () => {
        const titles = s().map(x => x.title);
        expect(new Set(titles).size).toBe(titles.length);
    });

    it('queries are not identical strings', () => {
        const queries = s().map(x => x.query);
        expect(new Set(queries).size).toBe(queries.length);
    });

    it('skill clusters differ between queries', () => {
        const clusters = s().map(x => x.skills.join('|'));
        expect(new Set(clusters).size).toBeGreaterThan(1);
    });

    it('remote phrasing still rotates one per query', () => {
        expect(s().map(x => x.remoteTerm)).toEqual(['remote', 'work from anywhere', 'remote-first']);
    });

    it('a query does not contain the entire resume', () => {
        for (const strategy of s()) expect(strategy.skills.length).toBeLessThanOrEqual(3);
    });

    it('a derived query leads with skills related to its own qualifier', () => {
        const p = profile({
            headline: 'Zorb Developer',
            roles: ['Zorb Developer'],
            skills: [
                ['Grafting Toolkit', 'tool', false],
                ['Unrelated Thing', 'tool', false],
                ['Grafting Bench', 'tool', false],
            ],
            engagements: [{ tech: ['grafting'] }, { tech: ['grafting'] }],
        });
        const derived = buildSearchStrategies(p, { maxQueries: MANUAL })
            .find(x => x.title.toLowerCase() === 'grafting developer');
        expect(derived).toBeDefined();
        expect(derived!.skills.some(sk => sk.toLowerCase().includes('grafting'))).toBe(true);
    });
});

describe('Search parameters still govern the query', () => {
    it('Worldwide contributes no literal token', () => {
        const s = buildSearchStrategies(RECURRING, { maxQueries: MANUAL });
        expect(s.every(x => x.geoTerm === undefined)).toBe(true);
        expect(s.map(x => x.query).join(' ').toLowerCase()).not.toContain('worldwide');
    });

    it('no location is injected from anywhere', () => {
        const s = buildSearchStrategies(RECURRING, { maxQueries: MANUAL });
        const all = s.map(x => x.query).join(' ').toLowerCase();
        for (const place of ['india', 'bengaluru', 'bangalore', 'united states']) {
            expect(all).not.toContain(place);
        }
    });

    it('an explicit keyword still leads the skill pool', () => {
        const p = profile({
            headline: 'Zorb Developer', roles: ['Zorb Developer'],
            skills: [['Marrow', 'tool', true]],
            desiredSkills: ['Explicit Keyword'],
        });
        expect(buildSearchStrategies(p, { maxQueries: 1 })[0].skills).toContain('Explicit Keyword');
    });

    it('excluded skills never appear', () => {
        const p = profile({
            headline: 'Zorb Developer', roles: ['Zorb Developer'],
            skills: [['Forbidden', 'tool', true], ['Allowed', 'tool', true]],
            excludedSkills: ['Forbidden'],
        });
        const all = buildSearchStrategies(p, { maxQueries: MANUAL }).flatMap(x => x.skills);
        expect(all).not.toContain('Forbidden');
    });
});

describe('Rotation reaches different intents over time', () => {
    const FOUR = profile({
        headline: 'Zorb Developer',
        roles: ['A', 'B', 'C', 'D'],
        skills: [['Grafting', 'tool', true]],
        engagements: [{ tech: ['grafting'] }, { tech: ['grafting'] }],
    });

    it('explicit roles still rotate exactly as specified', () => {
        let offset = 0;
        const runs: string[][] = [];
        for (let i = 0; i < 4; i++) {
            const { titles } = selectTitles(FOUR, MANUAL, offset);
            runs.push(titles);
            offset = advanceRotationOffset(offset, MANUAL, 4);
        }
        expect(runs).toEqual([
            ['a', 'b', 'c'], ['d', 'a', 'b'], ['c', 'd', 'a'], ['b', 'c', 'd'],
        ]);
    });

    it('the derived pool is not frozen on one intent across runs', () => {
        const many = profile({
            headline: 'Zorb Developer',
            roles: ['Zorb Developer'],
            skills: [['Alpha', 'tool', true], ['Beta', 'tool', true], ['Gamma', 'tool', true]],
            engagements: [
                { tech: ['alpha', 'beta'] }, { tech: ['alpha', 'gamma'] },
                { tech: ['beta', 'gamma'] },
            ],
        });
        const first = buildSearchPortfolio(many, 0).filter(i => i.kind === 'derived').map(i => i.title);
        const later = buildSearchPortfolio(many, 1).filter(i => i.kind === 'derived').map(i => i.title);
        expect(first).not.toEqual(later);
        expect(new Set(first)).toEqual(new Set(later));
    });

    it('is deterministic for the same inputs and offset', () => {
        for (const offset of [0, 1, 5, 11]) {
            expect(buildSearchStrategies(FOUR, { maxQueries: MANUAL, rotationOffset: offset }))
                .toEqual(buildSearchStrategies(FOUR, { maxQueries: MANUAL, rotationOffset: offset }));
        }
    });
});

describe('Any career, same code', () => {
    const CAREERS: Array<[string, { headline: string; roles: string[]; tech: string[] }]> = [
        ['platform', { headline: 'Salesforce Developer', roles: ['Salesforce Developer', 'Salesforce Admin'], tech: ['Salesforce', 'integration'] }],
        ['backend', { headline: 'Java Developer', roles: ['Java Developer', 'Backend Engineer'], tech: ['Kubernetes', 'microservices'] }],
        ['data', { headline: 'Data Engineer', roles: ['Data Engineer', 'Analytics Engineer'], tech: ['Airflow', 'warehousing'] }],
        ['product', { headline: 'Product Manager', roles: ['Product Manager', 'Program Manager'], tech: ['roadmapping', 'analytics'] }],
        ['clinical', { headline: 'Clinical Data Manager', roles: ['Clinical Data Manager', 'Healthcare Analyst'], tech: ['EDC', 'pharmacovigilance'] }],
        ['trades', { headline: 'Site Supervisor', roles: ['Site Supervisor'], tech: ['scaffolding', 'inspection'] }],
    ];

    it.each(CAREERS)('%s derives intents from its own vocabulary', (_label, c) => {
        const p = profile({
            headline: c.headline,
            roles: c.roles,
            skills: c.tech.map(t => [t, 'tool', true] as [string, string, boolean]),
            engagements: [{ tech: c.tech }, { tech: c.tech }],
        });
        const derived = buildSearchPortfolio(p).filter(i => i.kind === 'derived');
        expect(derived.length).toBeGreaterThan(0);
        // Every derived title is built only from this profile's own terms.
        for (const d of derived) {
            expect(c.tech.some(t => d.title.includes(t.toLowerCase()))).toBe(true);
        }
    });

    it.each(CAREERS)('%s respects the manual query budget', (_label, c) => {
        const p = profile({
            headline: c.headline, roles: c.roles,
            skills: c.tech.map(t => [t, 'tool', true] as [string, string, boolean]),
            engagements: [{ tech: c.tech }, { tech: c.tech }],
        });
        expect(buildSearchStrategies(p, { maxQueries: MANUAL }).length).toBeLessThanOrEqual(MANUAL);
        expect(buildSearchStrategies(p, { maxQueries: SCHEDULED }).length).toBeLessThanOrEqual(SCHEDULED);
    });

    it('changing career replaces the portfolio entirely', () => {
        const before = profile({
            headline: 'Zorb Developer', roles: ['Zorb Developer'],
            skills: [['Zorb', 'tool', true]],
            engagements: [{ tech: ['zorb'] }, { tech: ['zorb'] }],
        });
        const after = profile({
            headline: 'Quilt Nurse', roles: ['Quilt Nurse'],
            skills: [['Quilt', 'tool', true]],
            engagements: [{ tech: ['quilt'] }, { tech: ['quilt'] }],
        });
        const a = buildSearchPortfolio(before).map(i => i.title).join(' ');
        const b = buildSearchPortfolio(after).map(i => i.title).join(' ');
        expect(a).not.toContain('quilt');
        expect(b).not.toContain('zorb');
        expect(b).toContain('quilt nurse');
    });
});

describe('Fallback when there are no explicit roles', () => {
    it('still searches, using the profile', () => {
        const p = profile({
            headline: 'Zorb Developer',
            experience: [['Zorb Technician', true]],
            skills: [['Grafting', 'tool', true]],
            engagements: [{ tech: ['grafting'] }, { tech: ['grafting'] }],
        });
        const s = buildSearchStrategies(p, { maxQueries: MANUAL });
        expect(s).toHaveLength(3);
        expect(s[0].title.toLowerCase()).toBe('zorb developer');
    });

    it('produces nothing when the profile is entirely empty', () => {
        expect(buildSearchStrategies(profile({}), { maxQueries: MANUAL })).toEqual([]);
    });
});

describe('Diagnostics explain a disappointing run', () => {
    it('reports what was selected and what was skipped', () => {
        const d = explainPortfolio(RECURRING, { maxQueries: MANUAL });
        expect(d.selected).toHaveLength(3);
        expect(d.skipped.length).toBeGreaterThan(0);
        expect(d.selected.every(i => typeof i.reason === 'string')).toBe(true);
    });

    it('reports the qualifiers and role noun behind the derived intents', () => {
        const d = explainPortfolio(RECURRING, { maxQueries: MANUAL });
        expect(d.roleNoun).toBe('developer');
        expect(d.qualifiers.map(q => q.term)).toContain('grafting');
    });

    it('reports the search intent terms actually applied', () => {
        const d = explainPortfolio(RECURRING, { maxQueries: MANUAL });
        expect(d.remoteTerms).toEqual(['remote', 'work from anywhere', 'remote-first']);
        expect(d.geoTerms).toEqual([]);
    });

    it('shows nothing was skipped for want of evidence on a bare profile', () => {
        const d = explainPortfolio(profile({ headline: 'Zorb Developer' }), { maxQueries: MANUAL });
        expect(d.qualifiers).toEqual([]);
        expect(d.selected.length).toBeGreaterThan(0);
    });
});
