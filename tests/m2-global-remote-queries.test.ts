/**
 * @jest-environment node
 *
 * Global/remote search intent.
 *
 * Search Parameters (candidate_preferences) previously reached
 * buildSearchStrategies and were discarded: queries were title + skills only,
 * with no work-mode or geographic intent in either direction. Separately, every
 * discovered job was persisted with work_mode 'unknown' and no location, so
 * M6's location/work-mode scoring could never run on them.
 *
 * These tests pin both halves, and pin the caps that must NOT move: the query
 * count is unchanged, only the wording inside each query changes.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
    buildSearchStrategies,
    resolveRemoteTerms,
    resolveGeoTerms,
    quoteTerm,
    PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN,
    resolveUrlBudget,
    type StrategyInput,
} from '@/lib/jobs/profile-search-strategy';
import { JobNormalizer, normalizeWorkMode, parseLocation } from '@/lib/jobs/job-normalizer';
import { DeterministicMatcher, type CandidateState } from '@/lib/matching/matching-engine';
import type { JobWithLocationsAndSkills } from '@/lib/types/jobs';

const BASE_INPUT: StrategyInput = {
    profile: { headline: 'Salesforce Developer', years_of_experience: 5, current_location: 'Bengaluru, India' },
    skills: [
        { skill_name: 'Apex', category: 'language', is_primary: true },
        { skill_name: 'LWC', category: 'framework', is_primary: true },
        { skill_name: 'SOQL', category: 'language', is_primary: true },
        { skill_name: 'Visualforce', category: 'framework' },
        { skill_name: 'JavaScript', category: 'language' },
        { skill_name: 'CSV', category: 'tool' },
    ],
    experience: [{ title: 'Salesforce Developer', is_current: true }],
    engagements: [],
    preferences: null,
};

function withPrefs(prefs: Record<string, unknown>): StrategyInput {
    return { ...BASE_INPUT, preferences: prefs as any };
}

describe('Global/remote search parameters', () => {
    describe('empty parameters change nothing', () => {
        it('produces title + skills only when no preferences exist', () => {
            const s = buildSearchStrategies(BASE_INPUT, { maxQueries: 3 });
            expect(s).toHaveLength(3);
            for (const st of s) {
                expect(st.query).not.toMatch(/remote/i);
                expect(st.query).not.toMatch(/worldwide/i);
                expect(st.remoteTerm).toBeUndefined();
                expect(st.geoTerm).toBeUndefined();
            }
        });

        it('never leaks the profile current_location into a query', () => {
            const s = buildSearchStrategies(BASE_INPUT, { maxQueries: 3 });
            for (const st of s) {
                expect(st.query).not.toMatch(/bengaluru/i);
                expect(st.query).not.toMatch(/india/i);
            }
        });

        it('adds no remote wording when only remote TERMS are set but the mode is not', () => {
            const s = buildSearchStrategies(
                withPrefs({ remote_search_terms: ['work from anywhere'] }), { maxQueries: 3 }
            );
            for (const st of s) expect(st.remoteTerm).toBeUndefined();
        });

        it('adds no work-mode wording for hybrid or office selections', () => {
            for (const mode of ['hybrid', 'office']) {
                const s = buildSearchStrategies(withPrefs({ work_modes: [mode] }), { maxQueries: 3 });
                for (const st of s) expect(st.remoteTerm).toBeUndefined();
            }
        });
    });

    describe('remote intent', () => {
        it('echoes the selected mode when no explicit terms are saved', () => {
            expect(resolveRemoteTerms(['remote'], [])).toEqual(['remote']);
            expect(resolveRemoteTerms(['remote'], null)).toEqual(['remote']);
        });

        it('uses the saved wording when provided', () => {
            expect(resolveRemoteTerms(['remote'], ['remote', 'work from anywhere', 'remote-first']))
                .toEqual(['remote', 'work from anywhere', 'remote-first']);
        });

        it('requires the remote work mode', () => {
            expect(resolveRemoteTerms([], ['work from anywhere'])).toEqual([]);
            expect(resolveRemoteTerms(['hybrid'], ['work from anywhere'])).toEqual([]);
        });

        it('rotates terms across strategies instead of repeating one suffix', () => {
            const s = buildSearchStrategies(
                withPrefs({
                    work_modes: ['remote'],
                    remote_search_terms: ['remote', 'work from anywhere', 'remote-first'],
                }),
                { maxQueries: 3 }
            );

            expect(s.map(x => x.remoteTerm)).toEqual(['remote', 'work from anywhere', 'remote-first']);
            expect(new Set(s.map(x => x.query)).size).toBe(3);
        });

        it('quotes multi-word phrases so they search as one term', () => {
            expect(quoteTerm('work from anywhere')).toBe('"work from anywhere"');
            expect(quoteTerm('remote')).toBe('remote');

            const s = buildSearchStrategies(
                withPrefs({ work_modes: ['remote'], remote_search_terms: ['work from anywhere'] }),
                { maxQueries: 1 }
            );
            expect(s[0].query).toContain('"work from anywhere"');
        });

        it('keeps the title and skills intact alongside the remote term', () => {
            const s = buildSearchStrategies(
                withPrefs({ work_modes: ['remote'], remote_search_terms: ['remote'] }),
                { maxQueries: 1 }
            );
            expect(s[0].query).toMatch(/^"Salesforce Developer" .+ remote$/);
            expect(s[0].skills.length).toBeGreaterThan(0);
        });
    });

    describe('geographic scope', () => {
        it('treats worldwide as the ABSENCE of a restriction, adding no term', () => {
            expect(resolveGeoTerms(['worldwide'])).toEqual([]);
            expect(resolveGeoTerms(['Worldwide', 'global', 'any', 'anywhere'])).toEqual([]);

            const s = buildSearchStrategies(
                withPrefs({ work_modes: ['remote'], geographic_preferences: ['worldwide'] }),
                { maxQueries: 3 }
            );
            for (const st of s) {
                expect(st.geoTerm).toBeUndefined();
                expect(st.query).not.toMatch(/worldwide/i);
                expect(st.query).not.toMatch(/india/i);
            }
        });

        it('passes concrete regions through verbatim and rotates them', () => {
            expect(resolveGeoTerms(['Germany', 'Netherlands'])).toEqual(['Germany', 'Netherlands']);

            const s = buildSearchStrategies(
                withPrefs({ geographic_preferences: ['Germany', 'Netherlands'] }), { maxQueries: 3 }
            );
            expect(s.map(x => x.geoTerm)).toEqual(['Germany', 'Netherlands', 'Germany']);
        });

        it('drops worldwide sentinels but keeps real regions in a mixed list', () => {
            expect(resolveGeoTerms(['worldwide', 'Canada'])).toEqual(['Canada']);
        });
    });

    describe('keywords', () => {
        it('puts user keywords ahead of inferred profile skills', () => {
            const s = buildSearchStrategies(
                withPrefs({ desired_skills: ['Salesforce CPQ'] }), { maxQueries: 1, skillsPerQuery: 1 }
            );
            expect(s[0].skills).toEqual(['Salesforce CPQ']);
        });

        it('removes excluded keywords from every query', () => {
            const s = buildSearchStrategies(
                withPrefs({ excluded_skills: ['CSV', 'JavaScript'] }), { maxQueries: 3 }
            );
            for (const st of s) {
                expect(st.skills).not.toContain('CSV');
                expect(st.skills).not.toContain('JavaScript');
            }
        });
    });

    describe('caps are unchanged', () => {
        it('query count is identical with and without search parameters', () => {
            const without = buildSearchStrategies(BASE_INPUT, { maxQueries: 3 });
            const with_ = buildSearchStrategies(
                withPrefs({
                    work_modes: ['remote'],
                    geographic_preferences: ['worldwide'],
                    remote_search_terms: ['remote', 'work from anywhere', 'remote-first'],
                }),
                { maxQueries: 3 }
            );
            expect(with_).toHaveLength(without.length);
            expect(with_).toHaveLength(3);
        });

        it('search parameters cannot raise the query cap', () => {
            const s = buildSearchStrategies(
                withPrefs({
                    work_modes: ['remote'],
                    remote_search_terms: Array.from({ length: 20 }, (_, i) => `term${i}`),
                    desired_roles: Array.from({ length: 20 }, (_, i) => `Role ${i}`),
                }),
                { maxQueries: 3 }
            );
            expect(s).toHaveLength(3);
        });

        it('the extraction URL ceiling is untouched', () => {
            expect(PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN).toBe(4);
            expect(resolveUrlBudget(99)).toBe(4);
        });
    });

    describe('work-mode normalization', () => {
        it('maps the UI in_office value onto the jobs domain office', () => {
            expect(normalizeWorkMode('in_office')).toBe('office');
            expect(normalizeWorkMode('In Office')).toBe('office');
            expect(normalizeWorkMode('in-office')).toBe('office');
        });

        it('maps the three real modes and common synonyms', () => {
            expect(normalizeWorkMode('remote')).toBe('remote');
            expect(normalizeWorkMode('Fully Remote')).toBe('remote');
            expect(normalizeWorkMode('work from home')).toBe('remote');
            expect(normalizeWorkMode('hybrid')).toBe('hybrid');
            expect(normalizeWorkMode('onsite')).toBe('office');
            expect(normalizeWorkMode('office')).toBe('office');
        });

        it('falls back to unknown for absent, malformed or unrecognised values', () => {
            for (const v of [undefined, null, '', '   ', 'banana', 42, {}, []]) {
                expect(normalizeWorkMode(v as unknown)).toBe('unknown');
            }
        });
    });

    // Shape and single-token behaviour deliberately changed: a bare token is a
    // city unless it is a recognised country, and the result now fills the full
    // job_locations model. Exhaustive cases live in m2-location-parsing.test.ts.
    describe('location parsing', () => {
        it('splits city, state and country using the country dictionary', () => {
            expect(parseLocation('Bengaluru, India')).toMatchObject({ city: 'Bengaluru', country: 'India' });
            expect(parseLocation('San Francisco, CA, USA')).toMatchObject({
                city: 'San Francisco', state: 'CA', country: 'United States',
            });
        });

        it('treats a single recognised token as the country', () => {
            expect(parseLocation('Germany')).toMatchObject({ city: null, country: 'Germany' });
        });

        it('treats a single UNRECOGNISED token as a city, not a country', () => {
            expect(parseLocation('Bengaluru')).toMatchObject({ city: 'Bengaluru', country: null });
        });

        it('returns null rather than an empty row', () => {
            for (const v of [undefined, null, '', '  ', ',', 42]) {
                expect(parseLocation(v as unknown)).toBeNull();
            }
        });
    });

    describe('normalizer persists the new fields', () => {
        const base = {
            title: 'Salesforce Developer',
            company: 'Qualityze',
            description: 'Apex and LWC work.',
            url: 'https://www.naukri.com/job-listings-salesforce-developer-1',
            contentHash: 'abc123',
            rawPayload: {},
        };

        it('maps remote with a worldwide scope', () => {
            const r = JobNormalizer.normalize({ ...base, workMode: 'remote', remoteScope: 'Worldwide', location: '' } as any);
            expect(r?.work_mode).toBe('remote');
            expect(r?.remote_scope).toBe('Worldwide');
        });

        it('keeps a country-restricted remote scope verbatim, never calling it worldwide', () => {
            const r = JobNormalizer.normalize({ ...base, workMode: 'remote', remoteScope: 'US only' } as any);
            expect(r?.work_mode).toBe('remote');
            expect(r?.remote_scope).toBe('US only');
        });

        it('maps hybrid and office, and drops any scope on a non-remote role', () => {
            const hybrid = JobNormalizer.normalize({ ...base, workMode: 'hybrid', remoteScope: 'Worldwide' } as any);
            expect(hybrid?.work_mode).toBe('hybrid');
            expect(hybrid?.remote_scope).toBeNull();

            const office = JobNormalizer.normalize({ ...base, workMode: 'in_office' } as any);
            expect(office?.work_mode).toBe('office');
            expect(office?.remote_scope).toBeNull();
        });

        it('falls back to unknown when the posting states no work mode', () => {
            const r = JobNormalizer.normalize({ ...base } as any);
            expect(r?.work_mode).toBe('unknown');
            expect(r?.remote_scope).toBeNull();
            expect(r?.location).toBeNull();
        });

        it('degrades safely on malformed values instead of rejecting the job', () => {
            const r = JobNormalizer.normalize({ ...base, workMode: 12345, remoteScope: {}, location: [] } as any);
            expect(r).not.toBeNull();
            expect(r?.work_mode).toBe('unknown');
        });

        it('parses the location alongside the job record', () => {
            const r = JobNormalizer.normalize({ ...base, workMode: 'office', location: 'Bengaluru, India' } as any);
            expect(r?.location).toMatchObject({ city: 'Bengaluru', country: 'India', remote_allowed: false });
        });

        it('preserves all pre-existing fields', () => {
            const r = JobNormalizer.normalize({ ...base, workMode: 'remote' } as any);
            expect(r?.title).toBe('Salesforce Developer');
            expect(r?.company_name).toBe('Qualityze');
            expect(r?.description).toBe('Apex and LWC work.');
            expect(r?.raw_content_hash).toBe('abc123');
            expect(r?.status).toBe('discovered');
            expect(r?.employment_type).toBe('unknown');
            expect(r?.canonical_id).toBeTruthy();
        });
    });

    describe('M6 compatibility (scoring logic unchanged)', () => {
        const candidate: CandidateState = {
            profile: { headline: 'Salesforce Developer' } as any,
            skills: [{ skill_name: 'Apex' } as any, { skill_name: 'JavaScript' } as any],
            experience: [{ title: 'Salesforce Developer' } as any],
            preferences: null,
        };

        function job(overrides: Record<string, unknown> = {}): JobWithLocationsAndSkills {
            return {
                id: 'job-1',
                title: 'Salesforce Developer 3-8 years Exp',
                company_name: 'Qualityze',
                description: 'Salesforce developer working with Apex and JavaScript on CRM integrations.',
                work_mode: 'unknown',
                employment_type: 'full_time',
                job_locations: [],
                job_skills: [],
                ...overrides,
            } as unknown as JobWithLocationsAndSkills;
        }

        it('a job with no job_skills still scores', () => {
            const r = DeterministicMatcher.match(candidate, job());
            expect(r.skills_score).toBeGreaterThanOrEqual(75);
            expect(r.overall_score).toBeGreaterThan(0);
        });

        it('the existing high-scoring shape is unchanged by the new fields', () => {
            const before = DeterministicMatcher.match(candidate, job());
            const after = DeterministicMatcher.match(candidate, job({ work_mode: 'remote', remote_scope: 'Worldwide' }));
            // No candidate preferences → work-mode and location branches stay neutral.
            expect(after.overall_score).toBe(before.overall_score);
            expect(after.work_mode_score).toBe(100);
            expect(after.location_score).toBe(100);
        });

        it('a discovered job carrying real work-mode data is now scorable', () => {
            const remoteWanted: CandidateState = {
                ...candidate,
                preferences: { work_modes: ['remote'], geographic_preferences: ['worldwide'] } as any,
            };

            const remote = DeterministicMatcher.match(remoteWanted, job({ work_mode: 'remote', remote_scope: 'Worldwide' }));
            const office = DeterministicMatcher.match(remoteWanted, job({ work_mode: 'office' }));

            expect(remote.work_mode_score).toBe(100);
            expect(office.work_mode_score).toBe(0);
            expect(office.overall_score).toBeLessThan(remote.overall_score);
        });

        it('an unknown work mode is still skipped by the mode branch', () => {
            const remoteWanted: CandidateState = {
                ...candidate,
                preferences: { work_modes: ['remote'] } as any,
            };
            const r = DeterministicMatcher.match(remoteWanted, job({ work_mode: 'unknown' }));
            expect(r.work_mode_score).toBe(100);
        });
    });
});
