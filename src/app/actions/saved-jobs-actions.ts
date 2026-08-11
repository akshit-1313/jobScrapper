'use server'

import { createClient } from '@/utils/supabase/server'
import { CreateOrUpdateSavedJobSchema } from '@/lib/types/tracking'

export async function createOrUpdateSavedJob(input: { jobId: string, status: string }) {
    try {
        const supabase = await createClient()

        // 1. Authenticate user strictly
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        // 2. Validate input against schema mapping database limits implicitly
        const validated = CreateOrUpdateSavedJobSchema.safeParse(input)
        if (!validated.success) {
            return { success: false, error: 'Invalid input parameters' }
        }

        const { jobId, status } = validated.data

        // 3. Upsert into saved_jobs (Supabase RLS implicitly guarantees user ownership bindings)
        // Schema guarantees unique constraint `(user_id, job_id)` handles native UPSERT correctly.
        const { error: upsertError } = await supabase.from('saved_jobs').upsert({
            user_id: user.id,
            job_id: jobId,
            status: status
        }, { onConflict: 'user_id,job_id' })

        if (upsertError) {
            console.error('Saved Jobs Error:', upsertError)
            return { success: false, error: 'Database rejected the tracking operation.' }
        }

        return { success: true, data: { status } }

    } catch (error) {
        console.error('Saved Jobs Error:', error)
        return { success: false, error: 'An unexpected internal error occurred.' }
    }
}
