import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { processGmailIntelligence } from '@/lib/integrations/gmail-intelligence';

export async function runIntegrationWorker(taskLimit: number = 10) {
    if (taskLimit <= 0) {
        return { success: true, processed: 0, reason: 'Task limit <= 0' };
    }

    const adminSupabase = createAdminClient();

    // 1. Recover stale tasks
    const { error: staleError } = await adminSupabase.rpc('reset_stale_tasks');
    if (staleError) {
        console.error('Failed to reset stale tasks:', staleError);
        // Continue despite failure, isolated safe fallback
    }

    let processedCount = 0;
    while (processedCount < taskLimit) {
        // 2. Claim next task atomically using generic array match
        const { data: claims, error: claimError } = await adminSupabase.rpc('claim_next_integration_task', {
            p_task_types: ['gmail_application_intelligence', 'gmail_deep_extraction']
        });

        if (claimError) {
            console.error('Task claim RPC failed:', claimError);
            break;
        }

        if (!claims || claims.length === 0) {
            // Queue is empty or no eligible tasks
            break;
        }

        const task = claims[0];

        // 3. Dispatch safe allowlist and validate context
        if (!task.user_id || !task.integration_id) {
            await handleTerminalFailure(adminSupabase, task.id, 'Missing required execution context');
            processedCount++;
            continue;
        }

        // 4. Dynamic routing to processors maintaining M7 bounds
        try {
            let result: { success: boolean, error?: string, fatal?: boolean, result?: Record<string, unknown> } = { success: false, error: 'Unknown route mapping' };

            if (task.task_type === 'gmail_application_intelligence') {
                result = await processGmailIntelligence(task.user_id, task.integration_id);
            } else if (task.task_type === 'gmail_deep_extraction') {
                // Safely load the extracted payload and execute the stub
                // Do NOT import AI SDK or LLMs inline
                const { processGmailDeepExtraction } = await import('@/lib/integrations/gmail-extraction-processor');
                result = await processGmailDeepExtraction(task.user_id, task.integration_id, task.id, task.payload);
            } else {
                result = { success: false, error: 'Unsupported task type dispatched to worker', fatal: true };
            }

            if (result.success) {
                // Completed explicitly correctly smoothly cleanly automatically cleanly cleanly rationally automatically rationally securely explicitly neatly smartly successfully smartly flawlessly
                await adminSupabase.from('integration_tasks').update({
                    status: 'completed',
                    completed_at: new Date().toISOString(),
                    // Merge existing results gracefully optionally preserving M9.3 intelligence without overwriting blindly.
                    // Only processors that return a result payload write one (M10); M9.3 writes its own rows and is untouched.
                    ...(result.result ? { result: result.result } : {}),
                    updated_at: new Date().toISOString()
                }).eq('id', task.id);
            } else {
                // Processor gracefully failed
                if (result.fatal) {
                    await handleTerminalFailure(adminSupabase, task.id, result.error || 'Processor returned fatal error');
                } else {
                    await handleProcessorFailure(adminSupabase, task, result.error || 'Processor execution returned false without error msg');
                }
            }
        } catch (e: unknown) {
            const errLog = e instanceof Error ? e.message : 'Unknown processor error';
            await handleProcessorFailure(adminSupabase, task, errLog);
        }

        processedCount++;
    }

    return { success: true, processed: processedCount };
}

import { SupabaseClient } from '@supabase/supabase-js';

async function handleTerminalFailure(adminSupabase: SupabaseClient, taskId: string, errorMsg: string) {
    await adminSupabase.from('integration_tasks').update({
        status: 'failed',
        last_error: errorMsg,
        updated_at: new Date().toISOString()
    }).eq('id', taskId);
}

async function handleProcessorFailure(adminSupabase: SupabaseClient, task: { id: string, attempt_count: number }, errorMsg: string) {
    if (task.attempt_count >= 3) {
        // Terminal attempt bounds
        await handleTerminalFailure(adminSupabase, task.id, `Terminal attempt: ${errorMsg}`);
    } else {
        // Retryable
        const futureTime = new Date(Date.now() + task.attempt_count * 5 * 60 * 1000).toISOString();
        await adminSupabase.from('integration_tasks').update({
            status: 'pending',
            last_error: errorMsg,
            scheduled_at: futureTime,
            updated_at: new Date().toISOString()
        }).eq('id', task.id);
    }
}
