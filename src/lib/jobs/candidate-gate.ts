import type { DiscoveredURL } from './adapters/types';

/**
 * Conservative pre-extraction gate.
 *
 * Extraction is the expensive operation — a measured ~5 credits per URL — and
 * Production has repeatedly spent it on things that were never job postings:
 * three remoteok.com/@username profile pages in one run, billed and then thrown
 * away by the empty-job gate for 0 new jobs.
 *
 * This gate rejects those BEFORE the spend, using only metadata the search call
 * already returned (url, title, snippet). It issues no request of its own.
 *
 * WHAT THIS IS NOT
 * It is not an early M6 score. A real score needs the extracted posting, and
 * nothing here approximates one. There is no threshold, no percentage and no
 * ranking — only a small set of high-confidence rejections.
 *
 * THE GOVERNING RULE: WHEN UNCERTAIN, FETCH.
 * A false negative silently costs the user a real job they will never see. A
 * false positive costs ~5 credits. Those are not comparable, so every rule
 * below fires only on positive evidence of a mismatch. Absence of information
 * is never evidence: a missing title, a missing snippet, a missing location, an
 * unknown company and an unstated work mode all KEEP the candidate.
 */

export type SkipReason =
    | 'remoteok_profile_url'
    | 'listing_search_url'
    | 'non_posting_url'
    | 'excluded_role'
    | 'excluded_skill'
    | 'unrelated_occupation';

export interface GateDecision {
    keep: boolean;
    /** Set only when keep === false. Internal telemetry, never user-facing. */
    reason?: SkipReason;
    /** The specific evidence that triggered the rejection. */
    evidence?: string;
}

export interface GateContext {
    /** candidate_preferences.excluded_roles */
    excludedRoles?: string[];
    /** candidate_preferences.excluded_skills */
    excludedSkills?: string[];
}

const KEEP: GateDecision = { keep: true };

/**
 * URL shapes that are structurally not a single job posting.
 *
 * Each pattern is drawn from an observed Production waste case, and each is a
 * property of the URL itself rather than a guess about the content.
 */
const NON_POSTING_URL_RULES: Array<{
    reason: SkipReason;
    test: (url: URL) => boolean;
    describe: string;
}> = [
    {
        // remoteok.com/@username — a member profile. Observed 3x in one run,
        // all billed, all rejected downstream as having no job data.
        reason: 'remoteok_profile_url',
        describe: 'member profile page',
        test: (u) => /(^|\.)remoteok\.com$/i.test(u.hostname) && /^\/@[^/]+\/?$/.test(u.pathname),
    },
    {
        // remoteok.com/hire-remotely/... — an employer landing page. Produced
        // one of the two Unknown Title rows.
        reason: 'non_posting_url',
        describe: 'employer landing page',
        test: (u) => /(^|\.)remoteok\.com$/i.test(u.hostname) && u.pathname.startsWith('/hire-remotely'),
    },
    {
        // indeed.com/q-<terms>-jobs.html — a search-results page. These do
        // extract, but the stored job_url then points at a query rather than
        // the posting, which is how four such rows entered the database.
        reason: 'listing_search_url',
        describe: 'search-results page',
        test: (u) => /(^|\.)indeed\.com$/i.test(u.hostname) && /^\/q-.*-jobs\.html$/i.test(u.pathname),
    },
];

/**
 * Occupations far enough from any software role that a title match is decisive.
 *
 * Deliberately tiny and unambiguous. This is not a relevance ranking — it does
 * not reject "Java Developer" for a Salesforce candidate, because adjacent
 * engineering roles are exactly where a surprising-but-good match lives. Only
 * occupations from an unrelated professional domain appear here.
 */
const UNRELATED_OCCUPATIONS = [
    'registered nurse', 'staff nurse', 'nurse practitioner',
    'accountant', 'bookkeeper', 'tax preparer',
    'truck driver', 'delivery driver', 'forklift operator',
    'dental hygienist', 'physical therapist', 'pharmacist',
    'barista', 'line cook', 'server',
    'security guard', 'janitor', 'housekeeper',
    'real estate agent', 'insurance agent',
    'flight attendant', 'paralegal', 'social worker',
];

function normalise(value: string | undefined): string {
    return (value ?? '').toLowerCase().trim();
}

/**
 * Whole-word containment.
 *
 * Substring matching would reject "Java Developer" for an excluded skill of
 * "ava", and would fire on "Manager" inside "Management". Word boundaries keep
 * a rejection defensible.
 */
function containsTerm(haystack: string, term: string): boolean {
    const t = term.toLowerCase().trim();
    if (!t) return false;
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

/**
 * Decide whether a discovered candidate is worth extracting.
 *
 * Returns KEEP unless a rule fires on positive evidence.
 */
export function evaluateCandidate(
    candidate: DiscoveredURL,
    context: GateContext = {}
): GateDecision {
    // ── URL shape ──
    // Judged on the URL alone, so it works even when the provider returned no
    // title and no snippet.
    let parsed: URL | null = null;
    try {
        parsed = new URL(candidate.url);
    } catch {
        // Unparseable here means the allow-list check upstream already passed,
        // so this should not happen. Keep rather than invent a reason.
        return KEEP;
    }

    for (const rule of NON_POSTING_URL_RULES) {
        if (rule.test(parsed)) {
            return { keep: false, reason: rule.reason, evidence: rule.describe };
        }
    }

    // Everything below needs text. With neither title nor snippet there is no
    // evidence to reject on, so the candidate is kept.
    const title = normalise(candidate.title);
    const snippet = normalise(candidate.snippet);
    if (!title && !snippet) return KEEP;

    const haystack = `${title} ${snippet}`.trim();

    // ── The user's own exclusions ──
    // The most defensible rejection available: the user stated it explicitly.
    // Matched against the title only, because a snippet mentioning a term in
    // passing ("...works alongside our Manager...") is not the role itself.
    for (const role of context.excludedRoles ?? []) {
        if (title && containsTerm(title, role)) {
            return { keep: false, reason: 'excluded_role', evidence: role };
        }
    }

    for (const skill of context.excludedSkills ?? []) {
        if (title && containsTerm(title, skill)) {
            return { keep: false, reason: 'excluded_skill', evidence: skill };
        }
    }

    // ── Plainly unrelated occupation ──
    // Title only, and only from the bounded list above.
    for (const occupation of UNRELATED_OCCUPATIONS) {
        if (title && containsTerm(title, occupation)) {
            return { keep: false, reason: 'unrelated_occupation', evidence: occupation };
        }
    }

    // Work mode, location, company and skills are deliberately NOT tested.
    // Search metadata cannot establish any of them: work mode is only known
    // after extraction, a missing location means the snippet omitted it rather
    // than the job being local, and "Worldwide" must never reject a candidate
    // for failing to mention a place.
    return KEEP;
}

/** One-line telemetry string. Internal only — never shown to a user. */
export function describeSkip(candidate: DiscoveredURL, decision: GateDecision): string {
    return `prefetch_rejected: ${decision.reason}` +
        (decision.evidence ? ` (${decision.evidence})` : '') +
        ` — ${candidate.url}`;
}
