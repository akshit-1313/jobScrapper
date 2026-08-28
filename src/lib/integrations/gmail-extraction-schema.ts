import { z } from 'zod';

export const gmailExtractionSchema = z.object({
    event_type: z.enum([
        'interview_scheduled',
        'interview_rescheduled',
        'offer_received',
        'rejection',
        'assessment_request',
        'general_update'
    ]),
    job_info: z.object({
        company_name: z.string().nullable(),
        job_title: z.string().nullable()
    }),
    interview_details: z.object({
        date: z.string().nullable(),
        time: z.string().nullable(),
        timezone: z.string().nullable(),
        meeting_url: z.string().nullable(),
        interviewer: z.string().nullable()
    }).nullable(),
    offer_details: z.object({
        salary: z.string().nullable(),
        joining_date: z.string().nullable()
    }).nullable(),
    confidence_score: z.number().min(0).max(100),
    system_action_required: z.boolean()
}).strict(); // strict() explicitly bars the LLM from inventing fake fields outside the schema

export type GmailExtractionStruct = z.infer<typeof gmailExtractionSchema>;
