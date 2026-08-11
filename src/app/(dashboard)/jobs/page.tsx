import { createClient } from '@/utils/supabase/server'
import { JobCard } from '@/components/job-card'
import { JobWithLocationsAndSkills, JobMatchRecord } from '@/lib/types/jobs'
import { JobSearchFilters } from './job-search-filters'
import { SaveSearchButton } from './save-search-button' // Optional button I will add to save searches

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
    const supabase = await createClient()
    const params = await searchParams;

    // Search query parameters translation
    const q = typeof params.q === 'string' ? params.q : ''
    const workMode = typeof params.work_mode === 'string' ? params.work_mode : ''
    const employmentType = typeof params.employment_type === 'string' ? params.employment_type : ''
    const salaryMin = typeof params.salary_min === 'string' ? parseInt(params.salary_min, 10) : NaN
    const sort = typeof params.sort === 'string' ? params.sort : 'newest'

    const country = typeof params.country === 'string' ? params.country : ''
    const city = typeof params.city === 'string' ? params.city : ''
    const company = typeof params.company === 'string' ? params.company : ''
    const sourceId = typeof params.source_id === 'string' ? params.source_id : ''
    const experienceMin = typeof params.experience_min === 'string' ? parseInt(params.experience_min, 10) : NaN
    const experienceMax = typeof params.experience_max === 'string' ? parseInt(params.experience_max, 10) : NaN
    const visaSponsorship = typeof params.visa_sponsorship === 'string' ? params.visa_sponsorship : ''
    const postedAfter = typeof params.posted_after === 'string' ? params.posted_after : ''
    const skillsParam = typeof params.skills === 'string' && params.skills.trim() !== '' ? params.skills.split(',').map(s => s.trim()) : []

    // Build the select dynamically for !inner join necessity
    let selectClause = `
            *,
            job_locations(city, state, country, remote_region),
            job_skills(skill_name, is_required),
            job_matches(overall_score, user_id)
    `;

    if (country || city) {
        selectClause = selectClause.replace('job_locations(', 'job_locations!inner(');
    }
    if (skillsParam.length > 0) {
        selectClause = selectClause.replace('job_skills(', 'job_skills!inner(');
    }
    if (sourceId) {
        selectClause += ', job_source_mappings!inner(source_id)';
    }

    // Build the Supabase PostgREST query natively
    let query = supabase.from('jobs').select(selectClause);

    // Only fetch globally active or discovered jobs strictly!
    query = query.in('status', ['active', 'discovered']);

    // Map Keyword Search
    if (q) {
        // Native TSVECTOR indexing mapping accurately against Postgres limits
        query = query.textSearch('search_vector', q, {
            type: 'websearch',
            config: 'english'
        });
    }

    // Map Exact Enum Filters
    if (workMode) query = query.eq('work_mode', workMode);
    if (employmentType) query = query.eq('employment_type', employmentType);
    if (!isNaN(salaryMin)) query = query.gte('salary_max', salaryMin);
    if (company) query = query.ilike('company_name', `%${company}%`);
    if (!isNaN(experienceMin)) query = query.gte('experience_max', experienceMin);
    if (!isNaN(experienceMax)) query = query.lte('experience_min', experienceMax);
    if (visaSponsorship) query = query.eq('visa_sponsorship', visaSponsorship);
    if (postedAfter) query = query.gte('posted_at', postedAfter);

    // Map Nested Relational Filters smoothly using implicit joined aliases
    if (country) query = query.ilike('job_locations.country', `%${country}%`);
    if (city) query = query.ilike('job_locations.city', `%${city}%`);
    if (skillsParam.length > 0) query = query.in('job_skills.skill_name', skillsParam);
    if (sourceId) query = query.eq('job_source_mappings.source_id', sourceId);

    // Map sorting explicitly explicitly (avoiding AI injections!)
    if (sort === 'newest') {
        query = query.order('posted_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
    } else if (sort === 'recently_discovered') {
        query = query.order('discovered_at', { ascending: false });
    } else if (sort === 'salary_high') {
        // nullsFirst false keeps un-salaried jobs at bottom
        query = query.order('salary_max', { ascending: false, nullsFirst: false });
    } else if (sort === 'match_score') {
        // use computed column 'match_score' on table jobs via postgres function match_score(jobs)
        query = query.order('match_score', { ascending: false, nullsFirst: false });
    }

    // Explicit limits mapping UI
    query = query.limit(30)

    const { data: jobs, error } = await query;

    if (error) {
        console.error('Error fetching jobs:', error)
    }

    // Do NOT generate random fake match scores per strict user requirement. Clean presentation exclusively.
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;

    const displayJobs = (jobs || []).map((j: unknown) => {
        const jobRecord = j as JobWithLocationsAndSkills & { job_matches?: JobMatchRecord[] };
        let match_score = undefined;
        if (jobRecord.job_matches && Array.isArray(jobRecord.job_matches)) {
            // Find match for current user (RLS generally protects this, but check user_id just in case)
            const match = jobRecord.job_matches.find((m: JobMatchRecord) => userId && m.user_id === userId);
            if (match && typeof match.overall_score === 'number') {
                match_score = match.overall_score;
            }
        }
        return {
            ...jobRecord,
            match_score
        };
    }) as unknown as JobWithLocationsAndSkills[];

    return (
        <div className="space-y-8 pb-12">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900">Discover Jobs</h2>
                    <p className="text-slate-500 mt-1">Search the real-time index securely extracted across boundaries.</p>
                </div>
                <div className="flex items-center gap-3">
                    <SaveSearchButton currentFilters={params as Record<string, string>} />
                </div>
            </div>

            <JobSearchFilters />

            {!jobs || displayJobs.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
                    <h3 className="text-lg font-medium text-slate-900 mb-1">No jobs found matches these filters</h3>
                    <p className="text-slate-500">Try broadening your search boundaries or sync discovery to grab fresh candidates.</p>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                    {displayJobs.map(job => (
                        <JobCard key={job.id} job={job} />
                    ))}
                </div>
            )}
        </div>
    )
}
