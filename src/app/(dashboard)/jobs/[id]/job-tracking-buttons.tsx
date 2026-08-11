'use client'

import { useState, useTransition } from 'react'
import { Bookmark, BookmarkCheck, ExternalLink, Archive, XCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createOrUpdateSavedJob } from '@/app/actions/saved-jobs-actions'
import { trackApplicationInitiation } from '@/app/actions/applications-actions'
import type { SavedJobStatus } from '@/lib/types/tracking'

interface JobTrackingButtonsProps {
    jobId: string
    jobUrl: string
    initialSavedStatus: SavedJobStatus | null
    initialApplied: boolean
}

export function JobTrackingButtons({ jobId, jobUrl, initialSavedStatus, initialApplied }: JobTrackingButtonsProps) {
    const [savedStatus, setSavedStatus] = useState<SavedJobStatus | null>(initialSavedStatus)
    const [hasApplied, setHasApplied] = useState(initialApplied)
    const [isPending, startTransition] = useTransition()

    const handleApply = async () => {
        if (!jobUrl) {
            toast.error("Application link unavailable")
            return
        }

        // Open synchronously to avoid popup blockers
        const newTab = window.open('about:blank', '_blank')
        if (!newTab) {
            toast.error("Popup blocked! Please allow popups to apply.")
            return
        }

        startTransition(async () => {
            const result = await trackApplicationInitiation({ jobId })
            if (result.success) {
                setHasApplied(true)
                newTab.location.href = jobUrl
                toast.success("Application tracking started", {
                    description: "You have been redirected to the application page."
                })
            } else {
                newTab.close()
                toast.error("Failed to track application", {
                    description: result.error
                })
            }
        })
    }

    const handleUpdateStatus = (status: SavedJobStatus) => {
        startTransition(async () => {
            const result = await createOrUpdateSavedJob({ jobId, status })
            if (result.success) {
                setSavedStatus(status)
                toast.success(`Job marked as ${status}`)
            } else {
                toast.error("Failed to update job status", {
                    description: result.error
                })
            }
        })
    }

    return (
        <div className="flex flex-col gap-3 min-w-[200px]">
            <button
                onClick={handleApply}
                disabled={isPending}
                className={`flex items-center justify-center w-full rounded-xl px-6 py-3.5 text-sm font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${hasApplied
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow'
                    } disabled:opacity-75 disabled:cursor-wait`}
            >
                {isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                ) : (
                    <>
                        {hasApplied ? 'Applied' : 'Apply Now'}
                        {!hasApplied && <ExternalLink className="ml-2 h-4 w-4" />}
                    </>
                )}
            </button>

            <button
                onClick={() => handleUpdateStatus('saved')}
                disabled={isPending || savedStatus === 'saved'}
                className={`flex items-center justify-center w-full rounded-xl border px-6 py-3.5 text-sm font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 disabled:cursor-not-allowed ${savedStatus === 'saved'
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
            >
                {savedStatus === 'saved' ? (
                    <>
                        <BookmarkCheck className="mr-2 h-4 w-4" />
                        Saved for later
                    </>
                ) : (
                    <>
                        <Bookmark className="mr-2 h-4 w-4" />
                        Save for later
                    </>
                )}
            </button>

            {/* Quick Actions for Ignore/Archive */}
            <div className="flex items-center justify-between gap-2 mt-2">
                <button
                    onClick={() => handleUpdateStatus('ignored')}
                    disabled={isPending || savedStatus === 'ignored'}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${savedStatus === 'ignored'
                        ? 'bg-red-50 text-red-700 font-semibold'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                        }`}
                >
                    <XCircle className="h-3.5 w-3.5" />
                    {savedStatus === 'ignored' ? 'Ignored' : 'Ignore'}
                </button>
                <button
                    onClick={() => handleUpdateStatus('archived')}
                    disabled={isPending || savedStatus === 'archived'}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${savedStatus === 'archived'
                        ? 'bg-amber-50 text-amber-700 font-semibold'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                        }`}
                >
                    <Archive className="h-3.5 w-3.5" />
                    {savedStatus === 'archived' ? 'Archived' : 'Archive'}
                </button>
            </div>
        </div>
    )
}
