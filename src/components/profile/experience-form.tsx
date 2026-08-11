'use client'

import { useState } from 'react'
import { CandidateExperience } from '@/lib/types/profile'
import { upsertExperience, deleteExperience } from '@/app/actions/profile-actions'
import { Briefcase, Trash2, Plus, Loader2, Edit3 } from 'lucide-react'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ExperienceSchema, ExperienceFormValues } from '@/lib/types/profile'
import { format } from 'date-fns'

export function ExperienceForm({ initialExperience }: { initialExperience: CandidateExperience[] }) {
    const [experience] = useState<CandidateExperience[]>(initialExperience || [])
    const [isAdding, setIsAdding] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)

    const { register, handleSubmit, reset, watch, formState: { errors }, setValue } = useForm<ExperienceFormValues>({
        resolver: zodResolver(ExperienceSchema),
        defaultValues: { company_name: '', title: '', start_date: '', end_date: '', description: '', is_current: false } as ExperienceFormValues
    })

    const isCurrent = watch('is_current')

    function handleEditContent(exp: CandidateExperience) {
        setEditingId(exp.id!)
        setIsAdding(true)
        setValue('id', exp.id)
        setValue('company_name', exp.company_name)
        setValue('title', exp.title)
        setValue('start_date', exp.start_date)
        setValue('end_date', exp.end_date || '')
        setValue('description', exp.description || '')
        setValue('is_current', exp.is_current)
    }

    function handleAddNew() {
        reset({ company_name: '', title: '', start_date: '', end_date: '', description: '', is_current: false })
        setEditingId(null)
        setIsAdding(true)
    }

    async function onSubmit(data: ExperienceFormValues) {
        setIsSubmitting(true)
        const res = await upsertExperience(data)
        if (res.success) {
            toast.success(editingId ? "Experience updated" : "Experience added")
            setIsAdding(false)
            setEditingId(null)
            window.location.reload()
        } else {
            toast.error(res.error || "Failed to save experience")
        }
        setIsSubmitting(false)
    }

    async function handleDelete(id: string) {
        setDeletingId(id)
        const res = await deleteExperience(id)
        if (res.success) {
            toast.success("Experience removed")
            window.location.reload()
        } else {
            toast.error(res.error || "Failed to delete")
        }
        setDeletingId(null)
    }

    return (
        <div className="glass-panel rounded-xl p-6 md:p-8">
            <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                        <Briefcase className="h-5 w-5" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">Experience</h3>
                </div>
                {!isAdding && (
                    <button
                        onClick={handleAddNew}
                        className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-md transition-colors"
                    >
                        <Plus className="h-4 w-4" /> Add Experience
                    </button>
                )}
            </div>

            {isAdding && (
                <form onSubmit={handleSubmit(onSubmit)} className="bg-slate-50 border border-slate-200 rounded-lg p-5 mb-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-600">Company Name</label>
                            <input
                                {...register('company_name')}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm"
                                placeholder="e.g. Acme Corp"
                            />
                            {errors.company_name && <p className="text-xs text-red-500">{errors.company_name.message}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-600">Title</label>
                            <input
                                {...register('title')}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm"
                                placeholder="e.g. Software Engineer"
                            />
                            {errors.title && <p className="text-xs text-red-500">{errors.title.message}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-600">Start Date</label>
                            <input
                                type="date"
                                {...register('start_date')}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm"
                            />
                            {errors.start_date && <p className="text-xs text-red-500">{errors.start_date.message}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center">
                                <label className="text-xs font-semibold text-slate-600">End Date</label>
                                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-blue-600">
                                    <input type="checkbox" {...register('is_current')} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                    I currently work here
                                </label>
                            </div>
                            <input
                                type="date"
                                {...register('end_date')}
                                disabled={isCurrent || false}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm disabled:bg-slate-100 disabled:opacity-50"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600">Description</label>
                        <textarea
                            {...register('description')}
                            rows={3}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm"
                            placeholder="Describe your responsibilities and achievements..."
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={() => setIsAdding(false)}
                            className="text-sm font-medium text-slate-600 hover:text-slate-800 px-4 py-2"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer"
                        >
                            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                            {editingId ? "Update Experience" : "Save Experience"}
                        </button>
                    </div>
                </form>
            )}

            {experience.length === 0 && !isAdding ? (
                <div className="text-center py-8 text-slate-500 text-sm border-2 border-dashed border-slate-200 rounded-xl">
                    No experience added yet. Add your work history to improve AI matching.
                </div>
            ) : (
                <div className="space-y-4">
                    {!isAdding && experience.sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()).map((exp) => (
                        <div key={exp.id} className="group relative bg-white border border-slate-200 shadow-sm rounded-lg p-5">
                            <div className="absolute top-4 right-4 flex opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                                <button
                                    onClick={() => handleEditContent(exp)}
                                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all cursor-pointer"
                                >
                                    <Edit3 className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={() => handleDelete(exp.id!)}
                                    disabled={deletingId === exp.id}
                                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all cursor-pointer"
                                >
                                    {deletingId === exp.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                </button>
                            </div>

                            <h4 className="text-base font-bold text-slate-900 pr-20">{exp.title}</h4>
                            <div className="text-sm font-semibold text-slate-600">{exp.company_name}</div>
                            <div className="text-xs text-slate-400 font-medium mt-1 mb-3">
                                {format(new Date(exp.start_date), 'MMM yyyy')} - {exp.is_current || !exp.end_date ? 'Present' : format(new Date(exp.end_date), 'MMM yyyy')}
                            </div>
                            <p className="text-sm text-slate-600 whitespace-pre-wrap">{exp.description}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
