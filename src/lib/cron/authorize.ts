/**
 * Shared authorisation for scheduled route handlers.
 *
 * Vercel Cron invokes a path with a GET request and, when CRON_SECRET is set on
 * the project, sends it as `Authorization: Bearer <secret>`. Both GET and POST
 * handlers run this check so the two methods cannot drift apart, and both must
 * call it BEFORE touching the database or Firecrawl.
 *
 * Fail-closed: an unconfigured secret is a server misconfiguration (500), not
 * an open door. Never logs the secret or the presented header.
 */
export type CronAuthResult =
    | { authorized: true }
    | { authorized: false; status: 401 | 500; error: string };

export function authorizeCronRequest(authHeader: string | null): CronAuthResult {
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
        console.error('[CRON_AUTH_ERROR] System CRON_SECRET is not configured.');
        return { authorized: false, status: 500, error: 'System Configuration Error' };
    }

    if (authHeader !== `Bearer ${expectedSecret}`) {
        return { authorized: false, status: 401, error: 'Unauthorized' };
    }

    return { authorized: true };
}
