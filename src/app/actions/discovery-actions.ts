'use server';

// Expose a manual discovery boundary obeying M2.2 strict limits inherently 
import { runJobDiscovery } from '@/lib/jobs/discovery-service';
import { revalidatePath } from 'next/cache';

export async function triggerDiscoveryAction() {
    try {
        // runJobDiscovery handles authentication natively via supabase.auth.getUser()
        // It strictly encapsulates 5 pages limit natively across the active domains mapping exactly to job boundaries.
        const searchRunId = await runJobDiscovery();

        revalidatePath('/jobs');
        revalidatePath('/dashboard');

        return { success: true, searchRunId };
    } catch (err: unknown) {
        console.error("Discovery Edge Failure:", err);
        return { success: false, error: err instanceof Error ? err.message : "Sync aborted due to unknown server failure" };
    }
}
