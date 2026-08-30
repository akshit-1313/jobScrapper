import { z } from 'zod'

/**
 * Search Parameters — what the user wants to search for.
 *
 * Distinct from the profile (who the user is) and from the matching constraints
 * on /preferences (salary, visa, relocation, experience). These seven fields
 * are the only ones the Search Parameters editor writes.
 *
 * Every field is optional and defaults to empty, and empty carries explicit
 * meaning: no work-mode emphasis, no geographic restriction, no invented remote
 * wording. Nothing here is populated on a user's behalf.
 */

/** Work modes offered by the UI, matching the jobs.work_mode domain exactly. */
export const WORK_MODE_OPTIONS = ['remote', 'hybrid', 'office'] as const;
export type WorkModeOption = typeof WORK_MODE_OPTIONS[number];

/** Geographic values meaning "no restriction". */
export const WORLDWIDE_OPTION = 'worldwide';

/**
 * Canonical 8-4-4-4-12 UUID shape.
 *
 * Deliberately NOT `z.string().uuid()`. That enforces the RFC 4122 version and
 * variant nibbles — `[1-8]` opening the third group, `[89abAB]` the fourth —
 * which the seeded job_sources ids do not carry:
 *
 *     a0000000-0000-0000-0000-000000000005   ← Lever, version nibble 0
 *
 * Postgres stores and compares these perfectly well; only Zod refused them, so
 * every "Choose sources" save failed validation before reaching the database
 * while "All sources" (an empty array) always passed.
 *
 * Loosening the FORMAT check costs nothing in safety: the format was never the
 * security boundary. `resolveEligibleSources` intersects these ids with sources
 * already filtered to `active = true`, so an unknown or fabricated id still
 * matches nothing, and the uuid[] column rejects anything malformed.
 */
const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const termList = z
    .array(z.string().trim().min(1).max(120))
    .max(25)
    .optional()
    .default([]);

export const SearchParametersSchema = z.object({
    desired_roles: termList,
    work_modes: z.array(z.enum(WORK_MODE_OPTIONS)).max(3).optional().default([]),
    geographic_preferences: termList,
    remote_search_terms: termList,
    desired_skills: termList,
    excluded_skills: termList,
    excluded_roles: termList,
    /**
     * Job sources the user wants searched. Empty means ALL globally active
     * sources, which is the existing behaviour for every user. Ids are
     * intersected with job_sources.active = true at query time, so this can
     * only ever narrow the pool — never widen it past the allow-list.
     */
    selected_source_ids: z.array(z.string().regex(UUID_SHAPE)).max(50).optional().default([]),
});

export type SearchParametersValues = z.infer<typeof SearchParametersSchema>;

export const EMPTY_SEARCH_PARAMETERS: SearchParametersValues = {
    desired_roles: [],
    work_modes: [],
    geographic_preferences: [],
    remote_search_terms: [],
    desired_skills: [],
    excluded_skills: [],
    excluded_roles: [],
    selected_source_ids: [],
};

/**
 * Eligible discovery sources for a user.
 *
 * The global allow-list is applied LAST and unconditionally: only sources the
 * caller passes in (already filtered to active = true) can appear, so a stale,
 * deactivated or fabricated id contributes nothing. An empty selection means
 * "all", preserving the behaviour every user has today.
 *
 * Ordering is preserved exactly as given, so the caller's deterministic
 * rotation (last_crawled_at, priority, id) is untouched.
 */
export function resolveEligibleSources<T extends { id: string }>(
    activeSources: T[],
    selectedIds: string[] | null | undefined
): T[] {
    const selected = new Set((selectedIds ?? []).filter(id => typeof id === 'string' && id.length > 0));
    if (selected.size === 0) return activeSources;

    const narrowed = activeSources.filter(s => selected.has(s.id));

    // Every selected id is stale or inactive: fall back to the full allow-list
    // rather than silently disabling discovery for the user.
    return narrowed.length > 0 ? narrowed : activeSources;
}

/** Coerce a stored row into form values, tolerating nulls and legacy spellings. */
export function toSearchParameters(row: Record<string, unknown> | null | undefined): SearchParametersValues {
    const list = (value: unknown): string[] =>
        Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];

    // 'in_office' is the value earlier versions of the preferences form
    // submitted; jobs.work_mode uses 'office'. Read it back as 'office' so an
    // existing selection keeps working.
    const modes = list(row?.work_modes)
        .map(m => (m === 'in_office' ? 'office' : m))
        .filter((m): m is WorkModeOption => (WORK_MODE_OPTIONS as readonly string[]).includes(m));

    return {
        desired_roles: list(row?.desired_roles),
        work_modes: [...new Set(modes)],
        geographic_preferences: list(row?.geographic_preferences),
        remote_search_terms: list(row?.remote_search_terms),
        desired_skills: list(row?.desired_skills),
        excluded_skills: list(row?.excluded_skills),
        excluded_roles: list(row?.excluded_roles),
        selected_source_ids: list(row?.selected_source_ids),
    };
}

/** Stable comparison for the saved / unsaved-changes indicator. */
export function searchParametersEqual(a: SearchParametersValues, b: SearchParametersValues): boolean {
    const keys = Object.keys(EMPTY_SEARCH_PARAMETERS) as Array<keyof SearchParametersValues>;
    return keys.every(k => {
        const x = a[k] ?? [];
        const y = b[k] ?? [];
        return x.length === y.length && x.every((v, i) => v === y[i]);
    });
}
