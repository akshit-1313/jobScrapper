/**
 * @jest-environment node
 *
 * UI truthfulness for the profile-targeted discovery result.
 *
 * The success banner used to read "N job page(s) processed and matched." with
 * "and matched" as literal text inside the `result.success` branch. It printed
 * regardless of whether any job_matches row was written — and during the first
 * production run, none were. The wording now derives from the persisted count.
 *
 * The rendering itself is a pure function so it can be asserted without a DOM
 * (this project has no jsdom or testing-library dependency), plus a guard that
 * the component does not reintroduce the hardcoded claim.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { formatDiscoverySummary } from '@/lib/jobs/discovery-summary';

const BUTTON_PATH = join(__dirname, '..', 'src', 'components', 'profile', 'find-jobs-button.tsx');

describe('6. UI reports what was actually persisted', () => {
    describe('formatDiscoverySummary', () => {
        it('reports a single page and a single saved match in the singular', () => {
            expect(formatDiscoverySummary(1, 1))
                .toBe('Search complete — 1 job page processed, 1 match saved.');
        });

        it('states zero matches plainly rather than claiming a match', () => {
            expect(formatDiscoverySummary(1, 0))
                .toBe('Search complete — 1 job page processed, 0 matches saved.');
        });

        it('pluralises pages and matches together', () => {
            expect(formatDiscoverySummary(4, 3))
                .toBe('Search complete — 4 job pages processed, 3 matches saved.');
        });

        it('handles a run that scraped nothing', () => {
            expect(formatDiscoverySummary(0, 0))
                .toBe('Search complete — 0 job pages processed, 0 matches saved.');
        });

        it('never claims a match when the persisted count is absent or negative', () => {
            expect(formatDiscoverySummary(1, undefined as unknown as number)).toContain('0 matches saved');
            expect(formatDiscoverySummary(1, -5)).toContain('0 matches saved');
        });

        it('never emits the unconditional "and matched" phrasing', () => {
            for (const [pages, matches] of [[0, 0], [1, 0], [1, 1], [4, 3]]) {
                expect(formatDiscoverySummary(pages, matches)).not.toContain('and matched');
            }
        });
    });

    describe('FindJobsButton', () => {
        const source = readFileSync(BUTTON_PATH, 'utf8');

        it('does not hardcode a success message claiming jobs were matched', () => {
            expect(source).not.toContain('and matched');
        });

        it('renders the summary from the persisted count', () => {
            expect(source).toContain('formatDiscoverySummary');
            expect(source).toContain('matchesPersisted');
        });
    });
});
