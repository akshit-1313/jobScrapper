/**
 * Presentation state for a job in a list: has the current user saved it, have
 * they applied, and is it new enough to flag.
 *
 * Pure and free of React/Supabase so the rules are unit-testable. The list
 * pages resolve the raw rows once per render and pass the result down; nothing
 * here queries or infers state that is not persisted.
 */

/** A job discovered within this window is surfaced as "New". */
export const NEW_JOB_WINDOW_HOURS = 24;

/** Mirrors saved_jobs.status. There is no 'none' — an absent row means unsaved. */
export type SavedJobStatusValue = 'saved' | 'ignored' | 'archived';

export interface JobUserState {
    savedStatus: SavedJobStatusValue | null;
    applied: boolean;
}

/**
 * Index rows by job_id for O(1) lookup while rendering a page of jobs.
 * Rows come from a user-scoped query, so every entry belongs to that user.
 */
export function buildSavedStatusMap(
    rows: Array<{ job_id: string; status: string | null }> | null | undefined
): Map<string, SavedJobStatusValue> {
    const map = new Map<string, SavedJobStatusValue>();
    for (const row of rows ?? []) {
        if (!row?.job_id) continue;
        if (row.status === 'saved' || row.status === 'ignored' || row.status === 'archived') {
            map.set(row.job_id, row.status);
        }
    }
    return map;
}

export function buildAppliedSet(
    rows: Array<{ job_id: string }> | null | undefined
): Set<string> {
    const set = new Set<string>();
    for (const row of rows ?? []) {
        if (row?.job_id) set.add(row.job_id);
    }
    return set;
}

export function resolveJobUserState(
    jobId: string,
    savedStatuses: Map<string, SavedJobStatusValue>,
    appliedJobIds: Set<string>
): JobUserState {
    return {
        savedStatus: savedStatuses.get(jobId) ?? null,
        applied: appliedJobIds.has(jobId),
    };
}

/**
 * True when the job was discovered inside the "New" window.
 *
 * `discovered_at` is set by the discovery pipeline, so this reflects when WE
 * found the posting, not when the employer published it.
 */
export function isRecentlyDiscovered(
    discoveredAt: string | null | undefined,
    now: Date = new Date()
): boolean {
    if (!discoveredAt) return false;
    const discovered = new Date(discoveredAt);
    if (Number.isNaN(discovered.getTime())) return false;

    const ageMs = now.getTime() - discovered.getTime();
    if (ageMs < 0) return false; // clock skew: a future date is not "new"
    return ageMs <= NEW_JOB_WINDOW_HOURS * 60 * 60 * 1000;
}

/** Filter values accepted by the /jobs status filter. */
export type JobStatusFilter = 'all' | 'saved' | 'applied' | 'not_applied';

export function parseJobStatusFilter(raw: unknown): JobStatusFilter {
    return raw === 'saved' || raw === 'applied' || raw === 'not_applied' ? raw : 'all';
}

/**
 * Apply the status filter to an already-fetched page of jobs.
 *
 * Filtering happens in-process because saved/applied state lives in per-user
 * tables that PostgREST cannot join onto the shared `jobs` query without
 * leaking the filter into the parent row selection.
 */
export function filterJobsByStatus<T extends { id: string }>(
    jobs: T[],
    filter: JobStatusFilter,
    savedStatuses: Map<string, SavedJobStatusValue>,
    appliedJobIds: Set<string>
): T[] {
    if (filter === 'all') return jobs;

    return jobs.filter(job => {
        if (filter === 'saved') return savedStatuses.get(job.id) === 'saved';
        if (filter === 'applied') return appliedJobIds.has(job.id);
        return !appliedJobIds.has(job.id); // not_applied
    });
}
