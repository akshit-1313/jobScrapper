'use server'

import { createClient } from '@/utils/supabase/server'
import { refreshUsageSnapshot } from '@/lib/firecrawl/usage-service'
import { revalidatePath } from 'next/cache'

/**
 * Explicit user-initiated balance refresh.
 *
 * The only path that contacts the provider from the UI, and it is rate-limited
 * server-side by the snapshot TTL. Page renders never call it.
 *
 * Returns nothing but a success flag: the refreshed values are read back from
 * the stored snapshot when the page revalidates, so no provider payload — and
 * certainly no credential — is ever handed to the browser.
 */
export async function refreshFirecrawlUsage() {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        const snapshot = await refreshUsageSnapshot()

        revalidatePath('/profile')
        revalidatePath('/settings')

        if (!snapshot) {
            return {
                success: false,
                error: 'Could not reach Firecrawl. Showing the last known balance.',
            }
        }

        return { success: true }
    } catch (error) {
        console.error('[Usage] Refresh failed:', error)
        return { success: false, error: 'Could not refresh usage right now.' }
    }
}
