'use client'

import { useState } from 'react'
import { confirmParsedProfile } from '@/app/actions/resume-actions'
import type { ParsedResumeData, ParsedSkill, ParsedExperience } from '@/lib/types/resume'
import { CheckCircle, X, Loader2, User, Wrench, Briefcase, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface ParsedProfileReviewProps {
    parsedData: ParsedResumeData
    onConfirmed: () => void
    onDismiss: () => void
}

export function ParsedProfileReview({ parsedData, onConfirmed, onDismiss }: ParsedProfileReviewProps) {
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Editable state initialized from parsed data
    const [profile, setProfile] = useState(parsedData.profile)
    const [skills, setSkills] = useState<ParsedSkill[]>(parsedData.skills)
    const [experience, setExperience] = useState<ParsedExperience[]>(parsedData.experience)

    const handleConfirm = async () => {
        if (!profile.name || profile.name.trim().length === 0) {
            toast.error('Name is required')
            return
        }

        setIsSubmitting(true)
        try {
            const result = await confirmParsedProfile({
                profile: {
                    ...profile,
                    name: profile.name.trim(),
                },
                skills: skills.filter(s => s.skill_name.trim().length > 0),
                experience: experience.filter(e => e.company_name.trim().length > 0 && e.title.trim().length > 0),
            })

            if (result.success) {
                toast.success('Profile updated from resume')
                onConfirmed()
            } else {
                toast.error(result.error || 'Failed to save profile')
            }
        } catch {
            toast.error('An unexpected error occurred')
        } finally {
            setIsSubmitting(false)
        }
    }

    const addSkill = () => {
        setSkills([...skills, { skill_name: '', category: 'other', proficiency_level: null, years_used: null, is_primary: false }])
    }

    const removeSkill = (index: number) => {
        setSkills(skills.filter((_, i) => i !== index))
    }

    const updateSkill = (index: number, field: keyof ParsedSkill, value: string | number | boolean | null) => {
        const updated = [...skills]
        updated[index] = { ...updated[index], [field]: value }
        setSkills(updated)
    }

    const addExperience = () => {
        setExperience([...experience, {
            company_name: '', title: '', start_date: null, end_date: null,
            description: null, responsibilities: [], achievements: [],
            is_current: false, duration_months: null,
        }])
    }

    const removeExperience = (index: number) => {
        setExperience(experience.filter((_, i) => i !== index))
    }

    const updateExperience = (index: number, field: keyof ParsedExperience, value: string | boolean | null) => {
        const updated = [...experience]
        updated[index] = { ...updated[index], [field]: value }
        setExperience(updated)
    }

    const hasData = profile.name || profile.headline || profile.professional_summary ||
        skills.length > 0 || experience.length > 0

    if (!hasData) {
        return (
            <div className="glass-panel rounded-xl p-6 border-l-4 border-amber-400">
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                        <User className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-slate-900">No Data Extracted</h3>
                        <p className="text-sm text-slate-500 mt-1">
                            The parser could not extract structured data from this resume. You can still manage your profile manually below.
                        </p>
                        <button
                            onClick={onDismiss}
                            className="mt-3 text-sm font-medium text-slate-600 hover:text-slate-800 cursor-pointer"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="glass-panel rounded-xl p-6 md:p-8 border-l-4 border-blue-500">
            {/* Header */}
            <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                        <CheckCircle className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-slate-900">Review Parsed Profile</h3>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Review and edit the extracted data before saving to your profile
                        </p>
                    </div>
                </div>
                <button
                    onClick={onDismiss}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                    title="Dismiss"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>

            {/* Profile Section */}
            <div className="space-y-6">
                <div>
                    <div className="flex items-center gap-2 mb-4">
                        <User className="h-4 w-4 text-slate-500" />
                        <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Profile</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500">Full Name *</label>
                            <input
                                value={profile.name || ''}
                                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500">Headline</label>
                            <input
                                value={profile.headline || ''}
                                onChange={(e) => setProfile({ ...profile, headline: e.target.value || null })}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500">Years of Experience</label>
                            <input
                                type="number"
                                value={profile.years_of_experience ?? ''}
                                onChange={(e) => setProfile({ ...profile, years_of_experience: e.target.value ? parseInt(e.target.value) : null })}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500">Location</label>
                            <input
                                value={profile.current_location || ''}
                                onChange={(e) => setProfile({ ...profile, current_location: e.target.value || null })}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                    <div className="mt-4 space-y-1">
                        <label className="text-xs font-medium text-slate-500">Professional Summary</label>
                        <textarea
                            value={profile.professional_summary || ''}
                            onChange={(e) => setProfile({ ...profile, professional_summary: e.target.value || null })}
                            rows={4}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500">LinkedIn URL</label>
                            <input
                                value={profile.linkedin_url || ''}
                                onChange={(e) => setProfile({ ...profile, linkedin_url: e.target.value || null })}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500">GitHub URL</label>
                            <input
                                value={profile.github_url || ''}
                                onChange={(e) => setProfile({ ...profile, github_url: e.target.value || null })}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500">Portfolio URL</label>
                            <input
                                value={profile.portfolio_url || ''}
                                onChange={(e) => setProfile({ ...profile, portfolio_url: e.target.value || null })}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Skills Section */}
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <Wrench className="h-4 w-4 text-slate-500" />
                            <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                                Skills ({skills.length})
                            </h4>
                        </div>
                        <button
                            onClick={addSkill}
                            className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                        >
                            <Plus className="h-3 w-3" /> Add Skill
                        </button>
                    </div>
                    {skills.length > 0 ? (
                        <div className="space-y-2">
                            {skills.map((skill, i) => (
                                <div key={i} className="flex items-center gap-3 bg-slate-50 px-3 py-2 rounded-lg">
                                    <input
                                        value={skill.skill_name}
                                        onChange={(e) => updateSkill(i, 'skill_name', e.target.value)}
                                        placeholder="Skill name"
                                        className="flex-1 px-2 py-1 bg-white border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                    <select
                                        value={skill.proficiency_level || ''}
                                        onChange={(e) => updateSkill(i, 'proficiency_level', e.target.value || null)}
                                        className="px-2 py-1 bg-white border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    >
                                        <option value="">Proficiency</option>
                                        <option value="beginner">Beginner</option>
                                        <option value="intermediate">Intermediate</option>
                                        <option value="advanced">Advanced</option>
                                        <option value="expert">Expert</option>
                                    </select>
                                    <label className="flex items-center gap-1 text-xs text-slate-500">
                                        <input
                                            type="checkbox"
                                            checked={skill.is_primary}
                                            onChange={(e) => updateSkill(i, 'is_primary', e.target.checked)}
                                            className="rounded border-slate-300"
                                        />
                                        Primary
                                    </label>
                                    <button
                                        onClick={() => removeSkill(i)}
                                        className="p-1 text-slate-400 hover:text-red-500 cursor-pointer"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-slate-400 italic">No skills extracted</p>
                    )}
                </div>

                {/* Experience Section */}
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <Briefcase className="h-4 w-4 text-slate-500" />
                            <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                                Experience ({experience.length})
                            </h4>
                        </div>
                        <button
                            onClick={addExperience}
                            className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                        >
                            <Plus className="h-3 w-3" /> Add Experience
                        </button>
                    </div>
                    {experience.length > 0 ? (
                        <div className="space-y-4">
                            {experience.map((exp, i) => (
                                <div key={i} className="bg-slate-50 p-4 rounded-lg space-y-3">
                                    <div className="flex items-start justify-between">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
                                            <div className="space-y-1">
                                                <label className="text-xs font-medium text-slate-500">Title *</label>
                                                <input
                                                    value={exp.title}
                                                    onChange={(e) => updateExperience(i, 'title', e.target.value)}
                                                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs font-medium text-slate-500">Company *</label>
                                                <input
                                                    value={exp.company_name}
                                                    onChange={(e) => updateExperience(i, 'company_name', e.target.value)}
                                                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs font-medium text-slate-500">Start Date</label>
                                                <input
                                                    type="date"
                                                    value={exp.start_date || ''}
                                                    onChange={(e) => updateExperience(i, 'start_date', e.target.value || null)}
                                                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs font-medium text-slate-500">End Date</label>
                                                <input
                                                    type="date"
                                                    value={exp.end_date || ''}
                                                    onChange={(e) => updateExperience(i, 'end_date', e.target.value || null)}
                                                    disabled={exp.is_current}
                                                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeExperience(i)}
                                            className="ml-3 p-1 text-slate-400 hover:text-red-500 cursor-pointer flex-shrink-0"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <label className="flex items-center gap-2 text-xs text-slate-500">
                                        <input
                                            type="checkbox"
                                            checked={exp.is_current}
                                            onChange={(e) => updateExperience(i, 'is_current', e.target.checked)}
                                            className="rounded border-slate-300"
                                        />
                                        Currently working here
                                    </label>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium text-slate-500">Description</label>
                                        <textarea
                                            value={exp.description || ''}
                                            onChange={(e) => updateExperience(i, 'description', e.target.value || null)}
                                            rows={2}
                                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-slate-400 italic">No experience extracted</p>
                    )}
                </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
                <button
                    onClick={onDismiss}
                    className="text-sm font-medium text-slate-500 hover:text-slate-700 cursor-pointer"
                >
                    Skip — I&apos;ll fill in manually
                </button>
                <button
                    onClick={handleConfirm}
                    disabled={isSubmitting}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
                >
                    {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <CheckCircle className="h-4 w-4" />
                    )}
                    Confirm &amp; Save to Profile
                </button>
            </div>
        </div>
    )
}
