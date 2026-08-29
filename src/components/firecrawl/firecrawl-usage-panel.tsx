'use client'

import { useState, useTransition } from 'react'
import { Gauge, RefreshCw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { refreshFirecrawlUsage } from '@/app/actions/usage-actions'
import { formatRange, type UsageSummary } from '@/lib/firecrawl/usage-model'

interface Props {
    usage: UsageSummary
    /** Shown in the Daily Discovery block; comes from profiles. */
    dailyDiscoveryEnabled: boolean
}

function formatUtc(iso: string | null): string {
    if (!iso) return 'Never'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? 'Unknown' : `${d.toUTCString().replace('GMT', 'UTC')}`
}

function Estimated() {
    return (
        <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Estimated
        </span>
    )
}

/**
 * Firecrawl usage and forecast.
 *
 * Renders entirely from the stored snapshot — it never calls the provider. The
 * provider is contacted only when the user presses Refresh, after a manual run,
 * or after a cron run, because whether the balance endpoint costs credits or
 * counts against the request limit is not established.
 *
 * Actual and estimated are kept visually distinct: only the provider block is
 * unlabelled, and every derived figure carries an Estimated tag.
 */
export function FirecrawlUsagePanel({ usage, dailyDiscoveryEnabled }: Props) {
    const [isPending, startTransition] = useTransition()
    const [refreshed, setRefreshed] = useState(false)

    const handleRefresh = () => {
        if (isPending) return
        startTransition(async () => {
            const result = await refreshFirecrawlUsage()
            if (!result.success) {
                toast.error('Usage not refreshed', { description: result.error })
                return
            }
            setRefreshed(true)
            toast.success('Firecrawl usage refreshed')
        })
    }

    const a = usage.actual

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                        <Gauge className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-slate-900">Firecrawl Usage</h3>
                        <p className="mt-1 max-w-xl text-sm text-slate-500">
                            Job discovery spends Firecrawl credits. Figures below the provider block are
                            forecasts, not billing.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={isPending}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                >
                    <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* ── Actual: the only unlabelled block ── */}
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Actual — reported by Firecrawl
                </p>

                {a ? (
                    <>
                        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                            <div>
                                <dt className="text-slate-500">Remaining</dt>
                                <dd className="text-lg font-semibold text-slate-900">{a.remainingCredits}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Used</dt>
                                <dd className="text-lg font-semibold text-slate-900">
                                    {usage.usedCredits ?? '—'}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Plan credits</dt>
                                <dd className="text-lg font-semibold text-slate-900">
                                    {a.planCredits ?? '—'}
                                </dd>
                            </div>
                        </dl>

                        {(a.billingPeriodStart || a.billingPeriodEnd) && (
                            <p className="mt-3 text-xs text-slate-500">
                                Billing period: {formatUtc(a.billingPeriodStart)} → {formatUtc(a.billingPeriodEnd)}
                            </p>
                        )}

                        <p className="mt-1 text-xs text-slate-500">
                            Last refreshed: {formatUtc(a.fetchedAt)}
                            {refreshed && ' · just now'}
                        </p>

                        {usage.stale && (
                            <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                This balance may be out of date. Press Refresh for the current figure.
                            </p>
                        )}
                    </>
                ) : (
                    <p className="mt-2 text-sm text-slate-600">
                        No balance recorded yet. Press <strong>Refresh</strong> to fetch it once —
                        nothing is shown here until Firecrawl has actually reported a figure.
                    </p>
                )}
            </div>

            {/* ── Daily discovery forecast ── */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Daily Discovery
                    </p>
                    <dl className="mt-3 space-y-1.5 text-sm">
                        <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Status</dt>
                            <dd className={dailyDiscoveryEnabled ? 'font-medium text-emerald-700' : 'text-slate-600'}>
                                {dailyDiscoveryEnabled ? 'On' : 'Off'}
                            </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Schedule</dt>
                            <dd className="text-slate-800">04:00 UTC</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Per run<Estimated /></dt>
                            <dd className="text-slate-800">{formatRange(usage.perRun)}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Runs left this period<Estimated /></dt>
                            <dd className="text-slate-800">{usage.runsRemaining}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Cron reserve<Estimated /></dt>
                            <dd className="text-slate-800">{formatRange(usage.cronReserve)}</dd>
                        </div>
                    </dl>
                </div>

                {/* ── Manual discovery forecast ── */}
                <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Manual Discovery
                    </p>
                    <dl className="mt-3 space-y-1.5 text-sm">
                        <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Safe budget<Estimated /></dt>
                            <dd className="font-medium text-slate-900">
                                {a ? formatRange(usage.manualAvailable) : '—'}
                            </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Safety reserve<Estimated /></dt>
                            <dd className="text-slate-800">{usage.safetyReserve}</dd>
                        </div>
                    </dl>
                    <p className="mt-3 text-xs text-slate-500">
                        Remaining, minus the credits the scheduled runs are expected to need, minus the
                        safety reserve.
                    </p>
                </div>
            </div>

            <p className="mt-4 text-xs text-slate-500">
                Recorded run costs cover <strong>extraction only</strong> — Firecrawl does not report
                per-search credits, so a run costs somewhat more than the ledger shows. Forecasts use
                ranges rather than a single figure for that reason.
            </p>
        </div>
    )
}
