'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { findMatchingJobsAction } from '@/app/actions/discovery-actions'
import { formatDiscoverySummary } from '@/lib/jobs/discovery-summary'

interface Props {
    /** False when the profile has no data to build search queries from. */
    hasProfileData: boolean
}

interface ActionResult {
    success: boolean
    error?: string
    queries?: string[]
    pagesScraped?: number
    /** Matches actually written by M6. Not inferred from the call succeeding. */
    matchesPersisted?: number
}

/**
 * Explicit user-triggered job search.
 *
 * Deliberately NOT run on mount, on render, or on any schedule: this action
 * spends Firecrawl credits, so it fires only on a click. The button is disabled
 * while running so a single click cannot become several concurrent runs.
 */
export function FindJobsButton({ hasProfileData }: Props) {
    const router = useRouter()
    const [isPending, startTransition] = useTransition()
    const [result, setResult] = useState<ActionResult | null>(null)

    const handleClick = () => {
        if (isPending) return
        setResult(null)

        startTransition(async () => {
            const res = await findMatchingJobsAction()
            setResult(res)
            if (res.success) router.refresh()
        })
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h3 className="font-semibold text-slate-900">Find matching jobs</h3>
                    <p className="text-sm text-slate-500 mt-1 max-w-xl">
                        Builds targeted searches from your profile, discovers jobs on approved job
                        boards, and ranks them against your skills and experience.
                    </p>
                    <p className="text-xs text-slate-400 mt-2">
                        Runs only when you click. Limited to 4 job pages per search.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={handleClick}
                    disabled={isPending || !hasProfileData}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                    {isPending
                        ? <><Loader2 size={16} className="animate-spin" /> Searching…</>
                        : <><Search size={16} /> Find matching jobs</>}
                </button>
            </div>

            {!hasProfileData && (
                <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Upload and confirm a resume first — searches are built from your profile.
                </p>
            )}

            {result?.success && (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <p className="text-sm text-emerald-800 flex items-center gap-2">
                        <CheckCircle2 size={16} />
                        {formatDiscoverySummary(result.pagesScraped ?? 0, result.matchesPersisted ?? 0)}
                    </p>
                    {result.queries && result.queries.length > 0 && (
                        <ul className="mt-2 space-y-1">
                            {result.queries.map((q, i) => (
                                <li key={i} className="text-xs text-emerald-700 font-mono">{q}</li>
                            ))}
                        </ul>
                    )}
                    <a href="/jobs" className="mt-2 inline-block text-sm font-medium text-emerald-800 underline">
                        View matched jobs →
                    </a>
                </div>
            )}

            {result && !result.success && (
                <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                    <AlertCircle size={16} />
                    {result.error ?? 'Job search failed.'}
                </p>
            )}
        </div>
    )
}
