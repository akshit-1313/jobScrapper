import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Validate the presence of required environment variables but never expose them to the browser.
// Note: We read the URL directly from the environment.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase URL or Service Role Key is missing from environment variables. Administration features cannot start.');
}

/**
 * Creates an admin Supabase client utilizing the SUPABASE_SERVICE_ROLE_KEY.
 * This client bypasses Row Level Security (RLS) entirely.
 * 
 * REQUIRED USAGE: exclusively for system-level operations (e.g. writing to job_sources 
 * or crawl_runs). 
 * NEVER expose to Client Components or insecure public API routes.
 */
export const createAdminClient = () => {
    return createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        }
    });
};
