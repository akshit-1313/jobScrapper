'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { parseResume } from '@/lib/resume/resume-parser'
import { ResumeConfirmSchema, ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from '@/lib/types/resume'
import type { ParsedResumeData, ResumeVersion, ResumeRecord } from '@/lib/types/resume'

// ── Upload Resume ───────────────────────────────────────────────────────────

export async function uploadResume(formData: FormData): Promise<{
    success: boolean
    error?: string
    data?: { parsedData: ParsedResumeData; version: ResumeVersion }
}> {
    const supabase = await createClient()
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
        return { success: false, error: 'Unauthorized' }
    }
    const userId = authData.user.id

    // 1. Extract and validate file from FormData
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
        return { success: false, error: 'No file provided' }
    }

    if (!ALLOWED_FILE_TYPES.includes(file.type as typeof ALLOWED_FILE_TYPES[number])) {
        return { success: false, error: 'Only PDF and DOCX files are accepted' }
    }

    if (file.size > MAX_FILE_SIZE) {
        return { success: false, error: 'File size exceeds 10 MB limit' }
    }

    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!extension || !['pdf', 'docx'].includes(extension)) {
        return { success: false, error: 'Invalid file extension. Only .pdf and .docx are accepted' }
    }

    const fileType = extension as 'pdf' | 'docx'
    const timestamp = Date.now()
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${userId}/${timestamp}_${sanitizedName}`

    // 2. Read file buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 3. Upload to Storage
    const { error: uploadError } = await supabase.storage
        .from('resumes')
        .upload(storagePath, buffer, {
            contentType: file.type,
            upsert: false,
        })

    if (uploadError) {
        console.error('[uploadResume] Storage upload error:', uploadError.message)
        return { success: false, error: 'Failed to upload file. Please try again.' }
    }

    // Helper: best-effort cleanup of uploaded storage file
    async function cleanupStorageFile(): Promise<void> {
        const { error: rmErr } = await supabase.storage.from('resumes').remove([storagePath])
        if (rmErr) {
            console.error('[uploadResume] Cleanup: failed to remove orphaned storage file:', rmErr.message)
        }
    }

    // 4. Look up existing resumes record (distinguish "not found" from DB error)
    let resumeRecord: ResumeRecord | null = null
    // Track whether THIS invocation created the resumes row
    let createdResumeRecord = false

    const { data: existingResume, error: resumeFetchError } = await supabase
        .from('resumes')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()

    if (resumeFetchError) {
        console.error('[uploadResume] Resume lookup error:', resumeFetchError.message)
        await cleanupStorageFile()
        return { success: false, error: 'Failed to look up resume record. Please try again.' }
    }

    if (existingResume) {
        resumeRecord = existingResume as ResumeRecord
    } else {
        const { data: newResume, error: resumeCreateError } = await supabase
            .from('resumes')
            .insert({ user_id: userId })
            .select()
            .single()

        if (resumeCreateError || !newResume) {
            console.error('[uploadResume] Resume record creation error:', resumeCreateError?.message)
            await cleanupStorageFile()
            return { success: false, error: 'Failed to create resume record. Please try again.' }
        }
        resumeRecord = newResume as ResumeRecord
        createdResumeRecord = true
    }

    // 5. Capture EXACT previous state for rollback
    const { data: previousVersions, error: prevVersionsFetchError } = await supabase
        .from('resume_versions')
        .select('id, is_active')
        .eq('resume_id', resumeRecord.id)

    if (prevVersionsFetchError) {
        console.error('[uploadResume] Failed to fetch existing versions for rollback capture:', prevVersionsFetchError.message)
        // If we created the resume row, delete it before returning
        if (createdResumeRecord) {
            const { error: cleanupResumeErr } = await supabase.from('resumes').delete().eq('id', resumeRecord.id)
            if (cleanupResumeErr) {
                console.error('[uploadResume] Cleanup: failed to delete newly-created resumes row:', cleanupResumeErr.message)
            }
        }
        await cleanupStorageFile()
        return { success: false, error: 'Failed to prepare upload. Please try again.' }
    }

    const previousVersionStates = (previousVersions ?? []) as { id: string; is_active: boolean }[]
    const previousActiveVersionId = resumeRecord.active_version_id as string | null

    // Helper: restore the exact previous version is_active states and active_version_id
    async function restorePreviousVersionStates(): Promise<void> {
        for (const vs of previousVersionStates) {
            const { error: restoreErr } = await supabase
                .from('resume_versions')
                .update({ is_active: vs.is_active })
                .eq('id', vs.id)
            if (restoreErr) {
                console.error(`[uploadResume] Rollback: failed to restore version ${vs.id} is_active=${vs.is_active}:`, restoreErr.message)
            }
        }
        const { error: restoreActiveErr } = await supabase
            .from('resumes')
            .update({ active_version_id: previousActiveVersionId })
            .eq('id', resumeRecord!.id)
        if (restoreActiveErr) {
            console.error('[uploadResume] Rollback: failed to restore active_version_id:', restoreActiveErr.message)
        }
    }

    // Helper: delete the newly-created resumes row (only when this invocation created it)
    async function cleanupNewResumeRow(): Promise<void> {
        if (!createdResumeRecord) return
        const { error: deleteResumeErr } = await supabase
            .from('resumes')
            .delete()
            .eq('id', resumeRecord!.id)
        if (deleteResumeErr) {
            console.error('[uploadResume] Cleanup: failed to delete newly-created resumes row (possible FK dependency):', deleteResumeErr.message)
        }
    }

    // 6. Deactivate all previous active versions
    const { error: deactivateError } = await supabase
        .from('resume_versions')
        .update({ is_active: false })
        .eq('resume_id', resumeRecord.id)
        .eq('is_active', true)

    if (deactivateError) {
        console.error('[uploadResume] Failed to deactivate previous versions:', deactivateError.message)
        await restorePreviousVersionStates()
        await cleanupNewResumeRow()
        await cleanupStorageFile()
        return { success: false, error: 'Failed to prepare version upload. Please try again.' }
    }

    // 7. Create resume_versions record
    const versionLabel = `v${timestamp}`
    const { data: versionData, error: versionError } = await supabase
        .from('resume_versions')
        .insert({
            resume_id: resumeRecord.id,
            file_path: storagePath,
            file_name: file.name,
            file_type: fileType,
            file_size: file.size,
            version_label: versionLabel,
            is_active: true,
        })
        .select()
        .single()

    if (versionError || !versionData) {
        console.error('[uploadResume] Version creation error:', versionError?.message)
        await restorePreviousVersionStates()
        await cleanupNewResumeRow()
        await cleanupStorageFile()
        return { success: false, error: 'Failed to create version record. Please try again.' }
    }

    // 8. Update resumes.active_version_id
    const { error: activeVersionError } = await supabase
        .from('resumes')
        .update({ active_version_id: versionData.id })
        .eq('id', resumeRecord.id)

    if (activeVersionError) {
        console.error('[uploadResume] Failed to update active_version_id:', activeVersionError.message)
        // Delete new version record first
        const { error: deleteNewVersionErr } = await supabase
            .from('resume_versions')
            .delete()
            .eq('id', versionData.id)
        if (deleteNewVersionErr) {
            console.error('[uploadResume] Rollback: failed to delete new version record:', deleteNewVersionErr.message)
        }
        await restorePreviousVersionStates()
        await cleanupNewResumeRow()
        await cleanupStorageFile()
        return { success: false, error: 'Failed to save version as active. Please try again.' }
    }

    // 9. Parse the resume
    let parsedData: ParsedResumeData
    try {
        parsedData = await parseResume(buffer, fileType)
    } catch (parseError) {
        console.error('[uploadResume] Resume parsing error:', parseError instanceof Error ? parseError.message : String(parseError))
        // Upload succeeded — return empty parsed data so user still gets the uploaded file
        revalidatePath('/profile')
        return {
            success: true,
            data: {
                parsedData: {
                    profile: {
                        name: null, headline: null, professional_summary: null,
                        years_of_experience: null, current_location: null,
                        linkedin_url: null, github_url: null, portfolio_url: null,
                    },
                    skills: [],
                    experience: [],
                    engagements: [],
                    education: [],
                    certifications: [],
                    raw_text: '',
                },
                version: versionData as ResumeVersion,
            }
        }
    }

    // Persist the extracted text alongside the binary file. The original upload in
    // storage is untouched. A failure here is non-fatal: the upload and parse both
    // succeeded, and raw_text is supplementary. Never log the text itself.
    if (parsedData.raw_text) {
        const { error: rawTextError } = await supabase
            .from('resume_versions')
            .update({ raw_text: parsedData.raw_text })
            .eq('id', versionData.id)
        if (rawTextError) {
            console.error('[uploadResume] Failed to persist raw_text (non-fatal):', rawTextError.message)
        }
    }

    revalidatePath('/profile')
    return {
        success: true,
        data: {
            parsedData,
            version: versionData as ResumeVersion,
        }
    }
}

// ── Confirm Parsed Profile ──────────────────────────────────────────────────

export async function confirmParsedProfile(formData: unknown): Promise<{
    success: boolean
    error?: string
}> {
    const supabase = await createClient()
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
        return { success: false, error: 'Unauthorized' }
    }
    const userId = authData.user.id

    const result = ResumeConfirmSchema.safeParse(formData)
    if (!result.success) {
        return { success: false, error: 'Validation failed. Please check your inputs.' }
    }

    const { profile, skills, experience, engagements, education, certifications } = result.data

    // ── Capture previous state BEFORE any mutation ──────────────────────────
    // This enables best-effort rollback if a later step fails.
    // NOTE: This is NOT a transaction. Restore operations can themselves fail.

    const { data: prevProfile, error: prevProfileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()
    if (prevProfileErr) {
        console.error('[confirmParsedProfile] Failed to fetch previous profile for rollback capture:', prevProfileErr.message)
        return { success: false, error: 'Failed to prepare profile update. Please try again.' }
    }

    const { data: prevSkills, error: prevSkillsErr } = await supabase
        .from('candidate_skills')
        .select('*')
        .eq('user_id', userId)
    if (prevSkillsErr) {
        console.error('[confirmParsedProfile] Failed to fetch previous skills for rollback capture:', prevSkillsErr.message)
        return { success: false, error: 'Failed to prepare skills update. Please try again.' }
    }

    const { data: prevExperience, error: prevExpErr } = await supabase
        .from('candidate_experience')
        .select('*')
        .eq('user_id', userId)
    if (prevExpErr) {
        console.error('[confirmParsedProfile] Failed to fetch previous experience for rollback capture:', prevExpErr.message)
        return { success: false, error: 'Failed to prepare experience update. Please try again.' }
    }

    // Helpers for best-effort restore. All log errors; none throw.
    async function restoreProfile(): Promise<void> {
        if (!prevProfile) {
            // No existing profile row — delete what we just upserted
            const { error: e } = await supabase.from('profiles').delete().eq('user_id', userId)
            if (e) console.error('[confirmParsedProfile] Rollback: failed to remove newly-upserted profile:', e.message)
            return
        }
        const { error: e } = await supabase
            .from('profiles')
            .upsert({ ...prevProfile }, { onConflict: 'user_id' })
        if (e) console.error('[confirmParsedProfile] Rollback: failed to restore previous profile:', e.message)
    }

    async function restoreSkills(): Promise<void> {
        // Delete whatever is there now
        const { error: delErr } = await supabase.from('candidate_skills').delete().eq('user_id', userId)
        if (delErr) {
            console.error('[confirmParsedProfile] Rollback: failed to clear current skills before restore:', delErr.message)
            return
        }
        if (!prevSkills || prevSkills.length === 0) return
        const { error: insErr } = await supabase.from('candidate_skills').insert(prevSkills)
        if (insErr) console.error('[confirmParsedProfile] Rollback: failed to re-insert previous skills:', insErr.message)
    }

    async function restoreExperience(): Promise<void> {
        // Delete whatever is there now
        const { error: delErr } = await supabase.from('candidate_experience').delete().eq('user_id', userId)
        if (delErr) {
            console.error('[confirmParsedProfile] Rollback: failed to clear current experience before restore:', delErr.message)
            return
        }
        if (!prevExperience || prevExperience.length === 0) return
        const { error: insErr } = await supabase.from('candidate_experience').insert(prevExperience)
        if (insErr) console.error('[confirmParsedProfile] Rollback: failed to re-insert previous experience:', insErr.message)
    }

    // ── Step 1: Upsert profile ───────────────────────────────────────────────
    const cleanedProfile = {
        user_id: userId,
        name: profile.name,
        headline: profile.headline || null,
        professional_summary: profile.professional_summary || null,
        years_of_experience: profile.years_of_experience ?? null,
        current_location: profile.current_location || null,
        linkedin_url: profile.linkedin_url || null,
        github_url: profile.github_url || null,
        portfolio_url: profile.portfolio_url || null,
        updated_at: new Date().toISOString(),
    }

    const { error: profileError } = await supabase
        .from('profiles')
        .upsert(cleanedProfile, { onConflict: 'user_id' })

    if (profileError) {
        console.error('[confirmParsedProfile] Profile upsert error:', profileError.message)
        // Nothing destructive done yet — no rollback needed
        return { success: false, error: 'Failed to save profile information' }
    }

    // ── Step 2: Replace skills ───────────────────────────────────────────────
    const { error: skillsDeleteError } = await supabase
        .from('candidate_skills')
        .delete()
        .eq('user_id', userId)

    if (skillsDeleteError) {
        console.error('[confirmParsedProfile] Skills delete error:', skillsDeleteError.message)
        // Profile was mutated — restore it
        await restoreProfile()
        return { success: false, error: 'Failed to update skills' }
    }

    if (skills.length > 0) {
        const skillRecords = skills.map(s => ({
            user_id: userId,
            skill_name: s.skill_name,
            category: s.category ?? null,
            proficiency_level: s.proficiency_level || null,
            years_used: s.years_used ?? null,
            is_primary: s.is_primary ?? false,
        }))

        const { error: skillsInsertError } = await supabase
            .from('candidate_skills')
            .insert(skillRecords)

        if (skillsInsertError) {
            console.error('[confirmParsedProfile] Skills insert error:', skillsInsertError.message)
            // Skills deleted — restore previous skills + profile
            await restoreSkills()
            await restoreProfile()
            return { success: false, error: 'Failed to save skills' }
        }
    }

    // ── Step 3: Replace experience ───────────────────────────────────────────
    const { error: expDeleteError } = await supabase
        .from('candidate_experience')
        .delete()
        .eq('user_id', userId)

    if (expDeleteError) {
        console.error('[confirmParsedProfile] Experience delete error:', expDeleteError.message)
        // Skills already replaced — restore skills + profile
        await restoreSkills()
        await restoreProfile()
        return { success: false, error: 'Failed to update experience' }
    }

    if (experience.length > 0) {
        const expRecords = experience.map(e => ({
            user_id: userId,
            company_name: e.company_name,
            title: e.title,
            start_date: e.start_date || null,
            end_date: e.is_current ? null : (e.end_date || null),
            description: e.description || null,
            responsibilities: e.responsibilities ?? [],
            achievements: e.achievements ?? [],
            is_current: e.is_current ?? false,
            updated_at: new Date().toISOString(),
        }))

        const { error: expInsertError } = await supabase
            .from('candidate_experience')
            .insert(expRecords)

        if (expInsertError) {
            console.error('[confirmParsedProfile] Experience insert error:', expInsertError.message)
            // Experience deleted — restore experience + skills + profile
            await restoreExperience()
            await restoreSkills()
            await restoreProfile()
            return { success: false, error: 'Failed to save experience' }
        }
    }

    // ── Step 3b: Replace client engagements ──────────────────────────────────
    // Additive M5 structure, same non-blocking policy as education below.
    const { error: engDeleteError } = await supabase
        .from('candidate_engagements')
        .delete()
        .eq('user_id', userId)

    if (engDeleteError) {
        console.error('[confirmParsedProfile] Engagements delete error:', engDeleteError.message)
    } else if (engagements.length > 0) {
        const engRecords = engagements.map(e => ({
            user_id: userId,
            client_name: e.client_name,
            parent_company: e.parent_company || null,
            start_date: e.start_date || null,
            end_date: e.is_current ? null : (e.end_date || null),
            is_current: e.is_current ?? false,
            responsibilities: e.responsibilities ?? [],
            achievements: e.achievements ?? [],
            technologies: e.technologies ?? [],
            domains: e.domains ?? [],
        }))
        const { error: engInsertError } = await supabase
            .from('candidate_engagements')
            .insert(engRecords)
        if (engInsertError) {
            console.error('[confirmParsedProfile] Engagements insert error:', engInsertError.message)
        }
    }

    // ── Step 4: Replace education ────────────────────────────────────────────
    // Education and certifications are additive M5 structure. A failure here is
    // reported but does NOT roll back profile/skills/experience — those are the
    // fields M6 matching depends on, and partially-saved structure is preferable
    // to discarding a successful profile write.
    const { error: eduDeleteError } = await supabase
        .from('candidate_education')
        .delete()
        .eq('user_id', userId)

    if (eduDeleteError) {
        console.error('[confirmParsedProfile] Education delete error:', eduDeleteError.message)
    } else if (education.length > 0) {
        const eduRecords = education.map(e => ({
            user_id: userId,
            institution: e.institution,
            degree: e.degree || null,
            field_of_study: e.field_of_study || null,
            start_date: e.start_date || null,
            end_date: e.end_date || null,
            grade: e.grade || null,
        }))
        const { error: eduInsertError } = await supabase
            .from('candidate_education')
            .insert(eduRecords)
        if (eduInsertError) {
            console.error('[confirmParsedProfile] Education insert error:', eduInsertError.message)
        }
    }

    // ── Step 5: Replace certifications ───────────────────────────────────────
    const { error: certDeleteError } = await supabase
        .from('candidate_certifications')
        .delete()
        .eq('user_id', userId)

    if (certDeleteError) {
        console.error('[confirmParsedProfile] Certifications delete error:', certDeleteError.message)
    } else if (certifications.length > 0) {
        const certRecords = certifications.map(c => ({
            user_id: userId,
            name: c.name,
            issuer: c.issuer || null,
            issue_date: c.issue_date || null,
            expiry_date: c.expiry_date || null,
            credential_id: c.credential_id || null,
        }))
        const { error: certInsertError } = await supabase
            .from('candidate_certifications')
            .insert(certRecords)
        if (certInsertError) {
            console.error('[confirmParsedProfile] Certifications insert error:', certInsertError.message)
        }
    }

    try {
        const { triggerProfileMatching } = await import('./match-actions')
        await triggerProfileMatching()
    } catch (err) {
        console.error('Non-critical matcher failure on resume confirmation', err)
    }

    revalidatePath('/profile')
    return { success: true }
}

// ── Set Active Version ──────────────────────────────────────────────────────

export async function setActiveVersion(versionId: string): Promise<{
    success: boolean
    error?: string
}> {
    const supabase = await createClient()
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
        return { success: false, error: 'Unauthorized' }
    }
    const userId = authData.user.id

    // Verify the version belongs to this user's resume
    const { data: version, error: versionFetchError } = await supabase
        .from('resume_versions')
        .select('id, resume_id, resumes!inner(user_id, active_version_id)')
        .eq('id', versionId)
        .single()

    if (versionFetchError || !version) {
        return { success: false, error: 'Resume version not found' }
    }

    const versionRecord = version as unknown as {
        id: string
        resume_id: string
        resumes: { user_id: string; active_version_id: string | null }
    }

    if (versionRecord.resumes.user_id !== userId) {
        return { success: false, error: 'Unauthorized: version does not belong to you' }
    }

    const resumeId = versionRecord.resume_id
    const previousActiveVersionId = versionRecord.resumes.active_version_id

    // Capture EXACT previous is_active state for all versions of this resume
    const { data: allVersions, error: allVersionsFetchError } = await supabase
        .from('resume_versions')
        .select('id, is_active')
        .eq('resume_id', resumeId)

    if (allVersionsFetchError) {
        console.error('[setActiveVersion] Failed to fetch all versions for snapshot:', allVersionsFetchError.message)
        return { success: false, error: 'Failed to switch active version' }
    }

    const versionSnapshot = (allVersions ?? []) as { id: string; is_active: boolean }[]

    // Helper: restore every version's is_active and the resume's active_version_id
    async function restoreAllVersionStates(): Promise<void> {
        for (const vs of versionSnapshot) {
            const { error: e } = await supabase
                .from('resume_versions')
                .update({ is_active: vs.is_active })
                .eq('id', vs.id)
            if (e) {
                console.error(`[setActiveVersion] Rollback: failed to restore version ${vs.id} is_active=${vs.is_active}:`, e.message)
            }
        }
        const { error: e } = await supabase
            .from('resumes')
            .update({ active_version_id: previousActiveVersionId })
            .eq('id', resumeId)
        if (e) {
            console.error('[setActiveVersion] Rollback: failed to restore active_version_id:', e.message)
        }
    }

    // 1. Deactivate all versions for this resume
    const { error: deactivateError } = await supabase
        .from('resume_versions')
        .update({ is_active: false })
        .eq('resume_id', resumeId)

    if (deactivateError) {
        console.error('[setActiveVersion] Deactivate all error:', deactivateError.message)
        return { success: false, error: 'Failed to switch active version' }
    }

    // 2. Activate the selected version
    const { error: activateError } = await supabase
        .from('resume_versions')
        .update({ is_active: true })
        .eq('id', versionId)

    if (activateError) {
        console.error('[setActiveVersion] Activate version error:', activateError.message)
        // Restore all versions to their exact previous states (handles null previousActiveVersionId correctly)
        await restoreAllVersionStates()
        return { success: false, error: 'Failed to activate version' }
    }

    // 3. Update resumes.active_version_id
    const { error: activeVersionError } = await supabase
        .from('resumes')
        .update({ active_version_id: versionId })
        .eq('id', resumeId)

    if (activeVersionError) {
        console.error('[setActiveVersion] Update active_version_id error:', activeVersionError.message)
        // Restore all versions to their exact previous states
        await restoreAllVersionStates()
        return { success: false, error: 'Failed to update active version pointer' }
    }

    revalidatePath('/profile')
    return { success: true }
}

// ── Delete Resume Version ───────────────────────────────────────────────────

export async function deleteResumeVersion(versionId: string): Promise<{
    success: boolean
    error?: string
}> {
    const supabase = await createClient()
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
        return { success: false, error: 'Unauthorized' }
    }
    const userId = authData.user.id

    // Fetch the version and verify ownership via parent resume
    const { data: version, error: fetchError } = await supabase
        .from('resume_versions')
        .select('*, resumes!inner(user_id, active_version_id)')
        .eq('id', versionId)
        .single()

    if (fetchError || !version) {
        return { success: false, error: 'Resume version not found' }
    }

    const versionRecord = version as unknown as {
        id: string
        resume_id: string
        file_path: string
        file_name: string
        file_type: 'pdf' | 'docx'
        file_size: number | null
        version_label: string | null
        is_active: boolean
        uploaded_at: string
        created_at: string
        resumes: { user_id: string; active_version_id: string | null }
    }

    if (versionRecord.resumes.user_id !== userId) {
        return { success: false, error: 'Unauthorized: version does not belong to you' }
    }

    const {
        file_path: filePath,
        resume_id: resumeId,
        is_active: isActive,
    } = versionRecord

    const previousActiveVersionId = versionRecord.resumes.active_version_id

    // ── Active-version deletion: pre-determine replacement BEFORE deleting ──
    let replacementVersionId: string | null = null

    if (isActive) {
        // Fetch all OTHER versions (candidates for replacement) before any mutation
        const { data: remaining, error: remainingFetchError } = await supabase
            .from('resume_versions')
            .select('id, is_active')
            .eq('resume_id', resumeId)
            .neq('id', versionId)
            .order('created_at', { ascending: false })

        if (remainingFetchError) {
            console.error('[deleteResumeVersion] Failed to fetch remaining versions before deletion:', remainingFetchError.message)
            return { success: false, error: 'Failed to determine replacement version. Please try again.' }
        }

        // Capture is_active state of remaining versions for potential rollback
        const remainingVersionStates = (remaining ?? []) as { id: string; is_active: boolean }[]
        replacementVersionId = remainingVersionStates.length > 0 ? remainingVersionStates[0].id : null

        // Capture the complete deleted version data for exact re-insertion if needed
        const capturedVersionData = {
            id: versionRecord.id,
            resume_id: versionRecord.resume_id,
            file_path: versionRecord.file_path,
            file_name: versionRecord.file_name,
            file_type: versionRecord.file_type,
            file_size: versionRecord.file_size,
            version_label: versionRecord.version_label,
            is_active: true, // it was active
            uploaded_at: versionRecord.uploaded_at,
            created_at: versionRecord.created_at,
        }

        // Helper: restore remaining versions' is_active state
        async function restoreRemainingVersionStates(): Promise<void> {
            for (const vs of remainingVersionStates) {
                const { error: e } = await supabase
                    .from('resume_versions')
                    .update({ is_active: vs.is_active })
                    .eq('id', vs.id)
                if (e) {
                    console.error(`[deleteResumeVersion] Rollback: failed to restore version ${vs.id} is_active=${vs.is_active}:`, e.message)
                }
            }
        }

        // Helper: restore active_version_id on the resume
        async function restoreActiveVersionId(targetId: string | null): Promise<void> {
            const { error: e } = await supabase
                .from('resumes')
                .update({ active_version_id: targetId })
                .eq('id', resumeId)
            if (e) {
                console.error('[deleteResumeVersion] Rollback: failed to restore active_version_id:', e.message)
            }
        }

        // Delete the version DB record FIRST (before storage)
        const { error: deleteError } = await supabase
            .from('resume_versions')
            .delete()
            .eq('id', versionId)

        if (deleteError) {
            console.error('[deleteResumeVersion] Version record delete error:', deleteError.message)
            // No DB state changed at this point — safe to return directly
            return { success: false, error: 'Failed to delete version' }
        }

        // Version is now deleted. Proceed to update state for replacement.
        if (replacementVersionId) {
            // Activate the replacement version
            const { error: activateErr } = await supabase
                .from('resume_versions')
                .update({ is_active: true })
                .eq('id', replacementVersionId)

            if (activateErr) {
                console.error('[deleteResumeVersion] Failed to activate replacement version:', activateErr.message)
                // DB version is already deleted — attempt to re-insert it
                const { data: reinserted, error: reinsertErr } = await supabase
                    .from('resume_versions')
                    .insert(capturedVersionData)
                    .select()
                    .single()
                if (reinsertErr || !reinserted) {
                    console.error('[deleteResumeVersion] Rollback: failed to re-insert deleted version — state may be inconsistent:', reinsertErr?.message)
                } else {
                    // Re-insert succeeded — restore active_version_id using captured previous indicator
                    await restoreActiveVersionId(previousActiveVersionId)
                    await restoreRemainingVersionStates()
                }
                // NOTE: If re-insertion fails, state remains inconsistent (no active version).
                // This is a known non-transactional limitation of sequential Supabase operations.
                return { success: false, error: 'Version deleted but failed to activate replacement. Please reload.' }
            }

            // Update resumes.active_version_id to the replacement
            const { error: activeVersionErr } = await supabase
                .from('resumes')
                .update({ active_version_id: replacementVersionId })
                .eq('id', resumeId)

            if (activeVersionErr) {
                console.error('[deleteResumeVersion] Failed to update active_version_id after delete:', activeVersionErr.message)
                // Deactivate replacement; attempt to re-insert deleted version
                const { error: deactivateReplacementErr } = await supabase
                    .from('resume_versions')
                    .update({ is_active: false })
                    .eq('id', replacementVersionId)
                if (deactivateReplacementErr) {
                    console.error('[deleteResumeVersion] Rollback: failed to deactivate replacement version:', deactivateReplacementErr.message)
                }
                const { data: reinserted, error: reinsertErr } = await supabase
                    .from('resume_versions')
                    .insert(capturedVersionData)
                    .select()
                    .single()
                if (reinsertErr || !reinserted) {
                    console.error('[deleteResumeVersion] Rollback: failed to re-insert deleted version — state may be inconsistent:', reinsertErr?.message)
                } else {
                    await restoreActiveVersionId(previousActiveVersionId)
                    await restoreRemainingVersionStates()
                }
                return { success: false, error: 'Version deleted but failed to update active pointer. Please reload.' }
            }
        } else {
            // No versions remain — clear active_version_id
            const { error: clearActiveErr } = await supabase
                .from('resumes')
                .update({ active_version_id: null })
                .eq('id', resumeId)

            if (clearActiveErr) {
                console.error('[deleteResumeVersion] Failed to clear active_version_id:', clearActiveErr.message)
                // Attempt re-insert of deleted version to restore consistent state
                const { data: reinserted, error: reinsertErr } = await supabase
                    .from('resume_versions')
                    .insert(capturedVersionData)
                    .select()
                    .single()
                if (reinsertErr || !reinserted) {
                    console.error('[deleteResumeVersion] Rollback: failed to re-insert deleted version — state may be inconsistent:', reinsertErr?.message)
                } else {
                    await restoreActiveVersionId(previousActiveVersionId)
                }
                return { success: false, error: 'Version deleted but failed to clear active pointer. Please reload.' }
            }
        }

        // Finalise storage deletion only after DB state is successfully finalised
        const { error: storageError } = await supabase.storage.from('resumes').remove([filePath])
        if (storageError) {
            // Unavoidable non-transactional limitation: DB is clean, but file is orphaned. Log it.
            console.error('[deleteResumeVersion] DB finalized but orphaned storage file removal failed:', storageError.message)
        }

    } else {
        // ── Non-active version: simpler delete path ─────────────────────────
        const { error: deleteError } = await supabase
            .from('resume_versions')
            .delete()
            .eq('id', versionId)

        if (deleteError) {
            console.error('[deleteResumeVersion] Version record delete error:', deleteError.message)
            return { success: false, error: 'Failed to delete version' }
        }

        // Finalise storage deletion only after DB state is finalised
        const { error: storageError } = await supabase.storage.from('resumes').remove([filePath])
        if (storageError) {
            console.error('[deleteResumeVersion] DB finalized but orphaned storage file removal failed:', storageError.message)
        }
    }

    // Integrity note: if previousActiveVersionId was pointing to the just-deleted version
    // and there are no remaining versions, it would now be null (handled above).
    // TypeScript constraint: unused variable required by original logic; document here.
    void previousActiveVersionId

    revalidatePath('/profile')
    return { success: true }
}

// ── Get Resume Download URL ─────────────────────────────────────────────────

export async function getResumeDownloadUrl(versionId: string): Promise<{
    success: boolean
    error?: string
    data?: { url: string }
}> {
    const supabase = await createClient()
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
        return { success: false, error: 'Unauthorized' }
    }
    const userId = authData.user.id

    // Fetch the version and verify ownership
    const { data: version, error: fetchError } = await supabase
        .from('resume_versions')
        .select('file_path, resumes!inner(user_id)')
        .eq('id', versionId)
        .single()

    if (fetchError || !version) {
        return { success: false, error: 'Resume version not found' }
    }

    const versionRecord = version as unknown as {
        file_path: string
        resumes: { user_id: string }
    }

    if (versionRecord.resumes.user_id !== userId) {
        return { success: false, error: 'Unauthorized' }
    }

    const { data: signedUrl, error: signedError } = await supabase.storage
        .from('resumes')
        .createSignedUrl(versionRecord.file_path, 60)

    if (signedError || !signedUrl) {
        console.error('[getResumeDownloadUrl] Signed URL error:', signedError?.message)
        return { success: false, error: 'Failed to generate download link' }
    }

    return { success: true, data: { url: signedUrl.signedUrl } }
}
