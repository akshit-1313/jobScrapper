/**
 * @jest-environment node
 */

/**
 * Search & Discovery dashboard.
 *
 * Discovery configuration was scattered across /profile and /settings. It now
 * lives on one page. The risk in a move like this is not layout — it is quietly
 * growing a SECOND way to store or write the same thing, so most of these tests
 * assert that the new page reuses the existing storage and the existing actions
 * rather than that it looks a particular way.
 *
 * Nothing here invokes discovery, and nothing here calls Firecrawl.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { nextDailyRunUtc, DAILY_RUN_HOUR_UTC } from '@/lib/jobs/daily-schedule';
import { buildUsageSummary, isWholeRunCost, type LastRunRecord } from '@/lib/firecrawl/usage-model';

const SRC = join(__dirname, '..', 'src');

const PAGE = join(SRC, 'app', '(dashboard)', 'search-discovery', 'page.tsx');
const PROFILE_PAGE = join(SRC, 'app', '(dashboard)', 'profile', 'page.tsx');
const SETTINGS_PAGE = join(SRC, 'app', '(dashboard)', 'settings', 'page.tsx');
const JOBS_PAGE = join(SRC, 'app', '(dashboard)', 'jobs', 'page.tsx');
const SIDEBAR = join(SRC, 'components', 'sidebar.tsx');
const PARAMS_PANEL = join(SRC, 'components', 'discovery', 'search-parameters-panel.tsx');
const DAILY_PANEL = join(SRC, 'components', 'discovery', 'daily-discovery-panel.tsx');
const USAGE_PANEL = join(SRC, 'components', 'firecrawl', 'firecrawl-usage-panel.tsx');
const USAGE_SERVICE = join(SRC, 'lib', 'firecrawl', 'usage-service.ts');

const raw = (path: string) => readFileSync(path, 'utf8');

/** Strip comments so an explanatory note is never mistaken for live code. */
function codeOf(path: string): string {
    return raw(path)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .split('\n')
        .filter(line => !line.trim().startsWith('//'))
        .join('\n');
}

describe('The Search & Discovery page exists and is guarded', () => {
    it('is routed at /search-discovery', () => {
        expect(existsSync(PAGE)).toBe(true);
    });

    it('exports a default page component', () => {
        expect(codeOf(PAGE)).toContain('export default async function SearchDiscoveryPage');
    });

    it('is titled Search & Discovery', () => {
        const code = raw(PAGE);
        expect(code).toContain("title: 'Search & Discovery'");
        expect(code).toContain('Search &amp; Discovery');
    });

    it('redirects an unauthenticated visitor rather than rendering', () => {
        const code = codeOf(PAGE);
        expect(code).toContain('supabase.auth.getUser()');
        expect(code).toMatch(/if \(!authData\.user\) \{\s*redirect\('\/login'\)/);
    });
});

describe('All five sections render on the page', () => {
    const code = codeOf(PAGE);

    it.each([
        ['Find Matching Jobs', 'FindJobsButton'],
        ['Search Parameters + Job Sources', 'SearchParametersPanel'],
        ['Firecrawl Usage', 'FirecrawlUsagePanel'],
        ['Daily Job Search', 'DailyDiscoveryPanel'],
    ])('renders %s', (_label, component) => {
        expect(code).toContain(`<${component}`);
    });

    it('passes each panel the props it needs', () => {
        expect(code).toContain('hasProfileData={hasProfileData}');
        expect(code).toContain('initialValues={searchParameters}');
        expect(code).toContain('availableSources={availableSources}');
        expect(code).toContain('usage={usage}');
        expect(code).toContain('initialEnabled={dailyEnabled}');
    });
});

describe('Deep links resolve to a section', () => {
    const ANCHORS: Array<[string, string]> = [
        ['search-parameters', PARAMS_PANEL],
        ['job-sources', PARAMS_PANEL],
        ['firecrawl-usage', USAGE_PANEL],
        ['daily-discovery', DAILY_PANEL],
    ];

    it.each(ANCHORS)('#%s has a matching element id', (anchor, file) => {
        expect(raw(file)).toContain(`id="${anchor}"`);
    });

    it('offsets anchored sections so a jump does not hide the heading', () => {
        for (const [, file] of ANCHORS) {
            expect(raw(file)).toContain('scroll-mt-24');
        }
    });

    it('the page links to every anchor', () => {
        const code = raw(PAGE);
        for (const [anchor] of ANCHORS) {
            expect(code).toContain(`#${anchor}`);
        }
    });
});

describe('No duplicate storage or duplicate actions', () => {
    const page = codeOf(PAGE);

    it('search parameters and job sources come from the one preferences row', () => {
        expect(page).toContain("from('candidate_preferences')");
        expect(page).toContain('selected_source_ids');
        expect(page).toContain('toSearchParameters');
    });

    it('saves through the existing saveSearchParameters action only', () => {
        const panel = codeOf(PARAMS_PANEL);
        expect(panel).toContain("from '@/app/actions/search-parameters-actions'");
        expect(panel).toContain('saveSearchParameters(values)');
        // One write path: a second call site would be a second way to persist.
        expect(panel.match(/saveSearchParameters\(/g)).toHaveLength(1);
    });

    it('the daily toggle keeps profiles.daily_discovery_enabled as its source of truth', () => {
        expect(page).toContain('daily_discovery_enabled');
        expect(codeOf(DAILY_PANEL)).toContain('setDailyDiscoveryEnabled(next)');
    });

    it('the page defines no server action and no table write of its own', () => {
        expect(page).not.toContain("'use server'");
        expect(page).not.toContain('.insert(');
        expect(page).not.toContain('.update(');
        expect(page).not.toContain('.upsert(');
    });

    it('introduces no new migration', () => {
        const migrations = require('fs')
            .readdirSync(join(__dirname, '..', 'supabase', 'migrations'))
            .filter((f: string) => f.endsWith('.sql'));
        expect(migrations.some((f: string) => /search.?discovery/i.test(f))).toBe(false);
    });
});

describe('Saving still works from both cards', () => {
    const panel = codeOf(PARAMS_PANEL);

    it('renders Search Parameters and Job Sources as two separate sections', () => {
        expect(panel).toContain('id="search-parameters"');
        expect(panel).toContain('id="job-sources"');
    });

    it('both sections sit in one component sharing one state', () => {
        // Two cards, but a single values object — so saving from either card
        // cannot discard unsaved edits made in the other.
        expect(panel.match(/useState<SearchParametersValues>/g)).toHaveLength(2); // saved + values
        expect(panel.match(/const saveButton = \(/g)).toHaveLength(1);
    });

    it('keeps the dirty/saved indicator on both cards', () => {
        expect(panel.match(/<SaveState isDirty=\{isDirty\} \/>/g)).toHaveLength(2);
    });

    it('still refuses to persist an empty explicit source selection', () => {
        expect(panel).toContain('const noSourceChosen = chooseSources && values.selected_source_ids.length === 0');
        expect(panel).toContain('disabled={isPending || !isDirty || noSourceChosen}');
    });

    it('keeps All sources meaning the empty array', () => {
        expect(panel).toContain("if (!choose) set('selected_source_ids', [])");
        expect(panel).toContain('All sources ({availableSources.length})');
    });

    it('states the per-run source cap unchanged', () => {
        expect(raw(PARAMS_PANEL))
            .toContain('Up to 3 sources are searched per run on the current Hobby plan.');
    });

    it('offers only globally active sources', () => {
        expect(codeOf(PAGE)).toContain("from('job_sources').select('id, name').eq('active', true)");
    });

    it('still edits all seven search parameter fields', () => {
        for (const label of [
            'Target Roles', 'Work Mode', 'Geographic Scope', 'Remote Search Terms',
            'Additional Keywords', 'Exclude Keywords', 'Exclude Roles',
        ]) {
            expect(raw(PARAMS_PANEL)).toContain(label);
        }
    });
});

describe('Find Matching Jobs still runs the validated Phase 3 path', () => {
    it('the page uses the same button component, not a copy', () => {
        expect(codeOf(PAGE)).toContain("from '@/components/profile/find-jobs-button'");
    });

    it('the button still calls findMatchingJobsAction', () => {
        const code = codeOf(join(SRC, 'components', 'profile', 'find-jobs-button.tsx'));
        expect(code).toContain('findMatchingJobsAction');
        expect(code).not.toContain('triggerDiscoveryAction');
        expect(code).not.toContain('runJobDiscovery');
    });

    it('explains what the search will do', () => {
        expect(raw(join(SRC, 'components', 'profile', 'find-jobs-button.tsx')))
            .toContain('Search the selected job sources using your profile and saved search parameters.');
    });

    it('the page never invokes discovery itself', () => {
        const page = codeOf(PAGE);
        expect(page).not.toContain('findMatchingJobsAction(');
        expect(page).not.toContain('runProfileTargetedDiscovery');
    });
});

describe('Firecrawl usage renders from the stored snapshot', () => {
    it('the page reads the panel data through the existing service', () => {
        const page = codeOf(PAGE);
        expect(page).toContain("from '@/lib/firecrawl/usage-service'");
        expect(page).toContain('getUsagePanelData(dailyEnabled)');
    });

    it('the page never constructs a Firecrawl client or refreshes on render', () => {
        const page = codeOf(PAGE);
        expect(page).not.toContain('FirecrawlApp');
        expect(page).not.toContain('firecrawl-js');
        expect(page).not.toContain('refreshUsageSnapshot');
        expect(page).not.toContain('FIRECRAWL_API_KEY');
    });

    it('getUsagePanelData still reads storage only', () => {
        const service = raw(USAGE_SERVICE);
        const body = service.slice(service.indexOf('export async function getUsagePanelData'));
        expect(body).toContain('readLatestSnapshot()');
        expect(body).toContain('readObservedRunCosts()');
        expect(body).toContain('readLastManualRun()');
        expect(body).not.toContain('fetchAndStoreSnapshot');
    });

    it('the last manual run is read from the existing ledger, not a new table', () => {
        const service = raw(USAGE_SERVICE);
        expect(service).toContain("from('firecrawl_usage_ledgers')");
        expect(service).toContain("eq('operation_type', 'manual_discovery')");
        expect(service).not.toContain('manual_run_history');
    });

    it('keeps actual and estimated visually separate', () => {
        const panel = raw(USAGE_PANEL);
        expect(panel).toContain('Actual — reported by Firecrawl');
        // Every forecast carries the tag.
        for (const label of ['Per run', 'Runs left this period', 'Cron reserve', 'Safe budget', 'Safety reserve']) {
            expect(panel).toMatch(new RegExp(`${label}<Estimated />`));
        }
    });

    it('shows the snapshot timestamp with the actual figures', () => {
        expect(raw(USAGE_PANEL)).toContain('Last refreshed: {formatUtc(a.fetchedAt)}');
    });

    it('says so plainly when no balance has been recorded', () => {
        expect(raw(USAGE_PANEL)).toContain('No balance recorded yet');
    });
});

describe('The manual run block reports what is actually known', () => {
    const base = {
        snapshot: null,
        dailyDiscoveryEnabled: false,
        observedRunCosts: [] as number[],
    };

    it('reports no manual run before one is recorded', () => {
        expect(buildUsageSummary(base).lastManualRun).toBeNull();
        expect(raw(USAGE_PANEL)).toContain('Not run yet');
    });

    it('carries the recorded run through unchanged', () => {
        const run: LastRunRecord = {
            at: '2026-08-29T07:35:23Z',
            creditsConsumed: 14,
            pagesScraped: 1,
            reconciliation: 'provider_usage_unknown',
        };
        expect(buildUsageSummary({ ...base, lastManualRun: run }).lastManualRun).toEqual(run);
    });

    it('treats an unreconciled figure as a lower bound, not a total', () => {
        expect(isWholeRunCost({
            at: 'x', creditsConsumed: 14, pagesScraped: 1,
            reconciliation: 'provider_usage_unknown',
        })).toBe(false);
        expect(isWholeRunCost({
            at: 'x', creditsConsumed: 14, pagesScraped: 1,
            reconciliation: 'reconciled',
        })).toBe(true);
        expect(isWholeRunCost(null)).toBe(false);
        expect(raw(USAGE_PANEL)).toContain('extraction only — at least this much');
    });
});

describe('Daily Job Search states the schedule without changing it', () => {
    it('shows the toggle, 04:00 UTC and the last run', () => {
        const panel = raw(DAILY_PANEL);
        expect(panel).toContain('Daily Job Search');
        expect(panel).toContain('04:00 UTC');
        expect(panel).toContain('Last run');
        expect(panel).toContain('Not run yet');
    });

    it('shows the next scheduled run', () => {
        expect(raw(DAILY_PANEL)).toContain('Next scheduled run');
        expect(codeOf(PAGE)).toContain('nextRunAt={nextDailyRunUtc().toISOString()}');
    });

    it('says nothing is scheduled while the toggle is off', () => {
        expect(raw(DAILY_PANEL)).toContain('Not scheduled — daily search is off');
    });

    it('explains that it uses the saved parameters and selected sources', () => {
        const panel = raw(DAILY_PANEL);
        expect(panel).toContain('search parameters');
        expect(panel).toContain('selected job sources');
        expect(panel).toContain('#search-parameters');
        expect(panel).toContain('#job-sources');
    });

    it('states the Hobby limitation', () => {
        expect(raw(DAILY_PANEL)).toContain('Hobby plan limit:');
    });

    it('is never enabled on the user behalf', () => {
        const page = codeOf(PAGE);
        expect(page).not.toContain('setDailyDiscoveryEnabled');
        expect(page).toContain('initialEnabled={dailyEnabled}');
        // The stored value is read, never defaulted to true.
        expect(page).toContain('daily_discovery_enabled === true');
    });

    describe('nextDailyRunUtc', () => {
        it('mirrors the 04:00 UTC cron hour', () => {
            expect(DAILY_RUN_HOUR_UTC).toBe(4);
        });

        it('returns today when 04:00 UTC is still ahead', () => {
            expect(nextDailyRunUtc(new Date('2026-08-29T01:15:00Z')).toISOString())
                .toBe('2026-08-29T04:00:00.000Z');
        });

        it('rolls to tomorrow once the hour has passed', () => {
            expect(nextDailyRunUtc(new Date('2026-08-29T14:46:00Z')).toISOString())
                .toBe('2026-08-30T04:00:00.000Z');
        });

        it('rolls forward at exactly 04:00 rather than returning now', () => {
            expect(nextDailyRunUtc(new Date('2026-08-29T04:00:00Z')).toISOString())
                .toBe('2026-08-30T04:00:00.000Z');
        });

        it('crosses a month boundary correctly', () => {
            expect(nextDailyRunUtc(new Date('2026-08-31T23:00:00Z')).toISOString())
                .toBe('2026-09-01T04:00:00.000Z');
        });
    });
});

describe('Profile keeps candidate information and the run button, nothing else', () => {
    const code = codeOf(PROFILE_PAGE);

    it('no longer renders the discovery configuration panels', () => {
        expect(code).not.toContain('SearchParametersPanel');
        expect(code).not.toContain('FirecrawlUsagePanel');
        expect(code).not.toContain('getUsagePanelData');
    });

    it('no longer queries preferences, sources or the daily flag', () => {
        expect(code).not.toContain('selected_source_ids');
        expect(code).not.toContain("from('job_sources')");
        expect(code).not.toContain('daily_discovery_enabled');
        expect(code).not.toContain('toSearchParameters');
    });

    it('keeps the candidate sections', () => {
        for (const section of ['ResumeSection', 'StructuredProfile', 'ProfileForm', 'SkillsForm', 'ExperienceForm']) {
            expect(code).toContain(`<${section}`);
        }
    });

    it('keeps the manual discovery entry point', () => {
        expect(code).toContain('<FindJobsButton hasProfileData={hasProfileData} />');
    });

    it('links to the new dashboard', () => {
        expect(code).toContain('href="/search-discovery"');
    });
});

describe('Settings links instead of duplicating', () => {
    const code = codeOf(SETTINGS_PAGE);

    it('no longer renders the daily search or usage panels', () => {
        expect(code).not.toContain('DailyDiscoveryPanel');
        expect(code).not.toContain('FirecrawlUsagePanel');
        expect(code).not.toContain('getUsagePanelData');
    });

    it('offers a link to Search & Discovery', () => {
        expect(code).toContain('href="/search-discovery"');
        expect(raw(SETTINGS_PAGE)).toContain('Manage Search &amp; Discovery');
    });

    it('keeps unrelated account functionality', () => {
        expect(code).toContain('<IntegrationPanel');
        expect(code).toContain("from('user_integrations')");
    });

    it('no stale panel file is left behind in the settings folder', () => {
        expect(existsSync(join(SRC, 'app', '(dashboard)', 'settings', 'daily-discovery-panel.tsx')))
            .toBe(false);
    });
});

describe('Navigation', () => {
    const code = codeOf(SIDEBAR);

    it('lists Search & Discovery pointing at the canonical route', () => {
        expect(code).toContain("{ name: 'Search & Discovery', href: '/search-discovery'");
    });

    it('keeps the existing navigation mechanism', () => {
        expect(code).toContain("from 'next/link'");
        expect(code).toContain('navItems.map');
        expect(code).toContain('usePathname()');
    });

    it('keeps every pre-existing destination', () => {
        for (const href of ['/dashboard', '/jobs', '/saved', '/applications', '/profile', '/preferences', '/settings']) {
            expect(code).toContain(`href: '${href}'`);
        }
    });
});

/**
 * Every action whose panel moved to the dashboard must revalidate it.
 *
 * The move left three actions revalidating pages that no longer host their
 * panel, and none revalidating the page the user is actually looking at — so a
 * successful write could leave a stale dashboard behind it. The old paths are
 * kept: they still read the same rows.
 */
describe('Writes revalidate the dashboard they came from', () => {
    const ACTIONS = join(SRC, 'app', 'actions');

    const REVALIDATION: Array<{ file: string; action: string; preserved: string[] }> = [
        { file: 'search-parameters-actions.ts', action: 'saveSearchParameters', preserved: ['/profile', '/preferences'] },
        { file: 'daily-discovery-actions.ts', action: 'setDailyDiscoveryEnabled', preserved: ['/settings'] },
        { file: 'usage-actions.ts', action: 'refreshFirecrawlUsage', preserved: ['/profile', '/settings'] },
    ];

    it.each(REVALIDATION)('$action revalidates /search-discovery', ({ file }) => {
        expect(codeOf(join(ACTIONS, file))).toContain("revalidatePath('/search-discovery')");
    });

    it.each(REVALIDATION)('$action keeps every path it already revalidated', ({ file, preserved }) => {
        const code = codeOf(join(ACTIONS, file));
        for (const path of preserved) {
            expect(code).toContain(`revalidatePath('${path}')`);
        }
    });

    it('adds revalidation without changing what the actions do', () => {
        // Storage, conflict target and the session-derived user id are the parts
        // that must not drift while paths are added.
        const params = codeOf(join(ACTIONS, 'search-parameters-actions.ts'));
        expect(params).toContain("from('candidate_preferences')");
        expect(params).toContain("onConflict: 'user_id'");
        expect(params).toContain('user_id: user.id');

        const daily = codeOf(join(ACTIONS, 'daily-discovery-actions.ts'));
        expect(daily).toContain("from('profiles')");
        expect(daily).toContain('daily_discovery_enabled: enabled');
        expect(daily).toContain("eq('user_id', user.id)");

        const usage = codeOf(join(ACTIONS, 'usage-actions.ts'));
        expect(usage).toContain('refreshUsageSnapshot()');
        expect(usage).not.toContain('getCreditUsage');
    });

    it('revalidates only after the write is known to have succeeded', () => {
        // A failed save must not tell Next the page changed.
        for (const { file } of REVALIDATION) {
            const code = codeOf(join(ACTIONS, file));
            const firstRevalidate = code.indexOf("revalidatePath('/search-discovery')");
            const errorReturn = code.indexOf('return { success: false');
            expect(errorReturn).toBeGreaterThan(-1);
            expect(firstRevalidate).toBeGreaterThan(errorReturn);
        }
    });

    it('still exposes no credential through the refresh action', () => {
        const usage = raw(join(ACTIONS, 'usage-actions.ts'));
        expect(usage).not.toContain('FIRECRAWL_API_KEY');
        expect(usage).not.toContain('remainingCredits');
    });
});

describe('Jobs stays focused on jobs', () => {
    const code = codeOf(JOBS_PAGE);

    it('gains no discovery dashboard', () => {
        expect(code).not.toContain('FirecrawlUsagePanel');
        expect(code).not.toContain('SearchParametersPanel');
        expect(code).not.toContain('DailyDiscoveryPanel');
        expect(code).not.toContain('getUsagePanelData');
    });

    it('keeps saved and applied state', () => {
        expect(code).toContain('buildSavedStatusMap');
        expect(code).toContain('buildAppliedSet');
    });

    it('keeps the bookmark control and the apply flow where they were', () => {
        expect(existsSync(join(SRC, 'components', 'jobs', 'save-job-button.tsx'))).toBe(true);
        expect(codeOf(join(SRC, 'app', '(dashboard)', 'jobs', '[id]', 'page.tsx')))
            .toContain('<JobTrackingButtons');
    });

    it('still has no Sync Now', () => {
        expect(codeOf(join(SRC, 'app', '(dashboard)', 'jobs', 'job-search-filters.tsx')))
            .not.toContain('Sync Now');
    });
});

describe('The validated discovery configuration is untouched', () => {
    it('the cron schedule is still 0 4 * * * and the only entry', () => {
        const vercel = JSON.parse(raw(join(__dirname, '..', 'vercel.json')));
        expect(vercel.crons).toEqual([
            { path: '/api/cron/daily-discovery', schedule: '0 4 * * *' },
        ]);
        expect(vercel.env.PROFILE_SEARCH_TIMEOUT_SECONDS).toBe('55');
        expect(vercel.env.PROFILE_EXTRACTION_RESERVATION_SECONDS).toBe('45');
    });

    it('no UI file reaches into the rate gate, caps or budgets', () => {
        for (const file of [PAGE, PROFILE_PAGE, SETTINGS_PAGE, PARAMS_PANEL, DAILY_PANEL, USAGE_PANEL]) {
            const code = codeOf(file);
            expect(code).not.toContain('acquireSearchSlot');
            expect(code).not.toContain('minSearchSpacingMs');
            expect(code).not.toContain('PROFILE_SEARCH_MAX_SOURCES');
            expect(code).not.toContain('ExecutionBudget');
        }
    });

    it('no UI file touches M8', () => {
        for (const file of [PAGE, PROFILE_PAGE, SETTINGS_PAGE]) {
            expect(codeOf(file)).not.toContain('m8');
            expect(codeOf(file)).not.toContain('M8');
        }
    });
});
