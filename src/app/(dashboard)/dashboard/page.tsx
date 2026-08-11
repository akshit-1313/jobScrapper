import { createClient } from '@/utils/supabase/server'
import { JobCard } from '@/components/job-card'
import { JobWithLocationsAndSkills } from '@/lib/types/jobs'
import { Bookmark, Briefcase, TrendingUp, User } from 'lucide-react'
import Link from 'next/link'

export default async function DashboardPage() {
    const supabase = await createClient()

    // 1. Get total jobs
    const { count: totalJobs } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })

    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);
    const { count: newJobsCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .gte('discovered_at', yesterday.toISOString());

    // 2. We don't have user metrics seeded (saved_jobs, apps) so we'll 0 them correctly
    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id || '00000000-0000-0000-0000-000000000000'

    const { count: savedCount } = await supabase
        .from('saved_jobs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'saved')

    const { count: appCount } = await supabase
        .from('applications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)

    // 3. Get top "matches" (just recent jobs sorted by ID since matching isn't seeded)
    const { data: recentJobs } = await supabase
        .from('jobs')
        .select(`
      *,
      job_locations(city, state, country, remote_region),
      job_skills(skill_name, is_required)
    `)
        .order('posted_at', { ascending: false })
        .limit(4)

    const displayJobs = (recentJobs || []) as JobWithLocationsAndSkills[];

    return (
        <div className="space-y-8 pb-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard</h2>
                    <p className="text-slate-500 mt-1">Overview of your job search and tracking.</p>
                </div>

                <Link href="/profile" className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                    <User className="h-4 w-4" />
                    Update Profile
                </Link>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Metrics Cards */}
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm relative overflow-hidden">
                    <div className="absolute right-0 top-0 opacity-5 -translate-y-4 translate-x-4">
                        <Briefcase className="w-32 h-32 text-blue-600" />
                    </div>
                    <div className="flex items-center gap-3 text-sm font-medium text-slate-500 mb-2">
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                            <Briefcase className="h-4 w-4" />
                        </div>
                        Total Platform Jobs
                    </div>
                    <div className="text-3xl font-bold text-slate-900">{totalJobs || 0}</div>
                    <p className="text-xs text-slate-400 mt-2 font-medium">
                        Discovered and actively tracked
                    </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm relative overflow-hidden group">
                    <div className="absolute right-0 top-0 opacity-5 group-hover:scale-110 transition-transform -translate-y-4 translate-x-4">
                        <Briefcase className="w-32 h-32 text-indigo-600" />
                    </div>
                    <div className="flex items-center gap-3 text-sm font-medium text-slate-500 mb-2">
                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                            <Briefcase className="h-4 w-4" />
                        </div>
                        Total New Jobs
                    </div>
                    <div className="text-3xl font-bold text-slate-900">{newJobsCount || 0}</div>
                    <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                        Added to dashboard recently
                    </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm relative overflow-hidden hover:border-slate-300 transition-colors cursor-pointer">
                    <Link href="/saved" className="absolute inset-0 z-10"></Link>
                    <div className="flex items-center gap-3 text-sm font-medium text-slate-500 mb-2">
                        <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                            <Bookmark className="h-4 w-4" />
                        </div>
                        Saved Jobs
                    </div>
                    <div className="text-3xl font-bold text-slate-900">{savedCount || 0}</div>
                    <p className="text-xs text-slate-500 mt-2">
                        Jobs you are tracking
                    </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm relative overflow-hidden hover:border-slate-300 transition-colors cursor-pointer">
                    <Link href="/applications" className="absolute inset-0 z-10"></Link>
                    <div className="flex items-center gap-3 text-sm font-medium text-slate-500 mb-2">
                        <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                            <Briefcase className="h-4 w-4" />
                        </div>
                        Applications
                    </div>
                    <div className="text-3xl font-bold text-slate-900">{appCount || 0}</div>
                    <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                        Active pipeline
                    </p>
                </div>
            </div>

            <div className="pt-4">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        Recently Discovered Jobs
                    </h3>
                    <Link href="/jobs" className="text-sm font-medium text-blue-600 hover:text-blue-700">
                        View all jobs &rarr;
                    </Link>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
                    {displayJobs.map(job => (
                        <JobCard key={job.id} job={job} />
                    ))}
                </div>
            </div>
        </div>
    )
}
