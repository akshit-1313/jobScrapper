/**
 * Presentation helpers for the structured candidate profile.
 *
 * Pure and deterministic — grouping and formatting only. These never infer,
 * enrich or invent profile data: every value shown originates from the parsed
 * resume as persisted in the candidate_* tables.
 */
import type { SkillCategory } from '@/lib/types/resume'

export interface ViewSkill {
    skill_name: string
    category?: SkillCategory | string | null
    proficiency_level?: string | null
    years_used?: number | null
    is_primary?: boolean | null
}

export interface SkillGroup {
    category: SkillCategory | 'uncategorized'
    label: string
    skills: ViewSkill[]
}

/** Display order — concrete technology first, context last. */
export const SKILL_CATEGORY_ORDER: Array<SkillCategory | 'uncategorized'> = [
    'language', 'framework', 'library', 'database', 'cloud', 'tool', 'domain', 'other', 'uncategorized',
]

export const SKILL_CATEGORY_LABELS: Record<SkillCategory | 'uncategorized', string> = {
    language: 'Programming Languages',
    framework: 'Frameworks',
    library: 'Libraries',
    database: 'Databases',
    cloud: 'Cloud & Platforms',
    tool: 'Tools',
    domain: 'Domains & Practices',
    other: 'Other',
    uncategorized: 'Uncategorized',
}

/**
 * Group skills by category in a stable display order.
 * Empty categories are omitted. Skills with no category fall into
 * 'uncategorized' rather than being dropped or reassigned by guesswork.
 */
export function groupSkillsByCategory(skills: ViewSkill[]): SkillGroup[] {
    const buckets = new Map<SkillCategory | 'uncategorized', ViewSkill[]>()

    for (const skill of skills) {
        if (!skill?.skill_name || !skill.skill_name.trim()) continue

        const raw = typeof skill.category === 'string' ? skill.category : ''
        const key = (SKILL_CATEGORY_ORDER as string[]).includes(raw) && raw !== 'uncategorized'
            ? (raw as SkillCategory)
            : 'uncategorized'

        const list = buckets.get(key) ?? []
        list.push(skill)
        buckets.set(key, list)
    }

    const groups: SkillGroup[] = []
    for (const category of SKILL_CATEGORY_ORDER) {
        const list = buckets.get(category)
        if (!list || list.length === 0) continue
        groups.push({ category, label: SKILL_CATEGORY_LABELS[category], skills: list })
    }
    return groups
}

const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** "2025-01-01" → "Jan 2025". Returns null for absent or unparseable input. */
export function formatMonthYear(iso: string | null | undefined): string | null {
    if (!iso) return null
    const m = /^(\d{4})-(\d{2})/.exec(iso)
    if (!m) return null
    const month = parseInt(m[2], 10)
    if (month < 1 || month > 12) return null
    return `${MONTHS[month - 1]} ${m[1]}`
}

/**
 * Human-readable period. "Present" only when the record is explicitly current —
 * never assumed from a missing end date.
 */
export function formatPeriod(
    start: string | null | undefined,
    end: string | null | undefined,
    isCurrent?: boolean | null
): string {
    const from = formatMonthYear(start)
    const to = isCurrent ? 'Present' : formatMonthYear(end)

    if (from && to) return `${from} – ${to}`
    if (from) return from
    if (to) return to
    return 'Dates not specified'
}

/** Whole months → "2 yrs 3 mos". Returns null when duration is unknown. */
export function formatDuration(months: number | null | undefined): string | null {
    if (typeof months !== 'number' || !Number.isFinite(months) || months < 0) return null
    const years = Math.floor(months / 12)
    const rem = months % 12
    const parts: string[] = []
    if (years > 0) parts.push(`${years} yr${years === 1 ? '' : 's'}`)
    if (rem > 0) parts.push(`${rem} mo${rem === 1 ? '' : 's'}`)
    return parts.length > 0 ? parts.join(' ') : 'Less than a month'
}
