'use server'

import { createClient } from '@/utils/supabase/server'
import { CreateOrUpdateSavedJobSchema, RemoveSavedJobSchema } from '@/lib/types/tracking'

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

/**
 * Remove a job from the user's saved list, returning it to the unsaved state.
 *
 * saved_jobs has no 'none' status — one row per (user_id, job_id) exists or it
 * does not — so unsaving deletes the row. saved_jobs already carries a DELETE
 * policy scoped to `auth.uid() = user_id` (migration 006), so this needs no
 * schema or policy change, and the `.eq('user_id', user.id)` below means the
 * statement cannot touch another user's row even if RLS were absent.
 *
 * Idempotent: deleting a row that is already gone is a success, so a
 * double-click cannot produce an error.
 */
export async function removeSavedJob(input: { jobId: string }) {
    try {
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        const validated = RemoveSavedJobSchema.safeParse(input)
        if (!validated.success) {
            return { success: false, error: 'Invalid input parameters' }
        }

        const { error: deleteError } = await supabase
            .from('saved_jobs')
            .delete()
            .eq('user_id', user.id)
            .eq('job_id', validated.data.jobId)

        if (deleteError) {
            console.error('Saved Jobs Error:', deleteError)
            return { success: false, error: 'Database rejected the tracking operation.' }
        }

        return { success: true, data: { status: null } }

    } catch (error) {
        console.error('Saved Jobs Error:', error)
        return { success: false, error: 'An unexpected internal error occurred.' }
    }
}
