'use client'

import { useState, useTransition } from 'react'
import { SlidersHorizontal, Plus, X, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { saveSearchParameters } from '@/app/actions/search-parameters-actions'
import {
    WORK_MODE_OPTIONS,
    searchParametersEqual,
    type SearchParametersValues,
    type WorkModeOption,
} from '@/lib/types/search-parameters'

interface Props {
    initialValues: SearchParametersValues
}

const WORK_MODE_LABELS: Record<WorkModeOption, string> = {
    remote: 'Remote',
    hybrid: 'Hybrid',
    office: 'In Office',
}

/** Tag-style editor for one list field. */
function TermList({
    label, hint, placeholder, values, onChange,
}: {
    label: string
    hint: string
    placeholder: string
    values: string[]
    onChange: (next: string[]) => void
}) {
    const [draft, setDraft] = useState('')

    const add = () => {
        const value = draft.trim()
        if (!value) return
        if (values.some(v => v.toLowerCase() === value.toLowerCase())) {
            setDraft('')
            return
        }
        onChange([...values, value])
        setDraft('')
    }

    return (
        <div>
            <label className="text-sm font-medium text-slate-700">{label}</label>
            <p className="text-xs text-slate-500 mt-0.5">{hint}</p>

            <div className="mt-2 flex flex-wrap gap-1.5">
                {values.map(v => (
                    <span key={v} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
                        {v}
                        <button
                            type="button"
                            onClick={() => onChange(values.filter(x => x !== v))}
                            aria-label={`Remove ${v}`}
                            className="text-slate-400 hover:text-slate-700"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}
            </div>

            <div className="mt-2 flex gap-2">
                <input
                    type="text"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); add() }
                    }}
                    placeholder={placeholder}
                    aria-label={label}
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
                <button
                    type="button"
                    onClick={add}
                    aria-label={`Add to ${label}`}
                    className="rounded-lg border border-slate-200 px-2.5 text-slate-500 hover:bg-slate-50"
                >
                    <Plus className="h-4 w-4" />
                </button>
            </div>
        </div>
    )
}

/**
 * Canonical editor for Search Parameters.
 *
 * Profile answers who the user is; this answers what they want to search for.
 * The values are read by BOTH the manual Find Matching Jobs button and the
 * 04:00 UTC scheduled run — there is one stored row and one query builder.
 *
 * Empty fields are meaningful and are never filled in on the user's behalf.
 */
export function SearchParametersPanel({ initialValues }: Props) {
    const [saved, setSaved] = useState<SearchParametersValues>(initialValues)
    const [values, setValues] = useState<SearchParametersValues>(initialValues)
    const [isPending, startTransition] = useTransition()

    const isDirty = !searchParametersEqual(values, saved)

    const set = <K extends keyof SearchParametersValues>(key: K, next: SearchParametersValues[K]) =>
        setValues(prev => ({ ...prev, [key]: next }))

    const toggleMode = (mode: WorkModeOption) => {
        const has = values.work_modes.includes(mode)
        set('work_modes', has ? values.work_modes.filter(m => m !== mode) : [...values.work_modes, mode])
    }

    const handleSave = () => {
        if (isPending) return
        startTransition(async () => {
            const result = await saveSearchParameters(values)
            if (!result.success) {
                toast.error('Could not save search parameters', { description: result.error })
                return
            }
            setSaved(values)
            toast.success('Search parameters saved')
        })
    }

    return (
        <div id="search-parameters" className="scroll-mt-24 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                        <SlidersHorizontal className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-slate-900">Search Parameters</h3>
                        <p className="mt-1 max-w-xl text-sm text-slate-500">
                            What to search for. Your profile supplies skills and experience; these control
                            search intent. Used by both <strong>Find matching jobs</strong> and the daily
                            search.
                        </p>
                    </div>
                </div>

                <span
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${isDirty
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                >
                    {isDirty ? 'Unsaved changes' : <><Check className="h-3 w-3" /> Saved</>}
                </span>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
                <TermList
                    label="Target Roles"
                    hint="Leave empty to use your profile headline and job titles."
                    placeholder="Salesforce Developer"
                    values={values.desired_roles}
                    onChange={v => set('desired_roles', v)}
                />

                <div>
                    <label className="text-sm font-medium text-slate-700">Work Mode</label>
                    <p className="text-xs text-slate-500 mt-0.5">Empty means no work-mode emphasis.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {WORK_MODE_OPTIONS.map(mode => {
                            const active = values.work_modes.includes(mode)
                            return (
                                <button
                                    key={mode}
                                    type="button"
                                    role="switch"
                                    aria-checked={active}
                                    onClick={() => toggleMode(mode)}
                                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${active
                                        ? 'border-slate-900 bg-slate-900 text-white'
                                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                        }`}
                                >
                                    {WORK_MODE_LABELS[mode]}
                                </button>
                            )
                        })}
                    </div>
                </div>

                <TermList
                    label="Geographic Scope"
                    hint={`Empty means no geographic restriction. "Worldwide" also adds no restriction.`}
                    placeholder="Worldwide"
                    values={values.geographic_preferences}
                    onChange={v => set('geographic_preferences', v)}
                />

                <TermList
                    label="Remote Search Terms"
                    hint="Rotated across queries. Empty means no remote wording is added."
                    placeholder="work from anywhere"
                    values={values.remote_search_terms}
                    onChange={v => set('remote_search_terms', v)}
                />

                <TermList
                    label="Additional Keywords"
                    hint="Searched alongside your profile skills."
                    placeholder="Apex"
                    values={values.desired_skills}
                    onChange={v => set('desired_skills', v)}
                />

                <TermList
                    label="Exclude Keywords"
                    hint="Removed from generated queries."
                    placeholder="Java"
                    values={values.excluded_skills}
                    onChange={v => set('excluded_skills', v)}
                />

                <TermList
                    label="Exclude Roles"
                    hint="Titles you never want to see."
                    placeholder="Manager"
                    values={values.excluded_roles}
                    onChange={v => set('excluded_roles', v)}
                />
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={isPending || !isDirty}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                    {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save Search Parameters
                </button>
            </div>
        </div>
    )
}
