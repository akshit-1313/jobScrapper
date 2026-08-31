/**
 * M5 → M2 bridge: turn a structured candidate profile into targeted job-search
 * queries.
 *
 * Fully deterministic — static maps and set operations. No LLM, no network, no
 * API cost. Nothing is invented: every title and skill in a generated query
 * comes from the candidate's own profile data, except role synonyms drawn from
 * a small generic vocabulary (developer/engineer/programmer, salesforce→crm).
 *
 * Explicitly NOT "concatenate the resume into one query": queries are built as
 * (title × focused skill cluster) pairs so each search targets one coherent
 * role shape.
 */
import type { SkillCategory } from '@/lib/types/resume'

// ── Inputs (shaped as the candidate_* tables return them) ───────────────────

export interface StrategyProfile {
    headline?: string | null
    years_of_experience?: number | null
    current_location?: string | null
}

export interface StrategySkill {
    skill_name: string
    category?: SkillCategory | null
    is_primary?: boolean | null
}

export interface StrategyExperience {
    title: string
    is_current?: boolean | null
}

export interface StrategyEngagement {
    technologies?: string[] | null
    domains?: string[] | null
}

export interface StrategyPreferences {
    desired_roles?: string[] | null
    excluded_roles?: string[] | null
    geographic_preferences?: string[] | null
    /** Preferred work modes. Only 'remote' influences query wording. */
    work_modes?: string[] | null
    /** Remote-intent phrases, rotated across strategies. Empty adds nothing. */
    remote_search_terms?: string[] | null
    /** Extra keywords the user wants searched alongside profile skills. */
    desired_skills?: string[] | null
    /** Keywords removed from the query skill pool entirely. */
    excluded_skills?: string[] | null
}

export interface StrategyInput {
    profile: StrategyProfile | null
    skills: StrategySkill[]
    experience: StrategyExperience[]
    engagements: StrategyEngagement[]
    preferences: StrategyPreferences | null
}

export interface SearchStrategy {
    /** The query string sent to the search provider. */
    query: string
    /** The job title this query targets. */
    title: string
    /** Skills included in this query. */
    skills: string[]
    /** Remote-intent phrase applied to this query, if any. */
    remoteTerm?: string
    /** Geographic term applied to this query, if any. */
    geoTerm?: string
    /** Why this query exists — for logging and admin display. */
    rationale: string
}

export interface StrategyOptions {
    /** Hard cap on generated queries. Bounds credit spend. */
    maxQueries?: number
    /** Skills included per query. Too many over-constrains the search. */
    skillsPerQuery?: number
    /**
     * Where this run starts in the explicit role list.
     *
     * A run can only afford a few queries, so with more roles than slots some
     * roles must wait. Advancing this between runs is what stops a role at the
     * end of the list from waiting forever. Persisted by the caller in
     * candidate_preferences.role_rotation_offset and shared by the manual and
     * scheduled paths, so the two advance one pointer rather than each
     * re-searching the same positions.
     *
     * Normalised internally: out-of-range, negative and non-integer values are
     * all folded back into [0, N), so a shrinking role list needs no reset.
     */
    rotationOffset?: number
}

export const DEFAULT_MAX_QUERIES = 5
export const DEFAULT_SKILLS_PER_QUERY = 3

// ── Run-wide extraction budget ──────────────────────────────────────────────
//
// Set from three live measurements. Measured cost model, confirmed three times:
//
//     credits ≈ 4 + (5 × URLs extracted)
//
//   run 1: 7 searches,  0 extractions →  4 credits
//   run 2: 7 searches,  5 extractions → 29 credits
//   run 3: 9 searches,  3 extractions → 19 credits
//
// 4 URLs → ~24 credits/run → ~720/month at one run per day, leaving ~28%
// headroom on a 1,000-credit plan.
//
// These live here rather than in discovery-service so the budget rule is
// unit-testable: discovery-service constructs a Supabase admin client at module
// load and cannot be imported in a test environment.

export const PROFILE_SEARCH_DEFAULT_MAX_URLS_PER_RUN = 4

/**
 * Absolute ceiling on URLs extracted in one discovery run.
 *
 * A caller may request FEWER, never more — extraction is the expensive
 * operation, so this is the hard stop that bounds spend.
 */
export const PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN = 4

/**
 * Resolve the effective run-wide URL budget.
 *
 * Clamped to [1, PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN]. Non-finite or absent
 * input falls back to the default. Fractional input is floored, so a request
 * can never round upward into extra spend.
 */
export function resolveUrlBudget(requested?: number | null): number {
    const value =
        typeof requested === 'number' && Number.isFinite(requested)
            ? Math.floor(requested)
            : PROFILE_SEARCH_DEFAULT_MAX_URLS_PER_RUN

    return Math.max(1, Math.min(value, PROFILE_SEARCH_HARD_MAX_URLS_PER_RUN))
}

// ── Generic role vocabulary (not specific to any employer or resume) ────────

/** Interchangeable role nouns. Bidirectional. */
const ROLE_SYNONYMS: string[][] = [
    ['developer', 'engineer', 'programmer'],
    ['analyst', 'specialist'],
    ['architect', 'lead architect'],
    ['administrator', 'admin'],
    ['consultant', 'advisor'],
]

/** Platform → the discipline it belongs to, so adjacent titles are reachable. */
const PLATFORM_DOMAIN_SYNONYMS: Record<string, string> = {
    salesforce: 'crm',
    sfdc: 'crm',
    dynamics: 'crm',
    sap: 'erp',
    netsuite: 'erp',
    workday: 'hcm',
    servicenow: 'itsm',
    shopify: 'ecommerce',
    magento: 'ecommerce',
}

/** Seniority words stripped when generating alternative titles. */
const SENIORITY_TOKENS = new Set([
    'senior', 'sr', 'junior', 'jr', 'lead', 'principal', 'staff', 'associate', 'intern',
])

export function normalizeTitle(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9+#.\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Title-cases a normalized title for display in the query. */
function presentTitle(title: string): string {
    return title.split(' ').filter(Boolean)
        .map(w => w.length <= 3 && w === w.toLowerCase() && /^[a-z]+$/.test(w) && ['crm', 'erp', 'hcm'].includes(w)
            ? w.toUpperCase()
            : w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
}

/**
 * Expand one title into related titles using the generic vocabulary above.
 * Returns the original first, then alternatives, deduplicated.
 */
export function deriveAlternativeTitles(title: string): string[] {
    const base = normalizeTitle(title)
    if (!base) return []

    const out: string[] = [base]
    const push = (t: string) => {
        const n = normalizeTitle(t)
        if (n && !out.includes(n)) out.push(n)
    }

    const tokens = base.split(' ')
    const withoutSeniority = tokens.filter(t => !SENIORITY_TOKENS.has(t))
    if (withoutSeniority.length && withoutSeniority.length !== tokens.length) {
        push(withoutSeniority.join(' '))
    }

    const core = withoutSeniority.length ? withoutSeniority : tokens

    // Swap the role noun for each synonym.
    for (const group of ROLE_SYNONYMS) {
        const idx = core.findIndex(t => group.includes(t))
        if (idx === -1) continue
        for (const syn of group) {
            if (syn === core[idx]) continue
            const swapped = [...core]
            swapped[idx] = syn
            push(swapped.join(' '))
        }
    }

    // Swap a platform token for its discipline ("salesforce developer" → "crm developer").
    for (let i = 0; i < core.length; i++) {
        const domain = PLATFORM_DOMAIN_SYNONYMS[core[i]]
        if (!domain) continue
        const swapped = [...core]
        swapped[i] = domain
        push(swapped.join(' '))
    }

    return out
}

// ── Skill selection ─────────────────────────────────────────────────────────

/** Categories that describe concrete technology, most useful in a job query. */
const TECHNICAL_CATEGORIES: SkillCategory[] = [
    'language', 'framework', 'library', 'database', 'cloud', 'tool',
]

function countTechnologyFrequency(engagements: StrategyEngagement[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const e of engagements) {
        for (const t of e.technologies ?? []) {
            const k = t.toLowerCase()
            counts.set(k, (counts.get(k) ?? 0) + 1)
        }
    }
    return counts
}

/**
 * Rank skills for query inclusion:
 *   1. explicitly primary skills
 *   2. skills recurring across multiple client engagements
 *   3. remaining technical skills
 * Domain skills are handled separately — they describe context, not capability.
 */
export function rankSkills(
    skills: StrategySkill[],
    engagements: StrategyEngagement[]
): { core: string[]; secondary: string[]; domains: string[] } {
    const freq = countTechnologyFrequency(engagements)

    const domains: string[] = []
    const scored: Array<{ name: string; score: number }> = []

    const seen = new Set<string>()
    for (const s of skills) {
        const name = s.skill_name.trim()
        if (!name) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)

        if (s.category === 'domain') {
            domains.push(name)
            continue
        }

        let score = 0
        if (s.is_primary) score += 10
        score += (freq.get(key) ?? 0) * 3
        if (s.category && TECHNICAL_CATEGORIES.includes(s.category)) score += 2
        scored.push({ name, score })
    }

    // Engagement domains are context signals too.
    for (const e of engagements) {
        for (const d of e.domains ?? []) {
            if (!domains.some(x => x.toLowerCase() === d.toLowerCase())) domains.push(d)
        }
    }

    scored.sort((a, b) => b.score - a.score)
    const core = scored.filter(s => s.score > 0).map(s => s.name)
    const secondary = scored.filter(s => s.score === 0).map(s => s.name)

    return { core, secondary, domains }
}

// ── Resume-driven role derivation ───────────────────────────────────────────
//
// Explicit Target Roles say what the user asked for. This section adds what
// their resume implies, so a run can also reach adjacent jobs the user never
// thought to type — without inventing anything, and without spending another
// search call.
//
// Everything is derived from data the user actually has. Nothing here knows
// what a Salesforce, a Java or a nursing job is: it composes a qualifier the
// profile repeats with a role noun the profile already uses.

/** A single candidate search intent, before the run picks which few to use. */
export interface SearchIntent {
    /** The job title this intent targets. */
    title: string
    /** Where it came from. Explicit always outranks derived. */
    kind: 'explicit' | 'profile' | 'derived' | 'synonym'
    /** Ranking score within its kind. Higher is stronger evidence. */
    score: number
    /** The profile token that produced a derived title, for cluster affinity. */
    qualifier?: string
    /** Human-readable justification, surfaced by the diagnostic helper. */
    reason: string
}

/**
 * How often a qualifier must recur before it is allowed to form a job title.
 *
 * One mention is an anecdote — a tool used once should not become a role. Two
 * independent engagements, or an explicitly primary skill, is evidence.
 */
export const QUALIFIER_MIN_FREQUENCY = 2

/** Words that describe a role, never a technology, so never a qualifier. */
const ROLE_NOUN_TOKENS = new Set(ROLE_SYNONYMS.flat())

/**
 * Tokens that carry no search meaning on their own.
 *
 * Deliberately tiny and profession-neutral: these are English filler and
 * generic activity words, not a domain vocabulary. A real technology or domain
 * term must never appear here.
 */
const NON_QUALIFIER_TOKENS = new Set([
    'and', 'or', 'the', 'a', 'an', 'of', 'for', 'with', 'to', 'in', 'on',
    'other', 'various', 'general', 'misc', 'etc',
    'debugging', 'documentation', 'testing', 'support', 'maintenance',
])

/**
 * Qualifiers the profile actually repeats: platforms, domains, technologies.
 *
 * Scored from two independent kinds of evidence — how many engagements mention
 * it, and whether the user marked it primary — so a term earns its place by
 * recurring, not by appearing once in a long list.
 */
export function extractQualifiers(
    skills: StrategySkill[],
    engagements: StrategyEngagement[]
): Array<{ term: string; score: number; frequency: number; primary: boolean }> {
    const frequency = new Map<string, number>()
    const bump = (raw: string | null | undefined) => {
        const t = normalizeTitle(raw ?? '')
        if (!t) return
        frequency.set(t, (frequency.get(t) ?? 0) + 1)
    }

    // Engagement technologies and domains are the recurrence signal: the same
    // term appearing across separate pieces of work is what makes it central.
    for (const e of engagements) {
        for (const t of e.technologies ?? []) bump(t)
        for (const d of e.domains ?? []) bump(d)
    }

    const primary = new Set(
        skills.filter(s => s.is_primary).map(s => normalizeTitle(s.skill_name)).filter(Boolean)
    )

    const candidates = new Set<string>([...frequency.keys(), ...primary])
    const out: Array<{ term: string; score: number; frequency: number; primary: boolean }> = []

    for (const term of candidates) {
        if (!term || term.length < 2) continue
        if (NON_QUALIFIER_TOKENS.has(term)) continue
        // A role noun is a role, not a thing the role works on.
        if (ROLE_NOUN_TOKENS.has(term)) continue
        if (SENIORITY_TOKENS.has(term)) continue
        // Long phrases make unnatural titles; a qualifier is a word or two.
        if (term.split(' ').length > 2) continue

        const freq = frequency.get(term) ?? 0
        const isPrimary = primary.has(term)
        if (freq < QUALIFIER_MIN_FREQUENCY && !isPrimary) continue

        out.push({ term, score: freq * 3 + (isPrimary ? 2 : 0), frequency: freq, primary: isPrimary })
    }

    // Deterministic: score first, then alphabetical so ties never reorder.
    out.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    return out
}

/**
 * The role noun the profile already uses ("developer", "manager", "nurse").
 *
 * Read from the user's own titles rather than assumed, so a career change
 * carries the noun with it. Falls back to the last word of the first title,
 * which is the role noun in most job titles across professions.
 */
export function deriveRoleNoun(titles: string[]): string | null {
    for (const title of titles) {
        const tokens = normalizeTitle(title).split(' ').filter(Boolean)
        const noun = tokens.find(t => ROLE_NOUN_TOKENS.has(t))
        if (noun) return noun
    }
    for (const title of titles) {
        const tokens = normalizeTitle(title).split(' ').filter(t => t && !SENIORITY_TOKENS.has(t))
        if (tokens.length > 0) return tokens[tokens.length - 1]
    }
    return null
}

/**
 * The full set of search intents this profile supports, best evidence first.
 *
 * Read-only, side-effect free and INDEPENDENT OF THE ROTATION. The order here
 * is pure ranking; choosing which of these a given run gets is selectTitles'
 * job, and it must be the only place a rotation is applied.
 *
 * This function used to rotate the derived block itself. That produced two
 * rotations driven by the same counter — one here and one over the combined
 * ring in selectTitles — whose strides compounded, so with four derived intents
 * only every other one was ever selected and two were starved permanently. One
 * rotation, in one place, is what makes the coverage guarantee hold.
 */
export function buildSearchPortfolio(input: StrategyInput): SearchIntent[] {
    const excluded = new Set((input.preferences?.excluded_roles ?? []).map(normalizeTitle).filter(Boolean))
    const allowed = (t: string): boolean => {
        if (!t) return false
        if (excluded.has(t)) return false
        if (excluded.size && [...excluded].some(ex => t.includes(ex))) return false
        return true
    }

    const intents: SearchIntent[] = []
    const seen = new Set<string>()
    const add = (i: SearchIntent) => {
        if (!allowed(i.title) || seen.has(i.title)) return
        seen.add(i.title)
        intents.push(i)
    }

    // 1. Explicit intent, in the user's own order.
    const explicit: string[] = []
    for (const r of input.preferences?.desired_roles ?? []) {
        const n = normalizeTitle(r ?? '')
        if (n && !explicit.includes(n)) explicit.push(n)
    }
    explicit.forEach((title, i) =>
        add({ title, kind: 'explicit', score: 1000 - i, reason: 'listed in Target Roles' })
    )

    // 2. Profile intent: what the user currently is.
    const profileTitles: string[] = []
    const pushProfile = (raw: string | null | undefined, why: string) => {
        const n = normalizeTitle(raw ?? '')
        if (!n) return
        profileTitles.push(n)
        add({ title: n, kind: 'profile', score: 500, reason: why })
    }
    pushProfile(input.profile?.headline, 'profile headline')
    for (const e of input.experience.filter(x => x.is_current)) pushProfile(e.title, 'current experience')
    for (const e of input.experience.filter(x => !x.is_current)) pushProfile(e.title, 'past experience')

    // 3. Derived intent: a qualifier the resume repeats + a role noun it uses.
    const roleNoun = deriveRoleNoun([...explicit, ...profileTitles])
    const qualifiers = extractQualifiers(input.skills, input.engagements)

    if (roleNoun) {
        // Strongest evidence first. No rotation here — see the note above.
        for (const q of qualifiers) {
            add({
                title: `${q.term} ${roleNoun}`,
                kind: 'derived',
                score: q.score,
                qualifier: q.term,
                reason: q.primary && q.frequency >= QUALIFIER_MIN_FREQUENCY
                    ? `"${q.term}" is a primary skill and appears in ${q.frequency} engagements`
                    : q.primary
                        ? `"${q.term}" is a primary skill`
                        : `"${q.term}" appears in ${q.frequency} engagements`,
            })
        }
    }

    // 4. Vocabulary synonyms, breadth-first so one seed cannot monopolise.
    const seeds = [...explicit, ...profileTitles]
    const expansions = seeds.map(s => deriveAlternativeTitles(s).filter(allowed))
    const deepest = expansions.reduce((m, e) => Math.max(m, e.length), 0)
    for (let rank = 1; rank < deepest; rank++) {
        for (const expansion of expansions) {
            const t = expansion[rank]
            if (t) add({ title: t, kind: 'synonym', score: 100 - rank, reason: 'related title from role vocabulary' })
        }
    }

    return intents
}

/**
 * Why a run searched what it searched.
 *
 * Server-side diagnostic for the question "why did this find so few jobs?".
 * Returns plain data; nothing here is shown to the user.
 */
export function explainPortfolio(
    input: StrategyInput,
    options: StrategyOptions = {}
): {
    selected: SearchIntent[]
    skipped: SearchIntent[]
    qualifiers: Array<{ term: string; score: number; frequency: number; primary: boolean }>
    roleNoun: string | null
    remoteTerms: string[]
    geoTerms: string[]
} {
    const maxQueries = Math.max(1, options.maxQueries ?? DEFAULT_MAX_QUERIES)
    const offset = options.rotationOffset ?? 0
    const portfolio = buildSearchPortfolio(input)
    const { titles } = selectTitles(input, maxQueries, offset)
    const chosen = new Set(titles)

    return {
        selected: titles
            .map(t => portfolio.find(i => i.title === t) ?? { title: t, kind: 'synonym' as const, score: 0, reason: 'generic alternative' }),
        skipped: portfolio.filter(i => !chosen.has(i.title)),
        qualifiers: extractQualifiers(input.skills, input.engagements),
        roleNoun: deriveRoleNoun(portfolio.filter(i => i.kind === 'explicit' || i.kind === 'profile').map(i => i.title)),
        remoteTerms: resolveRemoteTerms(input.preferences?.work_modes, input.preferences?.remote_search_terms),
        geoTerms: resolveGeoTerms(input.preferences?.geographic_preferences),
    }
}

// ── Search intent: work mode and geography ──────────────────────────────────
//
// These come from the user's saved Search Parameters (candidate_preferences),
// never from the profile's current_location and never from a built-in default.
// An empty parameter contributes NOTHING to the query — no work-mode emphasis,
// no geographic restriction, no invented remote wording.

/**
 * Geographic values meaning "everywhere", which must NOT narrow the query.
 *
 * Selecting Worldwide expresses the absence of a restriction, so it adds no
 * term at all rather than the literal word — searching for "worldwide" would
 * narrow results to pages that happen to use that word.
 */
const WORLDWIDE_SENTINELS = new Set(['worldwide', 'global', 'globally', 'any', 'anywhere'])

/** Work mode whose preference is expressible as a search term. */
const REMOTE_WORK_MODE = 'remote'

function cleanList(values: string[] | null | undefined): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of values ?? []) {
        if (typeof raw !== 'string') continue
        const trimmed = raw.trim()
        if (!trimmed) continue
        const key = trimmed.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(trimmed)
    }
    return out
}

/** Quote multi-word phrases so the provider treats them as one term. */
export function quoteTerm(term: string): string {
    const trimmed = term.trim()
    if (!trimmed) return ''
    return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed
}

/**
 * Concrete geographic terms to add to queries.
 *
 * Worldwide/any resolves to an EMPTY list: the user is asking not to be
 * restricted, so no country is invented and no local geography is inferred.
 * Country- or region-specific values are passed through verbatim.
 */
export function resolveGeoTerms(geographicPreferences: string[] | null | undefined): string[] {
    return cleanList(geographicPreferences).filter(g => !WORLDWIDE_SENTINELS.has(g.toLowerCase()))
}

/**
 * Remote-intent phrases to rotate across queries.
 *
 * Requires the user to have selected Remote as a work mode — without it there
 * is no work-mode emphasis at all. The WORDING comes from the user's saved
 * remote_search_terms; when they saved none, the single literal mode word is
 * used rather than inventing phrasings like "work from anywhere".
 */
export function resolveRemoteTerms(
    workModes: string[] | null | undefined,
    remoteSearchTerms: string[] | null | undefined
): string[] {
    const modes = cleanList(workModes).map(m => m.toLowerCase())
    if (!modes.includes(REMOTE_WORK_MODE)) return []

    const terms = cleanList(remoteSearchTerms)
    return terms.length > 0 ? terms : [REMOTE_WORK_MODE]
}

// ── Experience level ────────────────────────────────────────────────────────

export function deriveExperienceLevel(years: number | null | undefined): string | null {
    if (years === null || years === undefined || !Number.isFinite(years)) return null
    if (years < 1) return 'entry level'
    if (years < 3) return 'junior'
    if (years < 6) return 'mid level'
    if (years < 10) return 'senior'
    return 'lead'
}

// ── Strategy construction ───────────────────────────────────────────────────

/**
 * Build targeted search strategies from a structured profile.
 *
 * Each query pairs ONE title with a focused, non-overlapping skill cluster, so
 * successive searches explore different facets of the candidate rather than
 * repeating one over-long query.
 */
/**
 * Fold any offset into [0, size).
 *
 * Handles the cases the stored value can actually take: a list that shrank
 * since the offset was written, a negative value, a fractional value, or a
 * missing one. Never throws, so a bad stored offset degrades to 0 rather than
 * breaking discovery.
 */
export function normaliseRotationOffset(offset: number | null | undefined, size: number): number {
    if (size <= 0) return 0
    if (typeof offset !== 'number' || !Number.isFinite(offset)) return 0
    const whole = Math.trunc(offset)
    return ((whole % size) + size) % size
}

/**
 * Keeps the stored counter bounded without ever making it meaningful modulo a
 * list length — every use site takes its own modulus.
 */
export const ROTATION_COUNTER_MODULUS = 1_000_000

/**
 * The next value to store after a run.
 *
 * The offset is a RUN COUNTER, not an index. Each ring in the portfolio takes
 * its own modulus of it, which is what lets one persisted integer drive two
 * rings of different lengths without them fighting: a two-role ring and a
 * six-intent ring both advance every run instead of one of them standing still
 * because its length happened to divide the step.
 */
export function advanceRotationOffset(offset: number): number {
    const from = normaliseRotationOffset(offset, ROTATION_COUNTER_MODULUS)
    return (from + 1) % ROTATION_COUNTER_MODULUS
}

/**
 * Order candidate titles so no explicit role can be starved by a synonym.
 *
 * The previous ordering flattened each seed's expansion depth-first, which put
 * every alternative of the first seed ahead of the SECOND seed's own title. A
 * three-slot run then spent all three on variations of one role, and later
 * roles were never reached — deterministically, so they were starved forever
 * rather than merely unlucky.
 *
 * Two rules fix that generically, with no vocabulary changes:
 *
 *   1. Explicit `desired_roles` are seeded before any inferred title, and a
 *      rotating window selects which of them this run can afford. Roles outside
 *      the window are not dropped — they lead the next run.
 *   2. Alternatives are appended only AFTER every selected explicit role, and
 *      are read breadth-first by rank (all first alternatives, then all second
 *      alternatives, ...) so one seed cannot monopolise the remaining slots.
 *
 * With fewer roles than slots the leftovers are filled from those alternatives,
 * so a single role still produces a full, varied run exactly as before.
 */
export function selectTitles(
    input: StrategyInput,
    maxQueries: number,
    rotationOffset: number
): {
    titles: string[]
    rolesConsumed: number
    explicitCount: number
    /** Derived titles map to the profile token that produced them. */
    qualifierByTitle: Map<string, string>
} {
    const excluded = new Set((input.preferences?.excluded_roles ?? []).map(normalizeTitle).filter(Boolean))

    const allowed = (t: string): boolean => {
        if (!t) return false
        if (excluded.has(t)) return false
        if (excluded.size && [...excluded].some(ex => t.includes(ex))) return false
        return true
    }

    // ── Explicit roles: deduplicated, order preserved ──
    const explicit: string[] = []
    for (const r of input.preferences?.desired_roles ?? []) {
        const n = normalizeTitle(r ?? '')
        if (allowed(n) && !explicit.includes(n)) explicit.push(n)
    }

    // ── Inferred seeds, used when there is no explicit list and to widen ──
    const inferred: string[] = []
    const pushInferred = (raw: string | null | undefined) => {
        const n = normalizeTitle(raw ?? '')
        if (allowed(n) && !explicit.includes(n) && !inferred.includes(n)) inferred.push(n)
    }
    pushInferred(input.profile?.headline)
    for (const e of input.experience.filter(x => x.is_current)) pushInferred(e.title)
    for (const e of input.experience.filter(x => !x.is_current)) pushInferred(e.title)

    // ── The non-explicit half of the portfolio, best evidence first ──
    // Profile titles, then resume-derived intents, then vocabulary synonyms.
    const qualifierByTitle = new Map<string, string>()
    const rest: string[] = []
    const pushRest = (t: string) => {
        if (allowed(t) && !explicit.includes(t) && !rest.includes(t)) rest.push(t)
    }

    for (const t of inferred) pushRest(t)
    for (const intent of buildSearchPortfolio(input)) {
        if (intent.kind !== 'derived') continue
        pushRest(intent.title)
        if (intent.qualifier) qualifierByTitle.set(intent.title, intent.qualifier)
    }
    {
        const seeds = [...explicit, ...inferred]
        const expansions = seeds.map(s => deriveAlternativeTitles(s).filter(allowed))
        const deepest = expansions.reduce((m, e) => Math.max(m, e.length), 0)
        for (let rank = 1; rank < deepest; rank++) {
            for (const expansion of expansions) {
                if (expansion[rank]) pushRest(expansion[rank])
            }
        }
    }

    // ── How many slots the explicit roles hold ──
    //
    // Explicit roles keep strong priority: they always lead, and they take
    // every slot when nothing else is available. But they do NOT take every
    // slot when the portfolio has more to offer — one slot is yielded so that
    // resume-derived intents actually reach the daily run. Without this a user
    // with two roles and two daily slots would search the same two titles every
    // day forever, and everything their resume implies would be unreachable.
    // The yield applies ONLY when the explicit selection would otherwise be
    // identical on every run — that is, when every explicit role fits in the
    // slots. With more roles than slots the window already varies run to run,
    // so explicit roles keep every slot and the portfolio waits its turn.
    const N = explicit.length
    const explicitSelectionIsInvariant = N > 0 && N <= maxQueries
    const explicitSlots = Math.min(
        N,
        rest.length > 0 && explicitSelectionIsInvariant
            ? Math.max(1, maxQueries - 1)
            : maxQueries
    )

    // Each ring takes its own modulus of the shared run counter, so both
    // advance every run regardless of their lengths.
    const selected: string[] = []
    if (explicitSlots > 0) {
        const start = normaliseRotationOffset(rotationOffset * explicitSlots, N)
        for (let i = 0; i < explicitSlots; i++) selected.push(explicit[(start + i) % N])
    }

    if (rest.length > 0 && selected.length < maxQueries) {
        const start = normaliseRotationOffset(rotationOffset, rest.length)
        for (let i = 0; i < rest.length && selected.length < maxQueries; i++) {
            const candidate = rest[(start + i) % rest.length]
            if (!selected.includes(candidate)) selected.push(candidate)
        }
    }

    // Top up from any explicit role still unused, so a short portfolio never
    // wastes a slot the budget already paid for.
    for (const t of explicit) {
        if (selected.length >= maxQueries) break
        if (!selected.includes(t)) selected.push(t)
    }

    return { titles: selected, rolesConsumed: explicitSlots, explicitCount: N, qualifierByTitle }
}


export function buildSearchStrategies(
    input: StrategyInput,
    options: StrategyOptions = {}
): SearchStrategy[] {
    const maxQueries = Math.max(1, options.maxQueries ?? DEFAULT_MAX_QUERIES)
    const skillsPerQuery = Math.max(1, options.skillsPerQuery ?? DEFAULT_SKILLS_PER_QUERY)

    const { titles, qualifierByTitle } = selectTitles(input, maxQueries, options.rotationOffset ?? 0)

    if (titles.length === 0) return []

    // ── Skills ──
    // User-supplied keywords lead: an explicit Search Parameter outranks a
    // skill inferred from the resume. Excluded keywords are removed entirely.
    const { core, secondary } = rankSkills(input.skills, input.engagements)
    const excludedSkills = new Set(
        cleanList(input.preferences?.excluded_skills).map(s => s.toLowerCase())
    )
    const pool = [
        ...cleanList(input.preferences?.desired_skills),
        ...core,
        ...secondary,
    ].filter(s => !excludedSkills.has(s.toLowerCase()))

    // ── Search intent (empty parameters contribute nothing) ──
    const remoteTerms = resolveRemoteTerms(
        input.preferences?.work_modes,
        input.preferences?.remote_search_terms
    )
    const geoTerms = resolveGeoTerms(input.preferences?.geographic_preferences)

    const strategies: SearchStrategy[] = []
    let skillCursor = 0

    for (const title of titles) {
        if (strategies.length >= maxQueries) break

        // Take the next distinct cluster, wrapping only if the pool is short.
        let cluster: string[] = []
        if (pool.length > 0) {
            // A derived title names a specific qualifier, so lead its cluster
            // with the skills that actually relate to it — an integration role
            // paired with integration skills reads as one coherent query rather
            // than a title bolted onto whatever the cursor happened to reach.
            const qualifier = qualifierByTitle.get(title)
            if (qualifier) {
                for (const skill of pool) {
                    if (cluster.length >= skillsPerQuery) break
                    if (normalizeTitle(skill).includes(qualifier)) cluster.push(skill)
                }
            }

            for (let i = 0; cluster.length < skillsPerQuery && i < pool.length; i++) {
                const next = pool[(skillCursor + i) % pool.length]
                if (!cluster.includes(next)) cluster.push(next)
            }
            skillCursor = (skillCursor + skillsPerQuery) % pool.length
        }
        cluster = [...new Set(cluster)]

        const display = presentTitle(title)

        // Rotate intent terms the way skill clusters already rotate, so the
        // queries carry DIFFERENT remote phrasings instead of the same suffix
        // repeated. Adds no query — only changes wording within existing ones.
        const idx = strategies.length
        const remoteTerm = remoteTerms.length > 0 ? remoteTerms[idx % remoteTerms.length] : undefined
        const geoTerm = geoTerms.length > 0 ? geoTerms[idx % geoTerms.length] : undefined

        const parts = [`"${display}"`]
        if (cluster.length > 0) parts.push(cluster.join(' '))
        if (remoteTerm) parts.push(quoteTerm(remoteTerm))
        if (geoTerm) parts.push(quoteTerm(geoTerm))

        const rationaleBits: string[] = [
            cluster.length > 0
                ? `paired with ${cluster.length} skill(s)`
                : 'no skills available in profile',
        ]
        if (remoteTerm) rationaleBits.push(`remote intent "${remoteTerm}"`)
        if (geoTerm) rationaleBits.push(`geography "${geoTerm}"`)

        strategies.push({
            query: parts.join(' '),
            title: display,
            skills: cluster,
            remoteTerm,
            geoTerm,
            rationale: `Title "${display}" ${rationaleBits.join(', ')}`,
        })
    }

    return strategies
}
