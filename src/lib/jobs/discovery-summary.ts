/**
 * Success text for a completed profile-targeted discovery run.
 *
 * Pure and framework-free so the wording is unit-testable without a DOM: the
 * message previously claimed jobs were "matched" as a hardcoded string, which
 * stayed true even when every job_matches write was rejected. The counts here
 * come from what the run actually persisted, so the sentence cannot overstate
 * the outcome.
 */
export function formatDiscoverySummary(pagesScraped: number, matchesPersisted: number): string {
    const pages = Math.max(0, Math.trunc(pagesScraped || 0));
    const matches = Math.max(0, Math.trunc(matchesPersisted || 0));

    const pagePart = `${pages} job page${pages === 1 ? '' : 's'} processed`;
    const matchPart = `${matches} match${matches === 1 ? '' : 'es'} saved`;

    return `Search complete — ${pagePart}, ${matchPart}.`;
}
