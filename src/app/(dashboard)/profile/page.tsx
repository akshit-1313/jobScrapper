import { createClient } from '@/utils/supabase/server'
import { ProfileForm } from '@/components/profile/profile-form'
import { SkillsForm } from '@/components/profile/skills-form'
import { ExperienceForm } from '@/components/profile/experience-form'
import { ResumeSection } from '@/components/resume/resume-section'
import { StructuredProfile } from '@/components/profile/structured-profile'
import { FindJobsButton } from '@/components/profile/find-jobs-button'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { ResumeVersion } from '@/lib/types/resume'

export default async function ProfilePage() {
    const supabase = await createClient()
    const { data: authData } = await supabase.auth.getUser()

    if (!authData.user) {
        redirect('/login')
    }

    // Parallel fetch for speed
    const [profileRes, skillsRes, expRes, resumeRes, engRes, eduRes, certRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', authData.user.id).single(),
        supabase.from('candidate_skills').select('*').eq('user_id', authData.user.id),
        supabase.from('candidate_experience').select('*').eq('user_id', authData.user.id),
        supabase.from('resumes').select('*, resume_versions(*)').eq('user_id', authData.user.id).single(),
        supabase.from('candidate_engagements').select('*').eq('user_id', authData.user.id).order('start_date', { ascending: false }),
        supabase.from('candidate_education').select('*').eq('user_id', authData.user.id).order('end_date', { ascending: false }),
        supabase.from('candidate_certifications').select('*').eq('user_id', authData.user.id).order('issue_date', { ascending: false }),
    ])

    const profileData = profileRes.data || null
    const skillsData = skillsRes.data || []
    const expData = expRes.data || []
    const engagementsData = engRes.data || []
    const educationData = eduRes.data || []
    const certificationsData = certRes.data || []

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

                {/* 3. Explicit, user-triggered job search + matching. The entry
                    point stays here; everything that CONFIGURES it now lives on
                    Search & Discovery, so this page keeps one job. */}
                <FindJobsButton hasProfileData={hasProfileData} />

                <Link
                    href="/search-discovery"
                    className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:bg-slate-50"
                >
                    <span>
                        <span className="block font-semibold text-slate-900">Search &amp; Discovery</span>
                        <span className="mt-0.5 block text-sm text-slate-500">
                            Search parameters, job sources, Firecrawl usage and the daily search.
                        </span>
                    </span>
                    <ArrowRight className="h-5 w-5 shrink-0 text-slate-400" />
                </Link>

                {/* Editable forms */}
                <ProfileForm initialData={profileData} />
                <SkillsForm initialSkills={skillsData} />
                <ExperienceForm initialExperience={expData} />
            </div>
        </div>
    )
}
