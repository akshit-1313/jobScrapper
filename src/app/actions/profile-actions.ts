'use server'

import { createClient } from '@/utils/supabase/server'
import { ProfileSchema, SkillSchema, ExperienceSchema } from '@/lib/types/profile'
import { revalidatePath } from 'next/cache'

// PROFILE ACTIONS
export async function upsertProfile(formData: unknown) {
    const supabase = await createClient()

    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
        return { success: false, error: 'Unauthorized' }
    }

    const result = ProfileSchema.safeParse(formData)
    if (!result.success) {
        return { success: false, error: 'Validation failed', validationErrors: result.error.format() }
    }

    try {
        const { error } = await supabase
            .from('profiles')
            .upsert({
                user_id: authData.user.id,
                ...result.data,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' })

        if (error) {
            console.error('Upsert profile error:', error)
            return { success: false, error: error.message }
        }
    } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred' }
    }

    try {
        const { triggerProfileMatching } = await import('./match-actions')
        await triggerProfileMatching()
    } catch (err) {
        console.error('Non-critical matcher failure on profile update', err)
    }

    revalidatePath('/profile')
    return { success: true }
}

// SKILLS ACTIONS
export async function upsertSkill(formData: unknown) {
    const supabase = await createClient()
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) return { success: false, error: 'Unauthorized' }

    const result = SkillSchema.safeParse(formData)
    if (!result.success) return { success: false, error: 'Validation error' }

    const payload: Record<string, unknown> = { ...result.data }
    const id = payload.id
    delete payload.id

    const { error } = id
        ? await supabase.from('candidate_skills').update(payload).eq('id', id).eq('user_id', authData.user.id)
        : await supabase.from('candidate_skills').insert({
            user_id: authData.user.id,
            ...payload,
        })

    if (error) return { success: false, error: error.message }
    revalidatePath('/profile')
    return { success: true }
}

export async function deleteSkill(skillId: string) {
    const supabase = await createClient()
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) return { success: false, error: 'Unauthorized' }

    // Security: user_id = authData.user.id ensures you can only delete your own record
    const { error } = await supabase
        .from('candidate_skills')
        .delete()
        .eq('id', skillId)
        .eq('user_id', authData.user.id)

    if (error) return { success: false, error: error.message }
    revalidatePath('/profile')
    return { success: true }
}

// EXPERIENCE ACTIONS
export async function upsertExperience(formData: unknown) {
    const supabase = await createClient()
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) return { success: false, error: 'Unauthorized' }

    const result = ExperienceSchema.safeParse(formData)
    if (!result.success) return { success: false, error: 'Validation error' }

    if (result.data.is_current) {
        result.data.end_date = null
    }

    const payload: Record<string, unknown> = {
        ...result.data,
        user_id: authData.user.id,
        updated_at: new Date().toISOString()
    }

    const { error } = result.data.id
        ? await supabase.from('candidate_experience').update(payload).eq('id', result.data.id).eq('user_id', authData.user.id)
        : await supabase.from('candidate_experience').insert(payload) // new

    if (error) return { success: false, error: error.message }
    revalidatePath('/profile')
    return { success: true }
}

export async function deleteExperience(expId: string) {
    const supabase = await createClient()
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) return { success: false, error: 'Unauthorized' }

    const { error } = await supabase
        .from('candidate_experience')
        .delete()
        .eq('id', expId)
        .eq('user_id', authData.user.id)

    if (error) return { success: false, error: error.message }
    revalidatePath('/profile')
    return { success: true }
}
