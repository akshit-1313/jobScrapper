'use client'

import { useState } from 'react'
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
            work_modes: initialData?.work_modes || [],
            geographic_preferences: initialData?.geographic_preferences || [],
            desired_roles: initialData?.desired_roles || [],
            excluded_roles: initialData?.excluded_roles || [],
            desired_skills: initialData?.desired_skills || [],
            excluded_skills: initialData?.excluded_skills || [],
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
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Preferred Work Modes</label>
                        <div className="flex gap-4">
                            {['remote', 'hybrid', 'in_office'].map((mode) => (
                                <label key={mode} className="flex items-center gap-2 text-sm text-slate-700">
                                    <input
                                        type="checkbox"
                                        value={mode}
                                        {...register('work_modes')}
                                        className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                    />
                                    {mode === 'in_office' ? 'In Office' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Arrays mapping */}
                <div className="pt-2 border-t border-slate-100">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mt-4 mb-4">Roles & Targeting</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <ArrayInput label="Desired Roles" field="desired_roles" placeholder="Backend Engineer, Tech Lead..." />
                        <ArrayInput label="Excluded Roles" field="excluded_roles" placeholder="Manager, QA..." />
                        <ArrayInput label="Desired Skills" field="desired_skills" placeholder="TypeScript, Python..." />
                        <ArrayInput label="Excluded Skills" field="excluded_skills" placeholder="Java, PHP..." />
                        <ArrayInput label="Geographic Preferences" field="geographic_preferences" placeholder="New York, London, Remote..." />
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
