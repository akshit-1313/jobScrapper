import { z } from 'zod';

export const SavedJobStatusSchema = z.enum(['saved', 'ignored', 'archived']);
export type SavedJobStatus = z.infer<typeof SavedJobStatusSchema>;

export const ApplicationStatusSchema = z.enum([
    'not_applied', 'interested', 'applied', 'recruiter_contacted',
    'interview', 'technical_round', 'offer', 'rejected', 'withdrawn', 'closed'
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

export const CreateOrUpdateSavedJobSchema = z.object({
    jobId: z.string().uuid(),
    status: SavedJobStatusSchema
});

/** Unsaving carries no status: the row is deleted rather than transitioned. */
export const RemoveSavedJobSchema = z.object({
    jobId: z.string().uuid()
});

export const TrackApplicationSchema = z.object({
    jobId: z.string().uuid()
});
