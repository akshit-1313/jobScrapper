import { NextResponse } from "next/server";
import { executeBackgroundDiscovery } from "@/lib/m8/background-discovery";
import { authorizeCronRequest } from "@/lib/cron/authorize";

/**
 * M8 Phase B - Background Discovery Orchestrator Entrypoint
 *
 * NOT SCHEDULED. M8 remains deferred (see the README section "M8 Background
 * Discovery - DISABLED / FUTURE WORK"): its discover() path is incompatible
 * with the installed Firecrawl SDK response shape, it applies no source cap,
 * URL cap, extraction reservation or rate gate, and it has no eligible users.
 * The daily cron is registered against /api/cron/daily-discovery instead, which
 * runs the validated Phase 3 flow.
 *
 * This route is kept reachable for manual, explicitly-authorised invocation.
 * GET is added so that IF M8 is ever scheduled the method matches how Vercel
 * Cron invokes a path; POST is retained because existing tests and callers use
 * it. Both share one handler, and authorisation always completes before any
 * database or Firecrawl work.
 */
async function handle(request: Request) {
    try {
        const auth = authorizeCronRequest(request.headers.get("authorization"));
        if (!auth.authorized) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }

        // Trigger orchestration cycle identically isolated.
        const result = await executeBackgroundDiscovery();

        return NextResponse.json(result, { status: 200 });

    } catch (error: unknown) {
        console.error("[CRON_FATAL]", error);
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
