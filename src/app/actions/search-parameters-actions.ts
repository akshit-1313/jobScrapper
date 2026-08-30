'use server'

import { createClient } from '@/utils/supabase/server'
import { SearchParametersSchema } from '@/lib/types/search-parameters'
import { revalidatePath } from 'next/cache'

/**
 * Save the user's Search Parameters — what they want to search for.
 *
 * Stored in candidate_preferences, the single source of truth already read by
 * both the manual Find Matching Jobs path and the 04:00 UTC scheduled run.
 * Only the seven search fields are written, so the matching constraints edited
 * on /preferences (salary, visa, relocation, experience) are never touched by
 * this action.
 *
 * Uses the authenticated request client. candidate_preferences carries
 * owner-scoped RLS from migration 006, and the upsert conflict target is
 * user_id with the id taken from the verified session — never from an argument.
 */
export async function saveSearchParameters(input: unknown) {
    try {
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        const parsed = SearchParametersSchema.safeParse(input)
        if (!parsed.success) {
            return { success: false, error: 'Invalid search parameters' }
        }

        const { error } = await supabase
            .from('candidate_preferences')
            .upsert({
                user_id: user.id,
                ...parsed.data,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' })

        if (error) {
            console.error('[SearchParameters] Save failed:', error.message)
            return { success: false, error: 'Could not save your search parameters.' }
        }

        // Queries are rebuilt from these on the next run, manual or scheduled.
        // /search-discovery hosts the editor; the other two are retained because
        // they read the same candidate_preferences row.
        revalidatePath('/search-discovery')
        revalidatePath('/profile')
        revalidatePath('/preferences')
        return { success: true, data: parsed.data }

    } catch (error) {
        console.error('[SearchParameters] Unexpected error:', error)
        return { success: false, error: 'An unexpected internal error occurred.' }
    }
}
