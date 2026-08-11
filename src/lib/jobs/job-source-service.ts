import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { JobSource } from './job-source-types';

/**
 * Service for interacting with Job Sources.
 * 
 * Note on RLS (Row Level Security):
 * The database strictly enforces that 'job_sources' is readable by any authenticated user 
 * but does NOT grant any INSERT, UPDATE, or DELETE privileges to 'authenticated' users. 
 * Therefore, modifications must be performed by a service-role (admin) client explicitly.
 */

export async function getJobSources(): Promise<JobSource[]> {
    const supabase = await createClient();

    // RLS allows authenticated users to read job sources
    const { data, error } = await supabase
        .from('job_sources')
        .select('*')
        .order('priority', { ascending: true });

    if (error) {
        throw new Error(`Failed to fetch job sources: ${error.message}`);
    }

    return data as JobSource[];
}

export async function getActiveJobSources(): Promise<JobSource[]> {
    const supabase = await createClient();

    const { data, error } = await supabase
        .from('job_sources')
        .select('*')
        .eq('active', true)
        .order('priority', { ascending: true });

    if (error) {
        throw new Error(`Failed to fetch active job sources: ${error.message}`);
    }

    return data as JobSource[];
}

/**
 * System-level operations below require a Service Role client.
 * Using a user-bound client will fail due to RLS policies.
 */
export async function createJobSourceBase(
    sourceData: {
        name: string;
        domain?: string;
        source_type: string;
        base_url?: string;
        priority?: number;
    }
): Promise<JobSource> {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
        .from('job_sources')
        .insert(sourceData)
        .select()
        .single();

    if (error) {
        throw new Error(`Failed to create job source: ${error.message}`);
    }

    return data as JobSource;
}
