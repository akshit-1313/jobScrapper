'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CandidatePreferences } from '@/lib/types/profile'
import { upsertPreferences } from '@/app/actions/preferences-actions'
import { Save, Settings, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useForm, PathValue } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { PreferencesSchema, PreferencesFormValues } from '@/lib/types/profile'

export function PreferencesForm({ initialData }: { initialData?: CandidatePreferences | null }) {
    const [isSaving, setIsSaving] = useState(false)

    const { register, handleSubmit, formState: { errors }, setValue, watch } = useForm<PreferencesFormValues>({
        resolver: zodResolver(PreferencesSchema),
        defaultValues: {
            salary_min: initialData?.salary_min || undefined,
            salary_max: initialData?.salary_max || undefined,
            salary_currency: initialData?.salary_currency || 'USD',
            employment_type: initialData?.employment_type || 'full_time',
            visa_sponsorship_pref: initialData?.visa_sponsorship_pref || 'not_needed',
            relocation_pref: initialData?.relocation_pref || 'open',
            experience_min: initialData?.experience_min || undefined,
            experience_max: initialData?.experience_max || undefined,
        } as PreferencesFormValues
    })

    async function onSubmit(data: PreferencesFormValues) {
        setIsSaving(true)
        const result = await upsertPreferences(data)
        if (result.success) {
            toast.success("Preferences updated")
        } else {
            toast.error(result.error || "Failed to save preferences")
        }
        setIsSaving(false)
    }

    // Helper for rendering array-to-string fields
    const ArrayInput = ({ label, field, placeholder }: { label: string, field: keyof PreferencesFormValues, placeholder: string }) => {
        const val = (watch(field) as string[]) || []
        return (
            <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">{label} <span className="text-xs font-normal text-slate-400">(Comma separated)</span></label>
                <input
                    type="text"
                    value={val.join(', ')}
                    onChange={(e) => {
                        const arr = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                        setValue(field, arr as PathValue<PreferencesFormValues, typeof field>, { shouldDirty: true })
                    }}
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                    placeholder={placeholder}
                />
            </div>
        )
    }

    return (
        <div className="glass-panel rounded-xl p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                    <Settings className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Job Matching Preferences</h3>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">

                {/* Work Modes (Array of Enum) */}
                <div>
                    <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Work Environment</h4>
                </div>

                {/* Search intent now lives on /profile, which is the canonical editor.
                    Keeping a second set of inputs here would mean two editors writing
                    the same candidate_preferences row. */}
                <div className="pt-2 border-t border-slate-100">
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-sm font-medium text-slate-800">Looking for target roles, work mode or keywords?</p>
                        <p className="mt-1 text-sm text-slate-600">
                            Those are <strong>Search Parameters</strong> — what you want to search for — and
                            they live with your profile.
                        </p>
                        <Link href="/profile#search-parameters" className="mt-2 inline-block text-sm font-medium text-blue-700 underline">
                            Edit Search Parameters on your profile →
                        </Link>
                    </div>
                </div>

                {/* Core Constraints */}
                <div className="pt-2 border-t border-slate-100">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mt-4 mb-4">Core Constraints</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Preferred Employment Type</label>
                            <select
                                {...register('employment_type')}
                                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                            >
                                <option value="any">Any / Open</option>
                                <option value="full_time">Full Time</option>
                                <option value="part_time">Part Time</option>
                                <option value="contract">Contract</option>
                                <option value="freelance">Freelance</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Min Experience (Years)</label>
                            <input
                                type="number"
                                {...register('experience_min', { valueAsNumber: true })}
                                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                                placeholder="0"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Max Experience (Years)</label>
                            <input
                                type="number"
                                {...register('experience_max', { valueAsNumber: true })}
                                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                                placeholder="(Optional) e.g. 15"
                            />
                        </div>
                    </div>
                </div>

                {/* Financials */}
                <div className="pt-2 border-t border-slate-100">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mt-4 mb-4">Expected Compensation</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Minimum Salary</label>
                            <input
                                type="number"
                                {...register('salary_min', { valueAsNumber: true })}
                                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                                placeholder="e.g. 80000"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Maximum Salary</label>
                            <input
                                type="number"
                                {...register('salary_max', { valueAsNumber: true })}
                                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                                placeholder="(Optional) e.g. 150000"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Currency</label>
                            <select
                                {...register('salary_currency')}
                                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                            >
                                <option value="USD">USD ($)</option>
                                <option value="EUR">EUR (€)</option>
                                <option value="GBP">GBP (£)</option>
                                <option value="INR">INR (₹)</option>
                                <option value="CAD">CAD ($)</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Mobility */}
                <div className="pt-2 border-t border-slate-100">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mt-4 mb-4">Mobility & Visas</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Visa Sponsorship</label>
                            <select
                                {...register('visa_sponsorship_pref')}
                                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                            >
                                <option value="any">Open to any</option>
                                <option value="required">Required</option>
                                <option value="preferred">Preferred</option>
                                <option value="not_needed">Not Needed</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Relocation</label>
                            <select
                                {...register('relocation_pref')}
                                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                            >
                                <option value="any">Open to any</option>
                                <option value="willing">Willing to relocate</option>
                                <option value="open">Open to relocation if covered</option>
                                <option value="not_willing">Not willing</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end pt-6">
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
                    >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Preferences
                    </button>
                </div>
            </form>
        </div>
    )
}
