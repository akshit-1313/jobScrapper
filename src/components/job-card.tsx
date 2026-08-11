import Link from 'next/link'
import { MapPin, Briefcase, DollarSign, Building } from 'lucide-react'
import { JobWithLocationsAndSkills } from '@/lib/types/jobs'
import { formatDistanceToNow } from 'date-fns'

export function JobCard({ job }: { job: JobWithLocationsAndSkills }) {
    const formatSalary = () => {
        if (!job.salary_min && !job.salary_max) return null

        const formatCurrency = (val: number) => {
            if (val >= 1000000 && job.salary_currency === 'INR') return `₹${(val / 100000).toFixed(1)}L`
            if (val >= 1000) return `${job.salary_currency === 'USD' ? '$' : job.salary_currency}${val / 1000}k`
            return val.toString()
        }

        const min = job.salary_min ? formatCurrency(job.salary_min) : ''
        const max = job.salary_max ? formatCurrency(job.salary_max) : ''

        if (min && max) return `${min} - ${max}`
        return min || max
    }

    const primaryLocation = job.job_locations?.[0]
    const locationDisplay =
        job.work_mode === 'remote' ? (primaryLocation?.remote_region || 'Remote Worldwide') :
            primaryLocation?.city ? `${primaryLocation.city}${primaryLocation.country ? `, ${primaryLocation.country}` : ''}` :
                primaryLocation?.country || 'Location Unknown'

    const salaryDisplay = formatSalary()

    return (
        <Link href={`/jobs/${job.id}`} className="block">
            <div className="glass-panel group relative rounded-xl p-6 transition-all hover:-translate-y-1 hover:shadow-md cursor-pointer">

                {job.match_score !== undefined && (
                    <div className="absolute -top-3 right-6 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1 text-xs font-bold text-white shadow-sm">
                        {job.match_score}% Match
                    </div>
                )}

                <div className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 shadow-sm">
                        <Building className="h-6 w-6" />
                    </div>

                    <div className="flex-1 min-w-0">
                        <h3 className="truncate text-lg font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                            {job.title}
                        </h3>
                        <p className="text-sm font-medium text-slate-600">{job.company_name}</p>

                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
                            <div className="flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5" />
                                <span className="capitalize">{job.work_mode} &bull; {locationDisplay}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Briefcase className="h-3.5 w-3.5" />
                                <span className="capitalize">{job.employment_type.replace('_', ' ')}</span>
                            </div>
                            {salaryDisplay && (
                                <div className="flex items-center gap-1 font-medium text-green-700">
                                    <DollarSign className="h-3.5 w-3.5" />
                                    <span>{salaryDisplay} {job.salary_period ? `/${job.salary_period.charAt(0)}` : ''}</span>
                                </div>
                            )}
                        </div>

                        {job.job_skills && job.job_skills.length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                                {job.job_skills.slice(0, 4).map((skill, idx) => (
                                    <span key={idx} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                        {skill.skill_name}
                                    </span>
                                ))}
                                {job.job_skills.length > 4 && (
                                    <span className="rounded-md bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-400 border border-slate-200">
                                        +{job.job_skills.length - 4} more
                                    </span>
                                )}
                            </div>
                        )}

                        {job.posted_at && (
                            <p className="mt-4 text-xs text-slate-400">
                                Posted {formatDistanceToNow(new Date(job.posted_at), { addSuffix: true })}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </Link>
    )
}
