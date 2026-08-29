/**
 * @jest-environment node
 *
 * The legacy Sync Now entry point must stay unreachable.
 *
 * Sync Now called triggerDiscoveryAction -> runJobDiscovery -> the raw M2
 * runner with no overrides: all 10 active sources, up to 5 URLs each (up to 50
 * extractions per click), no extraction reservation, no wall-clock budget,
 * discover() bypassing the Firecrawl search rate gate, and no m8_cron_runs
 * mutex — so it could also run concurrently with Find Matching Jobs and with
 * the daily cron.
 *
 * It appeared harmless only because discover() mis-parses the Firecrawl v2
 * MapData.links shape and returns []. Repairing that would activate the
 * unbounded path, so the UI entry point was withdrawn first.
 *
 * These tests assert the UI surface, NOT the legacy functions, which are
 * deliberately retained. Nothing here invokes raw M2 discovery.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'src');

const JOBS_UI_FILES = [
    join(SRC, 'app', '(dashboard)', 'jobs', 'job-search-filters.tsx'),
    join(SRC, 'app', '(dashboard)', 'jobs', 'page.tsx'),
    join(SRC, 'app', '(dashboard)', 'jobs', 'save-search-button.tsx'),
    join(SRC, 'components', 'job-card.tsx'),
    join(SRC, 'components', 'jobs', 'save-job-button.tsx'),
];

/** Strip comments so an explanatory note is not mistaken for live code. */
function codeOf(path: string): string {
    return readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(line => !line.trim().startsWith('//'))
        .join('\n');
}

describe('Legacy Sync Now is unreachable from the UI', () => {
    describe('the /jobs filter bar', () => {
        const code = codeOf(JOBS_UI_FILES[0]);

        it('renders no Sync Now control', () => {
            expect(code).not.toContain('Sync Now');
        });

        it('does not import or call triggerDiscoveryAction', () => {
            expect(code).not.toContain('triggerDiscoveryAction');
        });

        it('has no discovery handler or pending state left behind', () => {
            expect(code).not.toContain('handleRunDiscovery');
            expect(code).not.toContain('isDiscovering');
        });

        it('still provides its actual job: filtering and sorting', () => {
            expect(code).toContain('Apply Filters');
            expect(code).toContain("params.set('status'");
            expect(code).toContain('relevance');
        });
    });

    describe('no other /jobs surface exposes the raw M2 path', () => {
        it.each(JOBS_UI_FILES)('%s does not call triggerDiscoveryAction', (file) => {
            expect(codeOf(file)).not.toContain('triggerDiscoveryAction');
        });
    });

    describe('Find Matching Jobs still uses the validated Phase 3 engine', () => {
        it('the profile button calls findMatchingJobsAction, not the raw runner', () => {
            const code = codeOf(join(SRC, 'components', 'profile', 'find-jobs-button.tsx'));
            expect(code).toContain('findMatchingJobsAction');
            expect(code).not.toContain('triggerDiscoveryAction');
            expect(code).not.toContain('runJobDiscovery');
        });

        it('findMatchingJobsAction routes to runProfileTargetedDiscovery', () => {
            const code = codeOf(join(SRC, 'app', 'actions', 'discovery-actions.ts'));
            expect(code).toMatch(/findMatchingJobsAction[\s\S]*runProfileTargetedDiscovery/);
        });
    });

    describe('the legacy implementation is retained, only its entry point is gone', () => {
        it('keeps triggerDiscoveryAction and runJobDiscovery defined', () => {
            expect(codeOf(join(SRC, 'app', 'actions', 'discovery-actions.ts')))
                .toContain('export async function triggerDiscoveryAction');
            expect(codeOf(join(SRC, 'lib', 'jobs', 'discovery-service.ts')))
                .toContain('export async function runJobDiscovery(');
        });

        it('leaves discover() untouched — repairing it is a separate decision', () => {
            expect(codeOf(join(SRC, 'lib', 'jobs', 'adapters', 'firecrawl-adapter.ts')))
                .toContain('async discover(');
        });
    });
});
