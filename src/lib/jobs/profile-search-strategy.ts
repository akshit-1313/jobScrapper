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
    const { core, secondary } = rankSkills(input.skills, input.engagements)
    const pool = [...core, ...secondary]

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
        const query = cluster.length > 0
            ? `"${display}" ${cluster.join(' ')}`
            : `"${display}"`

        strategies.push({
            query,
            title: display,
            skills: cluster,
            rationale: cluster.length > 0
                ? `Title "${display}" paired with ${cluster.length} profile skill(s)`
                : `Title "${display}" (no skills available in profile)`,
        })
    }

    return strategies
}
