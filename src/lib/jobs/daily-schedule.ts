/**
 * Display helper for the daily discovery schedule.
 *
 * Pure and framework-free. It describes the cron that already exists in
 * `vercel.json` — it does not configure, trigger or influence it. The schedule
 * itself remains `0 4 * * *`, defined in one place only.
 */

/** The hour the daily cron fires, in UTC. Mirrors `0 4 * * *`. */
export const DAILY_RUN_HOUR_UTC = 4;

/**
 * The next time the daily run is due, in UTC.
 *
 * Today at 04:00 if that is still ahead, otherwise tomorrow. On the Hobby plan
 * the exact minute is approximate, which the UI states alongside this value.
 */
export function nextDailyRunUtc(now: Date = new Date()): Date {
    const next = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        DAILY_RUN_HOUR_UTC, 0, 0, 0
    ));

    if (next.getTime() <= now.getTime()) {
        next.setUTCDate(next.getUTCDate() + 1);
    }

    return next;
}
