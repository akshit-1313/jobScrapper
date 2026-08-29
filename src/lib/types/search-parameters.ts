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
};

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
