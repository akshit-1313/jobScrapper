import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize";
import { runScheduledDailyDiscovery } from "@/lib/jobs/scheduled-discovery";

/**
 * Scheduled daily discovery entrypoint.
 *
 * This is the path registered in vercel.json (`0 4 * * *`, UTC). It runs the
 * validated Phase 3 profile-targeted flow for one opted-in user, NOT M8's
 * executeBackgroundDiscovery, which stays dormant on /api/cron/discovery.
 *
 * GET is the method Vercel Cron uses. POST is offered for manual invocation
 * with the same secret. Both delegate to one handler so their authorisation and
 * behaviour cannot diverge, and authorisation always completes before any
 * database or Firecrawl work begins.
 */
async function handle(request: Request) {
    try {
        const auth = authorizeCronRequest(request.headers.get("authorization"));
        if (!auth.authorized) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }

        const result = await runScheduledDailyDiscovery();
        return NextResponse.json(result, { status: 200 });

    } catch (error: unknown) {
        console.error("[CRON_FATAL] Scheduled discovery threw:", error);
        return NextResponse.json(
            { error: "Internal execution failure" },
            { status: 500 }
        );
    }
}

export async function GET(request: Request) {
    return handle(request);
}

export async function POST(request: Request) {
    return handle(request);
}
