'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Filter, Briefcase, MapPin, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { FormEvent, useState, useTransition } from 'react';
import { triggerDiscoveryAction } from '@/app/actions/discovery-actions';
import { toast } from 'sonner';

export function JobSearchFilters() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Common
    const [q, setQ] = useState(searchParams.get('q') || '');
    const [workMode, setWorkMode] = useState(searchParams.get('work_mode') || '');
    const [employmentType, setEmploymentType] = useState(searchParams.get('employment_type') || '');
    const [sort, setSort] = useState(searchParams.get('sort') || 'relevance');

    // Advanced
    const [country, setCountry] = useState(searchParams.get('country') || '');
    const [city, setCity] = useState(searchParams.get('city') || '');
    const [company, setCompany] = useState(searchParams.get('company') || '');
    const [sourceId, setSourceId] = useState(searchParams.get('source_id') || '');
    const [experienceMin, setExperienceMin] = useState(searchParams.get('experience_min') || '');
    const [experienceMax, setExperienceMax] = useState(searchParams.get('experience_max') || '');
    const [salaryMin, setSalaryMin] = useState(searchParams.get('salary_min') || '');
    const [visaSponsorship, setVisaSponsorship] = useState(searchParams.get('visa_sponsorship') || '');
    const [postedAfter, setPostedAfter] = useState(searchParams.get('posted_after') || '');
    const [skills, setSkills] = useState(searchParams.get('skills') || '');

    const handleSearch = (e: FormEvent) => {
        e.preventDefault();
        const params = new URLSearchParams(searchParams.toString());

        // Base mapping
        if (q) params.set('q', q); else params.delete('q');
        if (workMode) params.set('work_mode', workMode); else params.delete('work_mode');
        if (employmentType) params.set('employment_type', employmentType); else params.delete('employment_type');
        if (sort && sort !== 'relevance') params.set('sort', sort); else params.delete('sort');

        // Advanced mapping exactly matching schema limits
        if (country) params.set('country', country); else params.delete('country');
        if (city) params.set('city', city); else params.delete('city');
        if (company) params.set('company', company); else params.delete('company');
        if (sourceId) params.set('source_id', sourceId); else params.delete('source_id');
        if (experienceMin) params.set('experience_min', experienceMin); else params.delete('experience_min');
        if (experienceMax) params.set('experience_max', experienceMax); else params.delete('experience_max');
        if (salaryMin) params.set('salary_min', salaryMin); else params.delete('salary_min');
        if (visaSponsorship) params.set('visa_sponsorship', visaSponsorship); else params.delete('visa_sponsorship');
        if (postedAfter) params.set('posted_after', postedAfter); else params.delete('posted_after');
        if (skills) params.set('skills', skills); else params.delete('skills');

        startTransition(() => {
            router.push(`/jobs?${params.toString()}`);
        });
    };

    const handleRunDiscovery = async () => {
        setIsDiscovering(true);
        toast.info("Discovery initiated. This crawl operation runs sequentially securely...");
        const res = await triggerDiscoveryAction();
        setIsDiscovering(false);
        if (res.success) {
            toast.success("Discovery Synced correctly.", { description: "See Dashboard metrics for raw extraction rates." });
        } else {
            toast.error("Discovery error", { description: res.error });
        }
    };

    return (
        <form onSubmit={handleSearch} className="glass-panel p-4 rounded-xl shadow-sm mb-6 flex flex-col gap-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex gap-3 w-full">
                    <div className="relative flex-1 md:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                        <input
                            type="text"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search roles or technologies..."
                            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
                    <button
                        type="submit"
                        disabled={isPending}
                        className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm disabled:opacity-50 transition-colors"
                    >
                        {isPending ? 'Searching...' : 'Apply Filters'}
                    </button>

                    <button
                        type="button"
                        onClick={handleRunDiscovery}
                        disabled={isDiscovering}
                        className="flex items-center gap-2 px-3 py-2.5 bg-slate-900 border border-slate-900 rounded-lg text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                        title="Run bounded discovery manually"
                    >
                        <RefreshCw className={`h-4 w-4 ${isDiscovering ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline">Sync Now</span>
                    </button>
                </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-slate-100 pt-4">
                <div className="flex flex-wrap gap-3">
                    <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus-within:ring-2 ring-blue-500">
                        <MapPin className="w-4 h-4 text-slate-400 mr-2" />
                        <select value={workMode} onChange={(e) => setWorkMode(e.target.value)} className="bg-transparent text-sm font-medium text-slate-700 focus:outline-none appearance-none flex-1 py-1">
                            <option value="">Any Work Mode</option>
                            <option value="remote">Remote</option>
                            <option value="hybrid">Hybrid</option>
                            <option value="office">In Office</option>
                        </select>
                    </div>

                    <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus-within:ring-2 ring-blue-500">
                        <Briefcase className="w-4 h-4 text-slate-400 mr-2" />
                        <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className="bg-transparent text-sm font-medium text-slate-700 focus:outline-none appearance-none flex-1 py-1">
                            <option value="">Any Employment Type</option>
                            <option value="full_time">Full Time</option>
                            <option value="part_time">Part Time</option>
                            <option value="contract">Contract</option>
                            <option value="freelance">Freelance</option>
                            <option value="internship">Internship</option>
                        </select>
                    </div>

                    <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus-within:ring-2 ring-blue-500">
                        <Filter className="w-4 h-4 text-slate-400 mr-2" />
                        <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-transparent text-sm font-medium text-slate-700 focus:outline-none appearance-none flex-1 py-1">
                            <option value="relevance">Best Match</option>
                            <option value="newest">Newest First</option>
                            <option value="recently_discovered">Recently Discovered</option>
                            <option value="salary_high">Highest Salary</option>
                        </select>
                    </div>

                    <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors ml-auto">
                        {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
                        {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                </div>

                {showAdvanced && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500">Country</label>
                            <input type="text" value={country} onChange={e => setCountry(e.target.value)} placeholder="e.g. US, India" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500">City</label>
                            <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. San Francisco" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500">Company</label>
                            <input type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder="Company Name" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500">Experience Min (Years)</label>
                            <input type="number" min="0" value={experienceMin} onChange={e => setExperienceMin(e.target.value)} placeholder="Min Years" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500">Experience Max (Years)</label>
                            <input type="number" min="0" value={experienceMax} onChange={e => setExperienceMax(e.target.value)} placeholder="Max Years" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500">Salary Range Minimum</label>
                            <input type="number" min="0" value={salaryMin} onChange={e => setSalaryMin(e.target.value)} placeholder="Minimum Salary" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500">Skills Required (Comma separated)</label>
                            <input type="text" value={skills} onChange={e => setSkills(e.target.value)} placeholder="e.g. React, Node.js" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500">Posted After</label>
                            <input type="datetime-local" value={postedAfter} onChange={e => setPostedAfter(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500">Visa Sponsorship</label>
                            <select value={visaSponsorship} onChange={(e) => setVisaSponsorship(e.target.value)} className="bg-slate-50 px-3 py-2 border border-slate-200 text-sm font-medium text-slate-700 focus:outline-none rounded-lg focus:ring-2 focus:ring-blue-500">
                                <option value="">Any</option>
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500">Source ID Filter</label>
                            <input type="text" value={sourceId} onChange={e => setSourceId(e.target.value)} placeholder="Source UUID (Optional)" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                    </div>
                )}
            </div>
        </form>
    );
}
