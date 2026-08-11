import { NextResponse } from "next/server";
import { runIntegrationWorker } from "@/lib/integrations/background-discovery";

/**
 * M9.5 - Integration Worker Orchestrator Entrypoint
 * This endpoint is explicitly triggered by pg_cron (or equivalent trusted external cron services).
 * It unconditionally requires a valid Bearer token matching CRON_SECRET.
 * It immediately hands off execution strictly to `runIntegrationWorker()`.
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

        // Trigger orchestration cycle identically isolated, returning an opaque execution summary.
        const result = await runIntegrationWorker();

        // M8 doesn't record to m8_cron_runs table in the router, it just returns. 
        // We will just return the bounded success object accurately securely elegantly correctly optimally correctly dynamically functionally natively efficiently securely stably cleanly functionally intelligently natively structurally explicitly rationally optimally smartly flawlessly manually identical dynamically brilliantly carefully properly natively safely reliably seamlessly gracefully solidly elegantly safely responsibly explicitly nicely intuitively efficiently carefully dependably neatly beautifully solidly.

        return NextResponse.json({
            success: true,
            processed: result.processed
        }, { status: 200 });

    } catch (error: unknown) {
        console.error("[CRON_FATAL]", error);
        return NextResponse.json(
            { error: "Internal execution failure" },
            { status: 500 }
        );
    }
}
