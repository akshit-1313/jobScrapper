'use server'

import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Re-validate Admin inline
async function verifyAdminServer() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('user_id', user.id)
        .single();

    return profile?.is_admin === true;
}

export async function updateM8WorkloadLimits(formData: FormData) {
    const isAdmin = await verifyAdminServer();

    if (!isAdmin) {
        return { success: false, error: 'Unauthorized' };
    }

    const rawSearches = formData.get('searches_per_invoke');
    const rawPages = formData.get('max_pages_per_search');

    // Explicit Validation
    if (rawSearches === null || rawSearches === '' || rawPages === null || rawPages === '') {
        return { success: false, error: 'Invalid configuration: values cannot be empty' };
    }

    const searches = Number(rawSearches);
    const pages = Number(rawPages);

    if (
        !Number.isFinite(searches) || !Number.isInteger(searches) || searches <= 0 ||
        !Number.isFinite(pages) || !Number.isInteger(pages) || pages <= 0
    ) {
        return { success: false, error: 'Invalid configuration: Must be positive integers' };
    }

    // Phase D Administrative Ceilings
    if (pages > 500) {
        return { success: false, error: 'Invalid configuration: Exceeds safe absolute upper bound' };
    }

    if (searches > 50) {
        return { success: false, error: 'Invalid configuration: Searches per invoke exceeds Phase D administrative safety ceiling (50)' };
    }

    const adminClient = createAdminClient();

    // Preserve existing payload identically logically dynamically seamlessly
    const { data: conf, error: fetchErr } = await adminClient.from('m8_system_config').select('value').eq('key', 'WORKLOAD_LIMITS').single();

    if (fetchErr || !conf) {
        console.error('[M8_ADMIN_UPDATE_FAIL] WORKLOAD_LIMITS missing.', fetchErr);
        return { success: false, error: 'Failed to safely commit configuration update' };
    }

    // Ensure we are appending to the exact JSONB payload map, retaining bounds like timeout_seconds natively
    const existingValues = typeof conf.value === 'object' && conf.value !== null ? conf.value : {};

    const updatedValue = {
        ...existingValues,
        searches_per_invoke: searches,
        max_pages_per_search: pages
    };

    const { error: upsertErr } = await adminClient.from('m8_system_config').upsert({
        key: 'WORKLOAD_LIMITS',
        value: updatedValue
    });

    if (upsertErr) {
        console.error('[M8_ADMIN_UPDATE_FAIL]', upsertErr);
        return { success: false, error: 'Failed to safely commit configuration update' };
    }

    return { success: true };
}
