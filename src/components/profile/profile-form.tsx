'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ProfileSchema, ProfileFormValues, Profile } from '@/lib/types/profile'
import { upsertProfile } from '@/app/actions/profile-actions'
import { Save, User, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export function ProfileForm({ initialData }: { initialData?: Profile | null }) {
    const [isSaving, setIsSaving] = useState(false)

    const { register, handleSubmit, formState: { errors } } = useForm<ProfileFormValues>({
        resolver: zodResolver(ProfileSchema),
        defaultValues: {
            name: initialData?.name || '',
            headline: initialData?.headline || '',
            professional_summary: initialData?.professional_summary || '',
            years_of_experience: initialData?.years_of_experience || 0,
            current_location: initialData?.current_location || '',
            linkedin_url: initialData?.linkedin_url || '',
            github_url: initialData?.github_url || '',
            portfolio_url: initialData?.portfolio_url || '',
        }
    })

    async function onSubmit(data: ProfileFormValues) {
        setIsSaving(true)
        try {
            const result = await upsertProfile(data)
            if (result.success) {
                toast.success("Profile saved successfully")
            } else {
                toast.error(result.error || "Failed to save profile")
            }
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "An unexpected error occurred")
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="glass-panel rounded-xl p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <User className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Basic Information</h3>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Full Name</label>
                        <input
                            {...register('name')}
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Jane Doe"
                        />
                        {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Headline</label>
                        <input
                            {...register('headline')}
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. Senior Frontend Engineer @ TechCorp"
                        />
                        {errors.headline && <p className="text-xs text-red-500">{errors.headline.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Years of Experience</label>
                        <input
                            type="number"
                            {...register('years_of_experience', { valueAsNumber: true })}
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0"
                        />
                        {errors.years_of_experience && <p className="text-xs text-red-500">{errors.years_of_experience.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Current Location</label>
                        <input
                            {...register('current_location')}
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="San Francisco, CA"
                        />
                        {errors.current_location && <p className="text-xs text-red-500">{errors.current_location.message}</p>}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Professional Summary</label>
                    <textarea
                        {...register('professional_summary')}
                        rows={4}
                        className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="A brief overview of your background and career goals..."
                    />
                    {errors.professional_summary && <p className="text-xs text-red-500">{errors.professional_summary.message}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">LinkedIn URL</label>
                        <input
                            type="url"
                            {...register('linkedin_url')}
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="https://linkedin.com/..."
                        />
                        {errors.linkedin_url && <p className="text-xs text-red-500">{errors.linkedin_url.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">GitHub URL</label>
                        <input
                            type="url"
                            {...register('github_url')}
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="https://github.com/..."
                        />
                        {errors.github_url && <p className="text-xs text-red-500">{errors.github_url.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Portfolio URL</label>
                        <input
                            type="url"
                            {...register('portfolio_url')}
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="https://yourwebsite.com"
                        />
                        {errors.portfolio_url && <p className="text-xs text-red-500">{errors.portfolio_url.message}</p>}
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
                    >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Profile
                    </button>
                </div>
            </form>
        </div>
    )
}
