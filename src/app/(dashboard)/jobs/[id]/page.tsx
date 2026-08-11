import { createClient } from '@/utils/supabase/server'
import { notFound } from 'next/navigation'
import { JobWithLocationsAndSkills, JobMatchRecord } from '@/lib/types/jobs'
import { MapPin, Briefcase, DollarSign, Building, Clock, ArrowLeft, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow, format } from 'date-fns'
import { JobTrackingButtons } from './job-tracking-buttons'
import { JobMatchCard } from './job-match-card'
import type { SavedJobStatus } from '@/lib/types/tracking'

export default async function JobDetailPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params

    const supabase = await createClient()

    const { data: job, error } = await supabase
        .from('jobs')
        .select(`
      *,
      job_locations(city, state, country, remote_region),
      job_skills(skill_name, is_required, proficiency_level)
    `)
        .eq('id', id)
        .single()

    if (error || !job) {
        notFound()
    }

    const { data: { user } } = await supabase.auth.getUser()

    let initialSavedStatus: SavedJobStatus | null = null
    let initialApplied = false
    let jobMatch: JobMatchRecord | null = null

    if (user) {
        const [{ data: savedJob }, { data: app }, { data: match }] = await Promise.all([
            supabase.from('saved_jobs').select('status').eq('user_id', user.id).eq('job_id', id).maybeSingle(),
            supabase.from('applications').select('status').eq('user_id', user.id).eq('job_id', id).maybeSingle(),
            supabase.from('job_matches').select('*').eq('user_id', user.id).eq('job_id', id).maybeSingle()
        ])
        if (savedJob) initialSavedStatus = savedJob.status as SavedJobStatus
        if (app) initialApplied = true
        if (match) jobMatch = match as JobMatchRecord
    }

    const typedJob = job as JobWithLocationsAndSkills

    const primaryLocation = typedJob.job_locations?.[0]
    const locationDisplay =
        typedJob.work_mode === 'remote' ? (primaryLocation?.remote_region || 'Remote Worldwide') :
            primaryLocation?.city ? `${primaryLocation.city}${primaryLocation.country ? `, ${primaryLocation.country}` : ''}` :
                primaryLocation?.country || 'Location Unknown'

    const formatCurrency = (val: number) => {
        if (val >= 1000000 && typedJob.salary_currency === 'INR') return `₹${(val / 100000).toFixed(1)}L`
        if (val >= 1000) return `${typedJob.salary_currency === 'USD' ? '$' : typedJob.salary_currency}${val / 1000}k`
        return val.toString()
    }

    // Removed mock match score to align with exact strict engine boundaries
    return (
        <div className="max-w-4xl mx-auto pb-20">
            <Link href="/jobs" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 mb-6 transition-colors">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Jobs
            </Link>

            <div className="glass-panel overflow-hidden rounded-2xl bg-white shadow-sm border border-slate-200">
                {/* Header Section */}
                <div className="border-b border-slate-100 p-8 sm:p-10 relative overflow-hidden">
                    {/* Decorative background element */}
                    <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
                        <Building className="w-64 h-64 text-blue-900" />
                    </div>

                    <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm">
                                    <Building className="h-7 w-7" />
                                </div>
                                <div>
                                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">{typedJob.title}</h1>
                                    <p className="text-lg font-medium text-slate-600 mt-1">{typedJob.company_name}</p>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-600 mt-6">
                                <div className="flex items-center gap-2">
                                    <MapPin className="h-4 w-4 text-slate-400" />
                                    <span className="capitalize font-medium">{typedJob.work_mode} &bull; {locationDisplay}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Briefcase className="h-4 w-4 text-slate-400" />
                                    <span className="capitalize font-medium">{typedJob.employment_type.replace('_', ' ')}</span>
                                </div>
                                {(typedJob.salary_min || typedJob.salary_max) && (
                                    <div className="flex items-center gap-2 text-green-700">
                                        <DollarSign className="h-4 w-4" />
                                        <span className="font-medium">
                                            {typedJob.salary_min ? formatCurrency(typedJob.salary_min) : ''}
                                            {typedJob.salary_min && typedJob.salary_max ? ' - ' : ''}
                                            {typedJob.salary_max ? formatCurrency(typedJob.salary_max) : ''}
                                            {typedJob.salary_period ? ` / ${typedJob.salary_period}` : ''}
                                        </span>
                                    </div>
                                )}
                                {typedJob.posted_at && (
                                    <div className="flex items-center gap-2">
                                        <Clock className="h-4 w-4 text-slate-400" />
                                        <span className="font-medium">Posted {formatDistanceToNow(new Date(typedJob.posted_at), { addSuffix: true })}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <JobTrackingButtons
                            jobId={typedJob.id}
                            jobUrl={typedJob.job_url || ''}
                            initialSavedStatus={initialSavedStatus}
                            initialApplied={initialApplied}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">

                    {/* Main Content */}
                    <div className="lg:col-span-2 p-8 sm:p-10">
                        <h2 className="text-xl font-bold tracking-tight text-slate-900 mb-6">About the Role</h2>
                        <div
                            className="prose prose-slate max-w-none text-slate-600 whitespace-pre-wrap leading-relaxed"
                        >
                            {typedJob.description}
                        </div>
                    </div>

                    {/* Sidebar / Match Details */}
                    <div className="bg-slate-50/50 p-8 sm:p-10">
                        {user && <JobMatchCard jobId={id} initialMatch={jobMatch} />}
                        {/* Native Skills Engine isolated above AI constraints */}                        {/* Skills Required */}
                        {typedJob.job_skills && typedJob.job_skills.length > 0 && (
                            <div className="mb-8">
                                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Required Skills</h3>
                                <div className="flex flex-wrap gap-2">
                                    {typedJob.job_skills.map((skill, idx) => (
                                        <span
                                            key={idx}
                                            className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ${skill.is_required
                                                ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-700/10'
                                                : 'bg-slate-100 text-slate-600'
                                                }`}
                                        >
                                            {skill.skill_name}
                                            {skill.is_required && <span className="ml-1 text-blue-400">*</span>}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Job Metadata */}
                        <div>
                            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Job Details</h3>
                            <ul className="space-y-3 text-sm">
                                {(typedJob.experience_min || typedJob.experience_max) && (
                                    <li className="flex justify-between border-b border-slate-100 pb-2">
                                        <span className="text-slate-500 font-medium">Experience</span>
                                        <span className="text-slate-900 font-medium">
                                            {typedJob.experience_min || 0} - {typedJob.experience_max || '+'} years
                                        </span>
                                    </li>
                                )}
                                {typedJob.company_domain && (
                                    <li className="flex justify-between border-b border-slate-100 pb-2">
                                        <span className="text-slate-500 font-medium">Company</span>
                                        <a href={typedJob.company_domain.startsWith('http') ? typedJob.company_domain : `https://${typedJob.company_domain}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium flex items-center">
                                            {typedJob.company_domain} <ExternalLink className="ml-1 h-3 w-3" />
                                        </a>
                                    </li>
                                )}
                                {typedJob.visa_sponsorship && typedJob.visa_sponsorship !== 'unknown' && (
                                    <li className="flex justify-between border-b border-slate-100 pb-2">
                                        <span className="text-slate-500 font-medium">Visa Sponsorship</span>
                                        <span className="text-slate-900 font-medium capitalize">{typedJob.visa_sponsorship}</span>
                                    </li>
                                )}
                                {typedJob.relocation_support && typedJob.relocation_support !== 'unknown' && (
                                    <li className="flex justify-between pb-2">
                                        <span className="text-slate-500 font-medium">Relocation</span>
                                        <span className="text-slate-900 font-medium capitalize">{typedJob.relocation_support}</span>
                                    </li>
                                )}
                            </ul>

                            <div className="mt-6 pt-6 border-t border-slate-200 text-xs text-slate-400">
                                Job ID: {typedJob.canonical_id || typedJob.id}
                                <br />
                                Found on the platform since {format(new Date(typedJob.discovered_at), 'MMM d, yyyy')}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    )
}
