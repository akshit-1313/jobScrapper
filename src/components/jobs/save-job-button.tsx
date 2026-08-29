'use client'

import { useState, useTransition } from 'react'
import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createOrUpdateSavedJob, removeSavedJob } from '@/app/actions/saved-jobs-actions'
import type { SavedJobStatusValue } from '@/lib/jobs/job-status'

interface Props {
    jobId: string
    /** Persisted state from the server render. Absent row = not saved. */
    initialSavedStatus: SavedJobStatusValue | null
}

/**
 * Bookmark toggle for a job card.
 *
 * The card is wrapped in a <Link>, so the click must be stopped from
 * navigating. State is held locally for immediate feedback and reverted if the
 * server rejects the write — the button never claims a save that did not land.
 *
 * Reuses the existing saved_jobs actions; it introduces no second bookmark
 * system and does not touch the ignored/archived states owned by the job
 * detail page.
 */
export function SaveJobButton({ jobId, initialSavedStatus }: Props) {
    const [savedStatus, setSavedStatus] = useState<SavedJobStatusValue | null>(initialSavedStatus)
    const [isPending, startTransition] = useTransition()

    const isSaved = savedStatus === 'saved'

    const handleClick = (event: React.MouseEvent) => {
        // Inside a linked card: never navigate, never bubble.
        event.preventDefault()
        event.stopPropagation()
        if (isPending) return

        const previous = savedStatus
        const next: SavedJobStatusValue | null = isSaved ? null : 'saved'
        setSavedStatus(next)

        startTransition(async () => {
            const result = next === 'saved'
                ? await createOrUpdateSavedJob({ jobId, status: 'saved' })
                : await removeSavedJob({ jobId })

            if (!result.success) {
                setSavedStatus(previous)
                toast.error(next === 'saved' ? 'Could not save job' : 'Could not remove job', {
                    description: result.error,
                })
                return
            }

            toast.success(next === 'saved' ? 'Saved for later' : 'Removed from saved')
        })
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={isPending}
            aria-pressed={isSaved}
            aria-label={isSaved ? 'Remove from saved jobs' : 'Save job for later'}
            title={isSaved ? 'Remove from saved' : 'Save for later'}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-wait ${isSaved
                ? 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100'
                : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                }`}
        >
            {isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : isSaved
                    ? <BookmarkCheck className="h-4 w-4" />
                    : <Bookmark className="h-4 w-4" />}
        </button>
    )
}
