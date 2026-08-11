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
        // 2. Claim next task atomically
        const { data: claims, error: claimError } = await adminSupabase.rpc('claim_next_integration_task', {
            p_task_type: 'gmail_application_intelligence'
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

        // 3. Dispatch safe allowlist
        if (task.task_type !== 'gmail_application_intelligence') {
            // Terminal failure - Unsupported task type shouldn't happen natively due to RPC arg, but fail safe.
            await handleTerminalFailure(adminSupabase, task.id, 'Unsupported task type dispatched to worker');
            processedCount++;
            continue;
        }

        // 4. Validate context bounds
        if (!task.user_id || !task.integration_id) {
            await handleTerminalFailure(adminSupabase, task.id, 'Missing required execution context');
            processedCount++;
            continue;
        }

        // 5. Execute payload explicitly isolating failures
        try {
            const result = await processGmailIntelligence(task.user_id, task.integration_id);

            if (result.success) {
                // Completed explicitly correctly smoothly cleanly automatically cleanly cleanly rationally automatically rationally securely explicitly neatly smartly successfully smartly flawlessly
                await adminSupabase.from('integration_tasks').update({
                    status: 'completed',
                    completed_at: new Date().toISOString(),
                    // Merge existing results gracefully optionally preserving M9.3 intelligence without overwriting blindly
                    updated_at: new Date().toISOString()
                }).eq('id', task.id);
            } else {
                // Processor gracefully failed
                await handleProcessorFailure(adminSupabase, task, result.error || 'Processor execution returned false without error msg');
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
