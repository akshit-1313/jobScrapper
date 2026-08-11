import { z } from "zod";

export const SavedSearchFiltersSchema = z.object({
    q: z.string().optional(),
    country: z.string().optional(),
    city: z.string().optional(),
    work_mode: z.enum(['remote', 'hybrid', 'office', 'unknown']).optional(),
    employment_type: z.enum(['full_time', 'part_time', 'contract', 'freelance', 'internship', 'unknown']).optional(),
    experience_min: z.number().int().optional(),
    experience_max: z.number().int().optional(),
    salary_min: z.number().int().optional(),
    company: z.string().optional(),
    skills: z.array(z.string()).optional(),
    source_id: z.string().uuid().optional(),
    posted_after: z.string().datetime().optional(),
    visa_sponsorship: z.enum(['yes', 'no', 'unknown']).optional(),
    sort: z.enum(['newest', 'recently_discovered', 'salary_high']).optional()
});

export type SavedSearchFilters = z.infer<typeof SavedSearchFiltersSchema>;

export const SavedSearchSchema = z.object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    name: z.string().min(1, "Name is required").max(100),
    filters: SavedSearchFiltersSchema,
    is_active: z.boolean(),
    created_at: z.string(),
    updated_at: z.string()
});

export type SavedSearch = z.infer<typeof SavedSearchSchema>;

export const CreateSavedSearchSchema = SavedSearchSchema.pick({
    name: true,
    filters: true
});

export type CreateSavedSearchInput = z.infer<typeof CreateSavedSearchSchema>;
