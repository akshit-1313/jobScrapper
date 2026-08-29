import { createClient } from '@/utils/supabase/server'
import { ProfileForm } from '@/components/profile/profile-form'
import { SkillsForm } from '@/components/profile/skills-form'
import { ExperienceForm } from '@/components/profile/experience-form'
import { ResumeSection } from '@/components/resume/resume-section'
import { StructuredProfile } from '@/components/profile/structured-profile'
import { FindJobsButton } from '@/components/profile/find-jobs-button'
import { SearchParametersPanel } from '@/components/profile/search-parameters-panel'
import { toSearchParameters } from '@/lib/types/search-parameters'
import { FirecrawlUsagePanel } from '@/components/firecrawl/firecrawl-usage-panel'
import { getUsagePanelData } from '@/lib/firecrawl/usage-service'
import { redirect } from 'next/navigation'
import type { ResumeVersion } from '@/lib/types/resume'

export default async function ProfilePage() {
    const supabase = await createClient()
    const { data: authData } = await supabase.auth.getUser()

    if (!authData.user) {
        redirect('/login')
    }

    // Parallel fetch for speed
    const [profileRes, skillsRes, expRes, resumeRes, engRes, eduRes, certRes, prefsRes, sourcesRes, dailyRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', authData.user.id).single(),
        supabase.from('candidate_skills').select('*').eq('user_id', authData.user.id),
        supabase.from('candidate_experience').select('*').eq('user_id', authData.user.id),
        supabase.from('resumes').select('*, resume_versions(*)').eq('user_id', authData.user.id).single(),
        supabase.from('candidate_engagements').select('*').eq('user_id', authData.user.id).order('start_date', { ascending: false }),
        supabase.from('candidate_education').select('*').eq('user_id', authData.user.id).order('end_date', { ascending: false }),
        supabase.from('candidate_certifications').select('*').eq('user_id', authData.user.id).order('issue_date', { ascending: false }),
        supabase.from('candidate_preferences').select(
            'desired_roles, work_modes, geographic_preferences, remote_search_terms, desired_skills, excluded_skills, excluded_roles, selected_source_ids'
        ).eq('user_id', authData.user.id).maybeSingle(),
        // Only globally active sources are offered. The allow-list is applied
        // again server-side at run time, so the UI cannot widen it.
        supabase.from('job_sources').select('id, name').eq('active', true).order('name'),
        supabase.from('profiles').select('daily_discovery_enabled').eq('user_id', authData.user.id).maybeSingle(),
    ])

    const profileData = profileRes.data || null
    const skillsData = skillsRes.data || []
    const expData = expRes.data || []
    const engagementsData = engRes.data || []
    const educationData = eduRes.data || []
    const certificationsData = certRes.data || []
    const searchParameters = toSearchParameters(prefsRes.data)
    const availableSources = (sourcesRes.data || []) as Array<{ id: string; name: string }>
    const dailyDiscoveryEnabled = dailyRes.data?.daily_discovery_enabled === true
    // Reads the stored snapshot only — never calls Firecrawl on render.
    const usage = await getUsagePanelData(dailyDiscoveryEnabled)

    // Drives whether the manual job search is available — searches are built
    // from this data, so an empty profile has nothing to search with.
    const hasProfileData =
        skillsData.length > 0 || expData.length > 0 || !!profileData?.headline

    // Extract resume versions from the resume record
    const resumeVersions: ResumeVersion[] = resumeRes.data
        ? ((resumeRes.data as Record<string, unknown>).resume_versions as ResumeVersion[] || [])
            .sort((a: ResumeVersion, b: ResumeVersion) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )
        : []

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-12">
            <div>
                <h2 className="text-3xl font-bold tracking-tight text-slate-900">Candidate Profile</h2>
                <p className="text-slate-500 mt-1">Manage your professional details. The AI uses this data to find matches.</p>
            </div>

            <div className="mt-8 space-y-8">
                {/* 1. Upload / confirm resume */}
                <ResumeSection initialVersions={resumeVersions} />

                {/* 2. Structured profile parsed from the resume (read-only) */}
                <StructuredProfile
                    headline={profileData?.headline ?? null}
                    skills={skillsData}
                    experience={expData}
                    engagements={engagementsData}
                    education={educationData}
                    certifications={certificationsData}
                />

                {/* 3. Explicit, user-triggered job search + matching */}
                <FindJobsButton hasProfileData={hasProfileData} />
                <SearchParametersPanel initialValues={searchParameters} availableSources={availableSources} />
                <FirecrawlUsagePanel usage={usage} dailyDiscoveryEnabled={dailyDiscoveryEnabled} />

                {/* Editable forms */}
                <ProfileForm initialData={profileData} />
                <SkillsForm initialSkills={skillsData} />
                <ExperienceForm initialExperience={expData} />
            </div>
        </div>
    )
}
