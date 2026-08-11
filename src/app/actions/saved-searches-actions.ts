'use server';

import { createClient } from '@/utils/supabase/server';
import { CreateSavedSearchInput, CreateSavedSearchSchema, SavedSearch, SavedSearchFiltersSchema } from '@/lib/types/saved-search';
import { revalidatePath } from 'next/cache';

export async function createSavedSearch(input: CreateSavedSearchInput) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            throw new Error("Unauthorized: Identity verified failed");
        }

        const parsed = CreateSavedSearchSchema.parse(input);

        // Security boundary: Implicit RLS bound via specific context
        const { data, error } = await supabase
            .from('saved_searches')
            .insert({
                user_id: user.id,
                name: parsed.name,
                filters: parsed.filters,
                is_active: true
            })
            .select('*')
            .single();

        if (error) {
            console.error("Database Error inserting saved search:", error);
            throw new Error("Failed to create saved search");
        }

        revalidatePath('/saved-searches');
        return { success: true, data: data as SavedSearch };
    } catch (err: unknown) {
        console.error("Save Search Action Error:", err);
        return { success: false, error: err instanceof Error ? err.message : "An unexpected error occurred" };
    }
}

export async function getSavedSearches() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) return { success: false, error: "Unauthorized" };

        const { data, error } = await supabase
            .from('saved_searches')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        return { success: true, data: data as SavedSearch[] };
    } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export async function deleteSavedSearch(id: string) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) throw new Error("Unauthorized");

        // Explicit scope boundary locking to ID + Current User mapping natively
        const { error } = await supabase
            .from('saved_searches')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);

        if (error) throw error;

        revalidatePath('/saved-searches');
        return { success: true };
    } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export async function updateSavedSearch(id: string, updates: Partial<CreateSavedSearchInput> & { is_active?: boolean }) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) throw new Error("Unauthorized");


        const payload: Record<string, unknown> = {};
        if (updates.name !== undefined) payload.name = updates.name;
        if (updates.is_active !== undefined) payload.is_active = updates.is_active;
        if (updates.filters !== undefined) {
            payload.filters = SavedSearchFiltersSchema.parse(updates.filters);
        }

        const { error } = await supabase
            .from('saved_searches')
            .update(payload)
            .eq('id', id)
            .eq('user_id', user.id);

        if (error) throw error;

        revalidatePath('/saved-searches');
        return { success: true };
    } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}
