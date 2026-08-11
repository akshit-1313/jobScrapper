'use server'

import { createClient } from '@/utils/supabase/server'
import { TrackApplicationSchema } from '@/lib/types/tracking'

// Valid Application Statuses
export type ApplicationStatus =
    | 'not_applied' | 'interested' | 'applied' | 'recruiter_contacted'
    | 'interview' | 'technical_round' | 'offer' | 'rejected' | 'withdrawn' | 'closed';


export async function trackApplicationInitiation(input: { jobId: string }) {
    try {
        const supabase = await createClient()

        // 1. Authenticate user strictly
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        const validated = TrackApplicationSchema.safeParse(input)
        if (!validated.success) {
            return { success: false, error: 'Invalid tracking parameters' }
        }

        const { jobId } = validated.data

        // RPC handles atomic lookup + create application + create event gracefully
        const { data, error: rpcError } = await supabase.rpc('track_application_initiation', {
            p_job_id: jobId
        });

        if (rpcError) {
            console.error('Tracking applications insert Error via RPC:', rpcError)
            return { success: false, error: 'Database tracking failed.' }
        }

        return { success: true, data: { id: data } }

    } catch (error) {
        console.error('Tracking Event Error:', error)
        return { success: false, error: 'An unexpected internal error occurred isolating metrics.' }
    }
}

export async function updateApplicationStatus(appId: string, toStatus: ApplicationStatus, notes?: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) return { success: false, error: 'Unauthorized' }

    // RPC inherently checks transitions safely via PGSQL mapped state machine asserting complete atomicity
    const { error: rpcError } = await supabase.rpc('update_application_status', {
        p_app_id: appId,
        p_to_status: toStatus,
        p_notes: notes || null
    });

    if (rpcError) {
        return { success: false, error: rpcError.message };
    }

    return { success: true };
}

export async function updateApplicationDetails(appId: string, details: { follow_up_date?: string | null }) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Unauthorized' }

    // Validates the detail constraints avoiding duplicate event injections
    const { error: updateErr } = await supabase.from('applications')
        .update(details)
        .eq('id', appId)
        .eq('user_id', user.id);

    if (updateErr) return { success: false, error: 'Failed to update application details' };

    return { success: true };
}

export async function getApplications() {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return { success: false, error: 'Unauthorized', data: null }
        }

        const { data, error } = await supabase
            .from('applications')
            .select(`
                id,
                status,
                applied_at,
                updated_at,
                follow_up_date,
                recruiter_name,
                job_id,
                jobs (
                    id,
                    title,
                    company_name,
                    location,
                    work_mode,
                    employment_type
                )
            `)
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false });

        if (error) {
            console.error('Error fetching applications:', error)
            return { success: false, error: 'Failed to fetch applications', data: null }
        }

        return { success: true, data }
    } catch (error) {
        console.error('getApplications Error:', error)
        return { success: false, error: 'An unexpected internal error occurred.', data: null }
    }
}

export async function getApplicationDetails(appId: string) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return { success: false, error: 'Unauthorized', data: null }
        }

        const { data, error } = await supabase
            .from('applications')
            .select(`
                *,
                jobs (*),
                application_events (*)
            `)
            .eq('id', appId)
            .eq('user_id', user.id)
            .order('created_at', { foreignTable: 'application_events', ascending: false })
            .single();

        if (error) {
            console.error('Error fetching application details:', error)
            return { success: false, error: 'Failed to fetch application details', data: null }
        }

        return { success: true, data }
    } catch (error) {
        console.error('getApplicationDetails Error:', error)
        return { success: false, error: 'An unexpected internal error occurred.', data: null }
    }
}
