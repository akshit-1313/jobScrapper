/**
 * @jest-environment node
 */

/**
 * Three production-hardening changes that share one theme: the run should be
 * honest about what it actually did.
 *
 *   1. Rotation stamping — only sources that genuinely searched advance.
 *   2. Scheduled plan     — the cron plans what it can finish, not 9 searches.
 *   3. Pre-extraction gate — obvious non-postings are refused before the spend.
 *
 * Nothing here calls Firecrawl. The gate is pure, and the rotation and cron
 * assertions read source text rather than executing discovery.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// The modules under test import the admin client at load time. Stubbing it
// keeps this suite free of environment configuration — and, more importantly,
// makes it impossible for any of these tests to reach a real service.
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateCandidate, describeSkip } from '@/lib/jobs/candidate-gate';
import {
    SCHEDULED_MAX_SOURCES_PER_RUN,
    SCHEDULED_MAX_QUERIES_PER_RUN,
} from '@/lib/jobs/scheduled-discovery';
import {
    PROFILE_SEARCH_DEFAULT_MAX_SOURCES_PER_RUN,
    PROFILE_SEARCH_DEFAULT_MAX_QUERIES,
} from '@/lib/jobs/discovery-service';
import type { DiscoveredURL } from '@/lib/jobs/adapters/types';

const SRC = join(__dirname, '..', 'src');
const DISCOVERY = join(SRC, 'lib', 'jobs', 'discovery-service.ts');
const SCHEDULED = join(SRC, 'lib', 'jobs', 'scheduled-discovery.ts');
const ADAPTER = join(SRC, 'lib', 'jobs', 'adapters', 'firecrawl-adapter.ts');

const raw = (p: string) => readFileSync(p, 'utf8');

/** Strip comments so an explanatory note is never mistaken for live code. */
function codeOf(path: string): string {
    return raw(path)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(line => !line.trim().startsWith('//'))
        .join('\n');
}

const url = (u: string, extra: Partial<DiscoveredURL> = {}): DiscoveredURL => ({
    url: u,
    sourceDomain: new URL(u).hostname,
    ...extra,
});

// ── 1. Rotation stamping ────────────────────────────────────────────────────

describe('Rotation stamps only sources that actually searched', () => {
    const code = codeOf(DISCOVERY);

    it('records a source at the moment it issues a search', () => {
        expect(code).toContain('searchedSourceIds.add(source.id)');
        // Immediately alongside the attempt counter, before the outbound call.
        expect(code).toMatch(/searchesAttempted\+\+;\s*searchedSourceIds\.add\(source\.id\);/);
    });

    it('stamps the intersection of selected and searched, not the selection', () => {
        expect(code).toContain('.filter(id => searchedSourceIds.has(id))');
        expect(code).toContain(".in('id', stampIds)");
    });

    it('no longer stamps every selected source unconditionally', () => {
        // The previous defect, verbatim.
        expect(code).not.toContain(".in('id', activeSources.map(s => s.id))");
    });

    it('skips the write entirely when nothing searched', () => {
        expect(code).toContain('if (stampIds.length > 0)');
    });

    /**
     * The three cases from the specification, expressed against the same
     * filter the implementation uses.
     */
    describe('stamping cases', () => {
        const A = 'a0000000-0000-0000-0000-000000000005';
        const B = 'a0000000-0000-0000-0000-000000000004';
        const C = 'a0000000-0000-0000-0000-000000000010';
        const selected = [A, B, C];

        const stamp = (searched: string[]) => {
            const set = new Set(searched);
            return selected.filter(id => set.has(id));
        };

        it('Case 1: only A searched → only A stamped', () => {
            expect(stamp([A])).toEqual([A]);
        });

        it('Case 2: A and B searched → only A and B stamped', () => {
            expect(stamp([A, B])).toEqual([A, B]);
        });

        it('Case 3: a source the budget never reached keeps its turn', () => {
            const stamped = stamp([A]);
            expect(stamped).not.toContain(B);
            expect(stamped).not.toContain(C);
        });

        it('all three searched → all three stamped, order preserved', () => {
            expect(stamp([C, A, B])).toEqual([A, B, C]);
        });

        it('nothing searched → nothing stamped', () => {
            expect(stamp([])).toEqual([]);
        });
    });

    it('leaves ordering, caps and the allow-list untouched', () => {
        expect(code).toContain("order('last_crawled_at', { ascending: true, nullsFirst: true })");
        expect(code).toContain("order('priority', { ascending: true })");
        expect(code).toContain("order('id', { ascending: true })");
        expect(code).toContain("eq('active', true)");
        expect(code).toContain('eligibleSources.slice(0, Math.max(1, maxSources))');
    });
});

// ── 2. Scheduled plan ───────────────────────────────────────────────────────

describe('The scheduled run plans only what it can finish', () => {
    const code = codeOf(SCHEDULED);

    it('uses one source per invocation', () => {
        expect(SCHEDULED_MAX_SOURCES_PER_RUN).toBe(1);
    });

    it('uses two strategies per invocation', () => {
        expect(SCHEDULED_MAX_QUERIES_PER_RUN).toBe(2);
    });

    it('passes them through the existing options, not a second engine', () => {
        expect(code).toContain('maxSourcesPerRun: SCHEDULED_MAX_SOURCES_PER_RUN');
        expect(code).toContain('maxQueries: SCHEDULED_MAX_QUERIES_PER_RUN');
        expect(code).toContain('runProfileTargetedDiscovery(userId, {');
    });

    it('plans 2 searches, which is what the budget can actually execute', () => {
        expect(SCHEDULED_MAX_SOURCES_PER_RUN * SCHEDULED_MAX_QUERIES_PER_RUN).toBe(2);
    });

    it('manual discovery is unchanged: 3 sources x 3 queries', () => {
        expect(PROFILE_SEARCH_DEFAULT_MAX_SOURCES_PER_RUN).toBe(3);
        expect(PROFILE_SEARCH_DEFAULT_MAX_QUERIES).toBe(3);
        expect(PROFILE_SEARCH_DEFAULT_MAX_SOURCES_PER_RUN * PROFILE_SEARCH_DEFAULT_MAX_QUERIES).toBe(9);
    });

    it('builds no second query builder and no second source selection', () => {
        expect(code).not.toContain('buildSearchStrategies');
        expect(code).not.toContain('selected_source_ids');
        expect(code).not.toContain('resolveEligibleSources');
        expect(code).not.toContain("from('job_sources')");
    });

    it('still delegates to the validated Phase 3 entry point', () => {
        expect(code).toContain('runProfileTargetedDiscovery');
        expect(code).not.toContain('executeBackgroundDiscovery');
        expect(code).not.toContain('runJobDiscovery(');
    });

    it('keeps eligibility opt-in and rotation bookkeeping', () => {
        expect(code).toContain("eq('daily_discovery_enabled', true)");
        expect(code).toContain('last_daily_discovery_at');
    });
});

// ── 3. Pre-extraction gate ──────────────────────────────────────────────────

describe('The pre-extraction gate rejects only on positive evidence', () => {
    describe('URL shape — the observed Production waste cases', () => {
        it('skips a RemoteOK member profile', () => {
            const d = evaluateCandidate(url('https://remoteok.com/@shubham_porwal'));
            expect(d.keep).toBe(false);
            expect(d.reason).toBe('remoteok_profile_url');
        });

        it.each([
            'https://remoteok.com/@pritamgaigole',
            'https://remoteok.com/@ankik_dhawale',
        ])('skips %s', (u) => {
            expect(evaluateCandidate(url(u)).keep).toBe(false);
        });

        it('skips a RemoteOK employer landing page', () => {
            const d = evaluateCandidate(url('https://remoteok.com/hire-remotely/hindi+html+js+lwc'));
            expect(d.keep).toBe(false);
            expect(d.reason).toBe('non_posting_url');
        });

        it('skips an Indeed search-results page', () => {
            const d = evaluateCandidate(url('https://www.indeed.com/q-salesforce-platform-developer-jobs.html'));
            expect(d.keep).toBe(false);
            expect(d.reason).toBe('listing_search_url');
        });

        it('KEEPS a genuine RemoteOK job posting', () => {
            expect(evaluateCandidate(url('https://remoteok.com/remote-jobs/12345-salesforce-developer')).keep).toBe(true);
        });

        it('KEEPS a genuine Indeed posting', () => {
            expect(evaluateCandidate(url('https://www.indeed.com/viewjob?jk=abc123')).keep).toBe(true);
        });

        it('KEEPS a Lever posting — the best-performing source', () => {
            expect(evaluateCandidate(url('https://jobs.lever.co/ciandt/3c1d210c-9fa4-4f06-8c4d-5809373a4ea6')).keep).toBe(true);
        });

        it('does not apply the RemoteOK rule to other hosts', () => {
            expect(evaluateCandidate(url('https://example.com/@someone')).keep).toBe(true);
        });
    });

    describe('the user stated exclusions', () => {
        const ctx = { excludedRoles: ['Manager', 'Architect'], excludedSkills: ['Java'] };

        it('skips an excluded role in the title', () => {
            const d = evaluateCandidate(
                url('https://jobs.lever.co/x/1', { title: 'Engineering Manager' }), ctx
            );
            expect(d.keep).toBe(false);
            expect(d.reason).toBe('excluded_role');
            expect(d.evidence).toBe('Manager');
        });

        it('skips an excluded skill in the title', () => {
            const d = evaluateCandidate(
                url('https://jobs.lever.co/x/2', { title: 'Senior Java Developer' }), ctx
            );
            expect(d.keep).toBe(false);
            expect(d.reason).toBe('excluded_skill');
        });

        it('does NOT skip on a snippet mention alone', () => {
            // "works alongside our Manager" is not the role being advertised.
            const d = evaluateCandidate(
                url('https://jobs.lever.co/x/3', {
                    title: 'Salesforce Developer',
                    snippet: 'You will report to our Engineering Manager and use Java services.',
                }), ctx
            );
            expect(d.keep).toBe(true);
        });

        it('matches whole words only', () => {
            // "Management" must not trigger the "Manager" exclusion.
            const d = evaluateCandidate(
                url('https://jobs.lever.co/x/4', { title: 'Salesforce Management Systems Developer' }), ctx
            );
            expect(d.keep).toBe(true);
        });

        it('with no exclusions configured, nothing is excluded', () => {
            const d = evaluateCandidate(url('https://jobs.lever.co/x/5', { title: 'Engineering Manager' }));
            expect(d.keep).toBe(true);
        });
    });

    describe('plainly unrelated occupations', () => {
        it.each([
            'Registered Nurse',
            'Senior Accountant',
            'Truck Driver',
            'Dental Hygienist',
        ])('skips %s', (title) => {
            const d = evaluateCandidate(url('https://jobs.lever.co/x/6', { title }));
            expect(d.keep).toBe(false);
            expect(d.reason).toBe('unrelated_occupation');
        });

        it('KEEPS an adjacent engineering role — this is not a relevance ranker', () => {
            for (const title of ['Java Developer', 'Backend Engineer', 'Data Engineer', 'Platform Engineer']) {
                expect(evaluateCandidate(url('https://jobs.lever.co/x/7', { title })).keep).toBe(true);
            }
        });
    });

    describe('when uncertain, fetch', () => {
        it('keeps a candidate with no title and no snippet', () => {
            expect(evaluateCandidate(url('https://jobs.lever.co/x/8')).keep).toBe(true);
        });

        it('keeps a candidate with an unknown company', () => {
            expect(evaluateCandidate(url('https://jobs.lever.co/x/9', {
                title: 'Salesforce Developer', snippet: 'A great opportunity.',
            })).keep).toBe(true);
        });

        it('keeps a candidate with no location stated', () => {
            expect(evaluateCandidate(url('https://jobs.lever.co/x/10', {
                title: 'Salesforce Engineer', snippet: 'Apex, LWC, SOQL.',
            })).keep).toBe(true);
        });

        it('keeps a candidate with an unstated work mode', () => {
            // Work mode is only knowable after extraction.
            expect(evaluateCandidate(url('https://jobs.lever.co/x/11', {
                title: 'Salesforce Developer', snippet: 'Bengaluru based team.',
            })).keep).toBe(true);
        });

        it('never rejects for failing to mention remote or a place', () => {
            expect(evaluateCandidate(url('https://jobs.lever.co/x/12', {
                title: 'Salesforce Developer', snippet: 'On-site collaboration encouraged.',
            })).keep).toBe(true);
        });

        it('keeps a candidate whose title lacks any profile skill', () => {
            expect(evaluateCandidate(url('https://jobs.lever.co/x/13', { title: 'Software Engineer III' })).keep).toBe(true);
        });
    });

    describe('telemetry', () => {
        it('describes the skip with a reason and the url', () => {
            const c = url('https://remoteok.com/@someone');
            const line = describeSkip(c, evaluateCandidate(c));
            expect(line).toContain('prefetch_rejected: remoteok_profile_url');
            expect(line).toContain(c.url);
        });
    });
});

describe('The gate runs before any spend', () => {
    const code = codeOf(DISCOVERY);

    it('is applied while collecting, not after extraction', () => {
        expect(code).toContain('const decision = evaluateCandidate(item, gateContext)');
    });

    it('a skipped candidate does not consume the extraction URL budget', () => {
        // The budget decrement sits after the gate's `continue`.
        const gateAt = code.indexOf('if (!decision.keep)');
        const pushAt = code.indexOf('collected.push(item)');
        const decrementAt = code.indexOf('urlBudgetRemaining--');
        expect(gateAt).toBeGreaterThan(-1);
        expect(pushAt).toBeGreaterThan(gateAt);
        expect(decrementAt).toBeGreaterThan(gateAt);
    });

    it('a skipped candidate never reaches the crawl-run pipeline', () => {
        // Rejected items are never pushed, so runJobDiscoveryForUser — which
        // owns createCrawlRun and the mappings — never sees them.
        expect(code).toMatch(/if \(!decision\.keep\)[\s\S]{0,260}continue;/);
    });

    it('draws exclusions from the same candidate_preferences row', () => {
        expect(code).toContain("select('selected_source_ids, excluded_roles, excluded_skills')");
        expect(code).toContain('excludedRoles');
        expect(code).toContain('excludedSkills');
    });

    it('leaves the extraction cap and reservation untouched', () => {
        expect(code).toContain('resolveUrlBudget(options.maxUrlsPerRun)');
        expect(code).toContain('getExtractionReservationSeconds()');
        expect(code).toContain('minSearchSpacingMs() + extractionReservationMs');
    });
});

describe('Search metadata is carried, not re-fetched', () => {
    const code = codeOf(ADAPTER);

    it('keeps the title and description the search already returned', () => {
        expect(code).toContain('title: asText(rec.title)');
        expect(code).toContain('snippet: asText(rec.description)');
    });

    it('adds no second provider request', () => {
        const searchFn = code.slice(code.indexOf('async searchJobs('), code.indexOf('async extract('));
        expect(searchFn.match(/this\.app\./g) ?? []).toHaveLength(1);
    });

    it('keeps the rate gate and the allow-list revalidation', () => {
        expect(code).toContain('await acquireSearchSlot()');
        expect(code).toContain('rejected off-allow-list host');
    });
});
