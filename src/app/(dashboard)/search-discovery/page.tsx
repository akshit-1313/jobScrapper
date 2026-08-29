import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FindJobsButton } from '@/components/profile/find-jobs-button'
import { SearchParametersPanel } from '@/components/discovery/search-parameters-panel'
import { DailyDiscoveryPanel } from '@/components/discovery/daily-discovery-panel'
import { FirecrawlUsagePanel } from '@/components/firecrawl/firecrawl-usage-panel'
import { toSearchParameters } from '@/lib/types/search-parameters'
import { getUsagePanelData } from '@/lib/firecrawl/usage-service'
import { nextDailyRunUtc } from '@/lib/jobs/daily-schedule'

export const metadata = {
    title: 'Search & Discovery',
}

/**
 * Search & Discovery — the single place job discovery is configured and run.
 *
 * Everything here reads and writes EXISTING storage through EXISTING actions:
 * search parameters and job sources are one `candidate_preferences` row saved by
 * `saveSearchParameters`; the daily toggle is `profiles.daily_discovery_enabled`
 * via `setDailyDiscoveryEnabled`; the button calls `findMatchingJobsAction`,
 * which routes to the validated Phase 3 runner. Nothing on this page duplicates
 * a table, an action or a discovery path.
 *
 * Firecrawl usage renders from the stored snapshot only — this page load makes
 * no provider call.
 */
export default async function SearchDiscoveryPage() {
    const supabase = await createClient()
    const { data: authData } = await supabase.auth.getUser()

    if (!authData.user) {
        redirect('/login')
    }

    const [prefsRes, sourcesRes, profileRes, skillsRes] = await Promise.all([
        supabase
            .from('candidate_preferences')
            .select(
                'desired_roles, work_modes, geographic_preferences, remote_search_terms, desired_skills, excluded_skills, excluded_roles, selected_source_ids'
            )
            .eq('user_id', authData.user.id)
            .maybeSingle(),
        // Only globally active sources are offered. The allow-list is applied
        // again server-side at run time, so the UI cannot widen it.
        supabase.from('job_sources').select('id, name').eq('active', true).order('name'),
        supabase
            .from('profiles')
            .select('headline, daily_discovery_enabled, last_daily_discovery_at')
            .eq('user_id', authData.user.id)
            .maybeSingle(),
        supabase
            .from('candidate_skills')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', authData.user.id),
    ])

    const searchParameters = toSearchParameters(prefsRes.data)
    const availableSources = (sourcesRes.data || []) as Array<{ id: string; name: string }>
    const dailyEnabled = profileRes.data?.daily_discovery_enabled === true
    const lastRunAt = profileRes.data?.last_daily_discovery_at ?? null

    // Same precondition the manual button uses: without profile signal there is
    // nothing to build search queries from.
    const hasProfileData = Boolean(profileRes.data?.headline) || (skillsRes.count ?? 0) > 0

    // Stored snapshot only — never calls Firecrawl on render.
    const usage = await getUsagePanelData(dailyEnabled)

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                    Search &amp; Discovery
                </h2>
                <p className="mt-1 text-slate-500">
                    Run a search, choose what to search for, and see what it costs.
                </p>
            </div>

            {/* On small screens the section list is faster than scrolling. */}
            <nav aria-label="Sections" className="flex flex-wrap gap-2 text-sm">
                {[
                    ['#search-parameters', 'Search Parameters'],
                    ['#job-sources', 'Job Sources'],
                    ['#firecrawl-usage', 'Firecrawl Usage'],
                    ['#daily-discovery', 'Daily Job Search'],
                ].map(([href, label]) => (
                    <a
                        key={href}
                        href={href}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                    >
                        {label}
                    </a>
                ))}
            </nav>

            <div className="space-y-6">
                {/* 1. The primary action. */}
                <section id="find-matching-jobs" className="scroll-mt-24">
                    <FindJobsButton hasProfileData={hasProfileData} />
                </section>

                {/* 2 + 3. Search Parameters and Job Sources — two cards, one
                    stored row, one action. */}
                <SearchParametersPanel
                    initialValues={searchParameters}
                    availableSources={availableSources}
                />

                {/* 4. Credit visibility. */}
                <FirecrawlUsagePanel usage={usage} dailyDiscoveryEnabled={dailyEnabled} />

                {/* 5. The scheduled run. Never enabled on the user's behalf. */}
                <DailyDiscoveryPanel
                    initialEnabled={dailyEnabled}
                    hasProfileData={hasProfileData}
                    lastRunAt={lastRunAt}
                    nextRunAt={nextDailyRunUtc().toISOString()}
                />
            </div>

            <p className="text-sm text-slate-500">
                Looking for your resume, skills or experience?{' '}
                <Link href="/profile" className="font-medium text-slate-700 underline">
                    Go to your profile
                </Link>
                .
            </p>
        </div>
    )
}
