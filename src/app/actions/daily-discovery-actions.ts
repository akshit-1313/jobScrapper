'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Opt the signed-in user in or out of the scheduled daily discovery run.
 *
 * Opt-in only: the column defaults to false and nothing enables it implicitly,
 * because every scheduled run spends Firecrawl credits.
 *
 * Uses the authenticated request client. `profiles` carries owner-scoped RLS
 * ("Users can update own profile", USING and WITH CHECK `auth.uid() = user_id`),
 * and the statement additionally filters on the verified session id, so a
 * caller cannot flip another user's flag even if the policy were absent. The
 * user id is never taken from an argument.
 */
export async function setDailyDiscoveryEnabled(enabled: boolean) {
    try {
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        if (typeof enabled !== 'boolean') {
            return { success: false, error: 'Invalid input parameters' }
        }

        const { error } = await supabase
            .from('profiles')
            .update({ daily_discovery_enabled: enabled })
            .eq('user_id', user.id)

        if (error) {
            console.error('[DailyDiscovery] Failed to update opt-in:', error.message)
            return { success: false, error: 'Could not update your daily search setting.' }
        }

        // /search-discovery is where the toggle now lives; /settings still links
        // to it and is kept so nothing that already depended on it regresses.
        revalidatePath('/search-discovery')
        revalidatePath('/settings')
        return { success: true, enabled }

    } catch (error) {
        console.error('[DailyDiscovery] Unexpected error updating opt-in:', error)
        return { success: false, error: 'An unexpected internal error occurred.' }
    }
}
