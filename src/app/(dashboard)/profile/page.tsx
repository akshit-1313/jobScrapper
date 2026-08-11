import { createClient } from '@/utils/supabase/server'
import { ProfileForm } from '@/components/profile/profile-form'
import { SkillsForm } from '@/components/profile/skills-form'
import { ExperienceForm } from '@/components/profile/experience-form'
import { ResumeSection } from '@/components/resume/resume-section'
import { redirect } from 'next/navigation'
import type { ResumeVersion } from '@/lib/types/resume'

export default async function ProfilePage() {
    const supabase = await createClient()
    const { data: authData } = await supabase.auth.getUser()

    if (!authData.user) {
        redirect('/login')
    }

    // Parallel fetch for speed
    const [profileRes, skillsRes, expRes, resumeRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', authData.user.id).single(),
        supabase.from('candidate_skills').select('*').eq('user_id', authData.user.id),
        supabase.from('candidate_experience').select('*').eq('user_id', authData.user.id),
        supabase.from('resumes').select('*, resume_versions(*)').eq('user_id', authData.user.id).single(),
    ])

    const profileData = profileRes.data || null
    const skillsData = skillsRes.data || []
    const expData = expRes.data || []

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
                {/* Resume section above profile forms */}
                <ResumeSection initialVersions={resumeVersions} />

                <ProfileForm initialData={profileData} />
                <SkillsForm initialSkills={skillsData} />
                <ExperienceForm initialExperience={expData} />
            </div>
        </div>
    )
}
