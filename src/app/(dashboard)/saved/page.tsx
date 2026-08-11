import { createClient } from '@/utils/supabase/server'
import { JobCard } from '@/components/job-card'
import { JobWithLocationsAndSkills } from '@/lib/types/jobs'
import { BookmarkIcon } from 'lucide-react'
import Link from 'next/link'

export default async function SavedPage({
    searchParams
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return null; // Layout enforces auth natively, safe block
    }

    const awaitedParams = await searchParams;
    let currentTab = typeof awaitedParams.tab === 'string' ? awaitedParams.tab : 'saved';
    if (!['saved', 'archived', 'ignored'].includes(currentTab)) {
        currentTab = 'saved';
    }

    const { data: savedJobs } = await supabase
        .from('saved_jobs')
        .select(`
      job_id,
      status,
      jobs (
        *,
        job_locations(city, state, country, remote_region),
        job_skills(skill_name, is_required, proficiency_level)
      )
    `)
        .eq('user_id', user.id)
        .eq('status', currentTab)

    const parsedJobs = (savedJobs || []).map(sj => sj.jobs) as unknown as JobWithLocationsAndSkills[]

    const [savedR, archivedR, ignoredR] = await Promise.all([
        supabase.from('saved_jobs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'saved'),
        supabase.from('saved_jobs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'archived'),
        supabase.from('saved_jobs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'ignored')
    ])

    const savedCount = savedR.count || 0;
    const archivedCount = archivedR.count || 0;
    const ignoredCount = ignoredR.count || 0;

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight text-slate-900">Saved Jobs</h2>
                <p className="text-slate-500 mt-1">Jobs you&apos;ve bookmarked to review or apply to later.</p>
            </div>

            <div className="border-b border-slate-200">
                <nav className="-mb-px flex gap-6">
                    <Link href="/saved?tab=saved" className={`border-b-2 py-4 px-1 text-sm font-medium transition-colors ${currentTab === 'saved' ? 'border-blue-500 font-bold text-blue-600' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
                        Saved ({savedCount})
                    </Link>
                    <Link href="/saved?tab=archived" className={`border-b-2 py-4 px-1 text-sm font-medium transition-colors ${currentTab === 'archived' ? 'border-blue-500 font-bold text-blue-600' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
                        Archived ({archivedCount})
                    </Link>
                    <Link href="/saved?tab=ignored" className={`border-b-2 py-4 px-1 text-sm font-medium transition-colors ${currentTab === 'ignored' ? 'border-blue-500 font-bold text-blue-600' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
                        Ignored ({ignoredCount})
                    </Link>
                </nav>
            </div>

            {parsedJobs.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-16 text-center shadow-sm">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 mb-4">
                        <BookmarkIcon className="h-6 w-6" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900 mb-1">No saved jobs</h3>
                    <p className="text-slate-500 max-w-sm mx-auto">
                        {currentTab === 'saved' ? 'You haven&apos;t bookmarked any jobs yet. When you see a job you like, click "Save for later".' : `You have no ${currentTab} jobs.`}
                    </p>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                    {parsedJobs.map(job => (
                        <JobCard key={job.id} job={job} />
                    ))}
                </div>
            )}
        </div>
    )
}
