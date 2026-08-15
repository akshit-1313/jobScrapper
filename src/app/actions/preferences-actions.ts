'use server'

import { createClient } from '@/utils/supabase/server'
import { PreferencesSchema } from '@/lib/types/profile'
import { revalidatePath } from 'next/cache'

export async function upsertPreferences(formData: unknown) {
    const supabase = await createClient()

    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
        return { success: false, error: 'Unauthorized' }
    }

    const result = PreferencesSchema.safeParse(formData)
    if (!result.success) {
        return { success: false, error: 'Validation failed', validationErrors: result.error.format() }
    }

    const { error } = await supabase
        .from('candidate_preferences')
        .upsert({
            user_id: authData.user.id,
            ...result.data,
            geographic_preferences: result.data.geographic_preferences, // handles arrays seamlessly
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })

    if (error) {
        console.error('Upsert preferences error:', error)
        return { success: false, error: error.message }
    }

    try {
        // Trigger bounded job matching based on new preferences
        const { triggerProfileMatching } = await import('./match-actions')
        await triggerProfileMatching()
    } catch (err) {
        console.error('Non-critical matcher failure on preferences update', err)
    }

    revalidatePath('/preferences')
    return { success: true }
}
