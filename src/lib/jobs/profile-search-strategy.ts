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
export function buildSearchStrategies(
    input: StrategyInput,
    options: StrategyOptions = {}
): SearchStrategy[] {
    const maxQueries = Math.max(1, options.maxQueries ?? DEFAULT_MAX_QUERIES)
    const skillsPerQuery = Math.max(1, options.skillsPerQuery ?? DEFAULT_SKILLS_PER_QUERY)

    // ── Titles ──
    const rawTitles: string[] = []
    if (input.profile?.headline) rawTitles.push(input.profile.headline)
    for (const r of input.preferences?.desired_roles ?? []) rawTitles.push(r)
    // Current roles first, then the rest.
    for (const e of input.experience.filter(x => x.is_current)) rawTitles.push(e.title)
    for (const e of input.experience.filter(x => !x.is_current)) rawTitles.push(e.title)

    const excluded = new Set((input.preferences?.excluded_roles ?? []).map(normalizeTitle).filter(Boolean))

    const titles: string[] = []
    for (const raw of rawTitles) {
        for (const t of deriveAlternativeTitles(raw)) {
            if (!t) continue
            if (excluded.has(t)) continue
            if (excluded.size && [...excluded].some(ex => t.includes(ex))) continue
            if (!titles.includes(t)) titles.push(t)
        }
    }

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
            for (let i = 0; i < skillsPerQuery && i < pool.length; i++) {
                cluster.push(pool[(skillCursor + i) % pool.length])
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
