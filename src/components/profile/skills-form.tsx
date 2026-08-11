'use client'

import { useState } from 'react'
import { CandidateSkill } from '@/lib/types/profile'
import { upsertSkill, deleteSkill } from '@/app/actions/profile-actions'
import { Sparkles, Trash2, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { SkillSchema, SkillFormValues } from '@/lib/types/profile'

export function SkillsForm({ initialSkills }: { initialSkills: CandidateSkill[] }) {
    const [skills] = useState<CandidateSkill[]>(initialSkills || [])
    const [isAdding, setIsAdding] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)

    const { register, handleSubmit, reset, formState: { errors }, setValue } = useForm<SkillFormValues>({
        resolver: zodResolver(SkillSchema),
        defaultValues: { skill_name: '', proficiency_level: 'intermediate', years_used: 1, is_primary: false } as SkillFormValues
    })

    function handleEditContent(skill: CandidateSkill) {
        setEditingId(skill.id!)
        setIsAdding(true)
        setValue('id', skill.id)
        setValue('skill_name', skill.skill_name)
        setValue('proficiency_level', skill.proficiency_level)
        setValue('years_used', skill.years_used)
        setValue('is_primary', skill.is_primary)
    }

    function handleAddNew() {
        reset({ skill_name: '', proficiency_level: 'intermediate', years_used: 1, is_primary: false })
        setEditingId(null)
        setIsAdding(true)
    }

    async function onSubmit(data: SkillFormValues) {
        setIsSubmitting(true)
        const res = await upsertSkill(data)
        if (res.success) {
            toast.success(editingId ? "Skill updated" : "Skill added")
            reset()
            setIsAdding(false)
            setEditingId(null)
            window.location.reload()
        } else {
            toast.error(res.error || "Failed to save skill")
        }
        setIsSubmitting(false)
    }

    async function handleDelete(id: string) {
        setDeletingId(id)
        const res = await deleteSkill(id)
        if (res.success) {
            toast.success("Skill removed")
            window.location.reload()
        } else {
            toast.error(res.error || "Failed to delete skill")
        }
        setDeletingId(null)
    }

    return (
        <div className="glass-panel rounded-xl p-6 md:p-8">
            <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                        <Sparkles className="h-5 w-5" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">Skills</h3>
                </div>
                {!isAdding && (
                    <button
                        onClick={handleAddNew}
                        className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-md transition-colors"
                    >
                        <Plus className="h-4 w-4" /> Add Skill
                    </button>
                )}
            </div>

            {isAdding && (
                <form onSubmit={handleSubmit(onSubmit)} className="bg-slate-50 border border-slate-200 rounded-lg p-5 mb-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-600">Skill Name</label>
                            <input
                                {...register('skill_name')}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm"
                                placeholder="e.g. React"
                            />
                            {errors.skill_name && <p className="text-xs text-red-500">{errors.skill_name.message}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-600">Proficiency</label>
                            <select
                                {...register('proficiency_level')}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm"
                            >
                                <option value="beginner">Beginner</option>
                                <option value="intermediate">Intermediate</option>
                                <option value="advanced">Advanced</option>
                                <option value="expert">Expert</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-600">Years Used</label>
                            <input
                                type="number"
                                {...register('years_used', { valueAsNumber: true })}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm"
                            />
                        </div>
                        <div className="flex items-end pb-1 gap-2">
                            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
                                <input type="checkbox" {...register('is_primary')} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                Primary Skill?
                            </label>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-4">
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
                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer"
                        >
                            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                            {editingId ? "Update Skill" : "Save Skill"}
                        </button>
                    </div>
                </form>
            )}

            {skills.length === 0 && !isAdding ? (
                <div className="text-center py-8 text-slate-500 text-sm border-2 border-dashed border-slate-200 rounded-xl">
                    No skills added yet. Add your skills to improve AI matching.
                </div>
            ) : (
                <div className="flex flex-wrap gap-3">
                    {!isAdding && skills.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)).map((skill) => (
                        <div key={skill.id} className="group relative flex items-center gap-3 bg-white border border-slate-200 shadow-sm rounded-lg pl-3 pr-2 py-2">
                            <div className="cursor-pointer" onClick={() => handleEditContent(skill)}>
                                <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                                    {skill.skill_name}
                                    {skill.is_primary && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full uppercase font-bold">Primary</span>}
                                </div>
                                <div className="text-xs text-slate-500 font-medium capitalize">
                                    {skill.proficiency_level} &bull; {skill.years_used} yrs
                                </div>
                            </div>
                            <button
                                onClick={() => handleDelete(skill.id!)}
                                disabled={deletingId === skill.id}
                                className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all cursor-pointer border-l border-slate-100 ml-1 pl-2"
                            >
                                {deletingId === skill.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
