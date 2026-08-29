'use client'

import { useState, useTransition } from 'react'
import { CalendarClock, Loader2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { setDailyDiscoveryEnabled } from '@/app/actions/daily-discovery-actions'

interface Props {
    initialEnabled: boolean
    /** False when the profile has no data to build search queries from. */
    hasProfileData: boolean
    lastRunAt: string | null
    /** Next 04:00 UTC occurrence, computed on the server so it is not clock-skewed. */
    nextRunAt: string | null
}

/**
 * Opt-in control for the scheduled daily discovery run.
 *
 * Deliberately explicit about what it will and will not do: the run spends
 * Firecrawl credits on the user's behalf without them being present, so the
 * limits are stated on the control rather than buried in documentation.
 */
export function DailyDiscoveryPanel({ initialEnabled, hasProfileData, lastRunAt, nextRunAt }: Props) {
    const [enabled, setEnabled] = useState(initialEnabled)
    const [isPending, startTransition] = useTransition()

    const toggle = () => {
        if (isPending || !hasProfileData) return

        const next = !enabled
        const previous = enabled
        setEnabled(next)

        startTransition(async () => {
            const result = await setDailyDiscoveryEnabled(next)
            if (!result.success) {
                setEnabled(previous)
                toast.error('Could not update daily job search', { description: result.error })
                return
            }
            toast.success(next ? 'Daily job search is on' : 'Daily job search is off')
        })
    }

    return (
        <section id="daily-discovery" className="scroll-mt-24 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                        <CalendarClock className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-slate-900">Daily Job Search</h3>
                        <p className="mt-1 max-w-xl text-sm text-slate-500">
                            Runs the same search as <strong>Find matching jobs</strong>, once a day, without
                            you having to be here. It uses your saved{' '}
                            <a href="#search-parameters" className="underline hover:text-slate-700">
                                search parameters
                            </a>{' '}
                            and{' '}
                            <a href="#job-sources" className="underline hover:text-slate-700">
                                selected job sources
                            </a>
                            {' '}— there is no separate schedule configuration. Off by default.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label="Toggle daily job search"
                    onClick={toggle}
                    disabled={isPending || !hasProfileData}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'bg-emerald-600' : 'bg-slate-300'
                        }`}
                >
                    <span
                        className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                    >
                        {isPending && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
                    </span>
                </button>
            </div>

            <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-slate-100 pt-5 text-sm sm:grid-cols-2">
                <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Schedule</dt>
                    <dd className="mt-0.5 text-slate-700">
                        Once daily at <strong>04:00 UTC</strong>
                        <span className="block text-xs text-slate-500">
                            Times are UTC, not your local timezone. On the Hobby plan the exact minute is
                            approximate.
                        </span>
                    </dd>
                </div>
                <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Next scheduled run</dt>
                    <dd className="mt-0.5 text-slate-700">
                        {enabled
                            ? (nextRunAt ? new Date(nextRunAt).toUTCString() : 'Unknown')
                            : 'Not scheduled — daily search is off'}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Search criteria</dt>
                    <dd className="mt-0.5 text-slate-700">
                        Your profile + saved search parameters
                        <span className="block text-xs text-slate-500">
                            The same queries the manual button builds, from the same stored settings and
                            the same selected job sources.
                        </span>
                    </dd>
                </div>
                <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Coverage per run</dt>
                    <dd className="mt-0.5 text-slate-700">
                        Up to 3 job boards, 4 pages
                        <span className="block text-xs text-slate-500">
                            Boards rotate daily, so different sources are covered across the week.
                        </span>
                    </dd>
                </div>
                <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Last run</dt>
                    <dd className="mt-0.5 text-slate-700">
                        {lastRunAt ? new Date(lastRunAt).toUTCString() : 'Not run yet'}
                    </dd>
                </div>
            </dl>

            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <strong>Hobby plan limit:</strong> functions are capped at 60 seconds, so a run stops
                cleanly once its time budget is spent — realistically one or two job pages per day. It is a
                steady trickle, not a bulk import. Turn it off any time; nothing else changes.
            </p>

            {!hasProfileData && (
                <p className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Upload and confirm a resume first — the daily search is built from your profile.
                </p>
            )}
        </section>
    )
}
