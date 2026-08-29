import { z } from "zod";

// Profile Validation Schema
export const ProfileSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    headline: z.string().max(200).nullable().optional(),
    professional_summary: z.string().max(2000).nullable().optional(),
    years_of_experience: z.number().min(0).max(50).nullable().optional(),
    current_location: z.string().max(100).nullable().optional(),
    linkedin_url: z.string().url("Must be a valid URL").nullable().optional().or(z.literal('')),
    github_url: z.string().url("Must be a valid URL").nullable().optional().or(z.literal('')),
    portfolio_url: z.string().url("Must be a valid URL").nullable().optional().or(z.literal('')),
});

export type ProfileFormValues = z.infer<typeof ProfileSchema>;

export type Profile = ProfileFormValues & {
    id: string;
    user_id: string;
    created_at: string;
    updated_at: string;
};

// Skills Schema
export const SkillSchema = z.object({
    id: z.string().optional(),
    skill_name: z.string().min(1, "Skill name is required").max(100),
    proficiency_level: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).nullable().optional(),
    years_used: z.number().min(0).max(50).nullable().optional(),
    is_primary: z.boolean().nullable().optional(),
});

export type SkillFormValues = z.infer<typeof SkillSchema>;
export type CandidateSkill = SkillFormValues & {
    id: string;
    user_id: string;
    created_at?: string;
    updated_at?: string;
};

// Experience Schema
export const ExperienceSchema = z.object({
    id: z.string().optional(),
    company_name: z.string().min(1, "Company name is required").max(200),
    title: z.string().min(1, "Title is required").max(200),
    start_date: z.string().min(1, "Start date is required"),
    end_date: z.string().nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    is_current: z.boolean().nullable().optional(),
});

export type ExperienceFormValues = z.infer<typeof ExperienceSchema>;
export type CandidateExperience = ExperienceFormValues & {
    id: string;
    user_id: string;
    created_at?: string;
    updated_at?: string;
};

// Preferences Schema
export const PreferencesSchema = z.object({
    // Search-intent fields. Edited on /profile (Search Parameters), NOT here —
    // /preferences keeps only the matching constraints below. They stay on the
    // schema because they are columns of the same candidate_preferences row.
    work_modes: z.array(z.string()).nullable().optional(),
    remote_search_terms: z.array(z.string()).nullable().optional(),
    geographic_preferences: z.array(z.string()).nullable().optional(),
    desired_roles: z.array(z.string()).nullable().optional(),
    excluded_roles: z.array(z.string()).nullable().optional(),
    desired_skills: z.array(z.string()).nullable().optional(),
    excluded_skills: z.array(z.string()).nullable().optional(),
    salary_min: z.number().nullable().optional(),
    salary_max: z.number().nullable().optional(),
    salary_currency: z.string().nullable().optional(),
    employment_type: z.enum(['full_time', 'part_time', 'contract', 'freelance', 'internship', 'any']).nullable().optional(),
    visa_sponsorship_pref: z.enum(['required', 'preferred', 'not_needed', 'any']).nullable().optional(),
    relocation_pref: z.enum(['willing', 'not_willing', 'open', 'any']).nullable().optional(),
    experience_min: z.number().min(0).nullable().optional(),
    experience_max: z.number().min(0).nullable().optional(),
});

export type PreferencesFormValues = z.infer<typeof PreferencesSchema>;
export type CandidatePreferences = PreferencesFormValues & {
    id: string;
    user_id: string;
    created_at?: string;
    updated_at?: string;
};
