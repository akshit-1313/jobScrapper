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

/** Deterministically derived skill category. 'other' = present in the resume but unclassified. */
export type SkillCategory =
    | 'language'
    | 'framework'
    | 'library'
    | 'database'
    | 'cloud'
    | 'tool'
    | 'domain'
    | 'other'

export const SKILL_CATEGORIES = [
    'language', 'framework', 'library', 'database', 'cloud', 'tool', 'domain', 'other',
] as const

export interface ParsedSkill {
    skill_name: string
    category: SkillCategory
    proficiency_level: 'beginner' | 'intermediate' | 'advanced' | 'expert' | null
    years_used: number | null
    is_primary: boolean
}

export interface ParsedExperience {
    company_name: string
    title: string
    start_date: string | null
    end_date: string | null
    /** Retained for backward compatibility — the full bullet text, joined. */
    description: string | null
    responsibilities: string[]
    achievements: string[]
    is_current: boolean
    /** Derived from start/end dates. null when dates are absent or unreliable. */
    duration_months: number | null
}

/**
 * A client engagement performed under a parent employer (consultancy/services
 * resumes). Kept distinct from employment so per-client technology and outcome
 * signal is not flattened into the employer's description.
 */
export interface ParsedEngagement {
    client_name: string
    parent_company: string | null
    start_date: string | null
    end_date: string | null
    is_current: boolean
    responsibilities: string[]
    achievements: string[]
    /** Technologies literally present in the engagement text (dictionary-bounded). */
    technologies: string[]
    /** Domain/business-context terms literally present in the engagement text. */
    domains: string[]
    duration_months: number | null
}

export interface ParsedEducation {
    institution: string
    degree: string | null
    field_of_study: string | null
    start_date: string | null
    end_date: string | null
    grade: string | null
}

export interface ParsedCertification {
    name: string
    issuer: string | null
    issue_date: string | null
    expiry_date: string | null
    credential_id: string | null
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
    engagements: ParsedEngagement[]
    education: ParsedEducation[]
    certifications: ParsedCertification[]
    /** Extracted plain text, persisted to resume_versions.raw_text. Never logged. */
    raw_text: string
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
    category: z.enum(SKILL_CATEGORIES).nullable().optional(),
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
    responsibilities: z.array(z.string().max(1000)).optional().default([]),
    achievements: z.array(z.string().max(1000)).optional().default([]),
    is_current: z.boolean().optional().default(false),
})

export const ConfirmEducationSchema = z.object({
    institution: z.string().min(1).max(200),
    degree: z.string().max(200).nullable().optional(),
    field_of_study: z.string().max(200).nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    grade: z.string().max(50).nullable().optional(),
})

export const ConfirmCertificationSchema = z.object({
    name: z.string().min(1).max(200),
    issuer: z.string().max(200).nullable().optional(),
    issue_date: z.string().nullable().optional(),
    expiry_date: z.string().nullable().optional(),
    credential_id: z.string().max(200).nullable().optional(),
})

export const ConfirmEngagementSchema = z.object({
    client_name: z.string().min(1).max(200),
    parent_company: z.string().max(200).nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    is_current: z.boolean().optional().default(false),
    responsibilities: z.array(z.string().max(1000)).optional().default([]),
    achievements: z.array(z.string().max(1000)).optional().default([]),
    technologies: z.array(z.string().max(100)).optional().default([]),
    domains: z.array(z.string().max(100)).optional().default([]),
})

export const ResumeConfirmSchema = z.object({
    profile: ConfirmProfileSchema,
    skills: z.array(ConfirmSkillSchema),
    experience: z.array(ConfirmExperienceSchema),
    engagements: z.array(ConfirmEngagementSchema).optional().default([]),
    education: z.array(ConfirmEducationSchema).optional().default([]),
    certifications: z.array(ConfirmCertificationSchema).optional().default([]),
})

export type ResumeConfirmData = z.infer<typeof ResumeConfirmSchema>

// ── Upload-related constants ────────────────────────────────────────────────

export const ALLOWED_FILE_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const
export const ALLOWED_EXTENSIONS = ['pdf', 'docx'] as const
export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
