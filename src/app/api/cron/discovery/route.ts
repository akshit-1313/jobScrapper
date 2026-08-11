import { NextResponse } from "next/server";
import { executeBackgroundDiscovery } from "@/lib/m8/background-discovery";

/**
 * M8 Phase B - Background Discovery Orchestrator Entrypoint
 * This endpoint is explicitly triggered by pg_cron (or equivalent trusted external cron services).
 * It unconditionally requires a valid Bearer token matching CRON_SECRET.
 * It immediately hands off execution strictly to `executeBackgroundDiscovery()`.
 */
export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("authorization");

        // Strictly use server-side environment configurations.
        const expectedSecret = process.env.CRON_SECRET;

        // Fail-closed initialization check
        if (!expectedSecret) {
            console.error("[CRON_AUTH_ERROR] System CRON_SECRET is not configured.");
            return NextResponse.json({ error: "System Configuration Error" }, { status: 500 });
        }

        if (authHeader !== `Bearer ${expectedSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
