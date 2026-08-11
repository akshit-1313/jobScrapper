import { z } from 'zod'

// ── Resume Version (matches resume_versions table) ──────────────────────────

export interface ResumeVersion {
    id: string
    resume_id: string
    file_path: string
    file_name: string
    file_type: 'pdf' | 'docx'
    file_size: number | null
    version_label: string | null
    is_active: boolean
    uploaded_at: string
    created_at: string
}

// ── Resume record (matches resumes table) ───────────────────────────────────

export interface ResumeRecord {
    id: string
    user_id: string
    active_version_id: string | null
    created_at: string
    updated_at: string
}

// ── Parsed data types ───────────────────────────────────────────────────────

export interface ParsedSkill {
    skill_name: string
    proficiency_level: 'beginner' | 'intermediate' | 'advanced' | 'expert' | null
    years_used: number | null
    is_primary: boolean
}

export interface ParsedExperience {
    company_name: string
    title: string
    start_date: string | null
    end_date: string | null
    description: string | null
    is_current: boolean
}

export interface ParsedProfileData {
    name: string | null
    headline: string | null
    professional_summary: string | null
    years_of_experience: number | null
    current_location: string | null
    linkedin_url: string | null
    github_url: string | null
    portfolio_url: string | null
}

export interface ParsedResumeData {
    profile: ParsedProfileData
    skills: ParsedSkill[]
    experience: ParsedExperience[]
}

// ── Zod schemas for confirmation validation ─────────────────────────────────

export const ConfirmProfileSchema = z.object({
    name: z.string().min(1).max(100),
    headline: z.string().max(200).nullable().optional(),
    professional_summary: z.string().max(5000).nullable().optional(),
    years_of_experience: z.number().min(0).max(50).nullable().optional(),
    current_location: z.string().max(100).nullable().optional(),
    linkedin_url: z.string().url().nullable().optional().or(z.literal('')).or(z.literal(null)),
    github_url: z.string().url().nullable().optional().or(z.literal('')).or(z.literal(null)),
    portfolio_url: z.string().url().nullable().optional().or(z.literal('')).or(z.literal(null)),
})

export const ConfirmSkillSchema = z.object({
    skill_name: z.string().min(1).max(100),
    proficiency_level: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).nullable().optional(),
    years_used: z.number().min(0).max(50).nullable().optional(),
    is_primary: z.boolean().optional().default(false),
})

export const ConfirmExperienceSchema = z.object({
    company_name: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    description: z.string().max(3000).nullable().optional(),
    is_current: z.boolean().optional().default(false),
})

export const ResumeConfirmSchema = z.object({
    profile: ConfirmProfileSchema,
    skills: z.array(ConfirmSkillSchema),
    experience: z.array(ConfirmExperienceSchema),
})

export type ResumeConfirmData = z.infer<typeof ResumeConfirmSchema>

// ── Upload-related constants ────────────────────────────────────────────────

export const ALLOWED_FILE_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const
export const ALLOWED_EXTENSIONS = ['pdf', 'docx'] as const
export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
