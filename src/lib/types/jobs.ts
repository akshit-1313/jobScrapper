import { z } from "zod";

export const JobSchema = z.object({
    id: z.string().uuid(),
    canonical_id: z.string().nullable().optional(),
    title: z.string(),
    company_name: z.string(),
    company_domain: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    employment_type: z.enum(['full_time', 'part_time', 'contract', 'freelance', 'internship', 'unknown']),
    experience_min: z.number().nullable().optional(),
    experience_max: z.number().nullable().optional(),
    salary_min: z.number().nullable().optional(),
    salary_max: z.number().nullable().optional(),
    salary_currency: z.string().nullable().optional(),
    salary_period: z.enum(['hourly', 'monthly', 'yearly']).nullable().optional(),
    work_mode: z.enum(['remote', 'hybrid', 'office', 'unknown']),
    remote_scope: z.string().nullable().optional(),
    visa_sponsorship: z.enum(['yes', 'no', 'unknown']).nullable().optional(),
    relocation_support: z.enum(['yes', 'no', 'unknown']).nullable().optional(),
    job_url: z.string().url().nullable().optional(),
    posted_at: z.string().nullable().optional(),
    discovered_at: z.string(),
    status: z.enum(['discovered', 'active', 'stale', 'expired', 'closed', 'archived']),
});

export type Job = z.infer<typeof JobSchema>;

export type JobWithLocationsAndSkills = Job & {
    job_locations: { city: string | null; state: string | null; country: string | null; remote_region: string | null }[];
    job_skills: { skill_name: string; is_required: boolean }[];
    match_score?: number; // Optional on the domain model since it's joined from job_matches
};

export type JobMatchRecord = {
    id: string;
    user_id: string;
    job_id: string;
    overall_score: number;
    skills_score: number;
    experience_score: number;
    role_score: number;
    location_score: number;
    work_mode_score: number;
    seniority_score: number;
    emp_type_score: number;
    matching_skills: string[];
    missing_required_skills: string[];
    missing_preferred_skills: string[];
    positive_reasons: string[];
    concerns: string[];
    recommendation: 'strong_match' | 'good_match' | 'possible_match' | 'weak_match' | 'skip';
    scored_at: string;
};
