'use client';

import { useState, useTransition } from 'react';
import { Bookmark, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createSavedSearch } from '@/app/actions/saved-searches-actions';
import type { SavedSearchFilters } from '@/lib/types/saved-search';

export function SaveSearchButton({ currentFilters }: { currentFilters: Record<string, string> }) {
    const [isPending, startTransition] = useTransition();
    const [isOpen, setIsOpen] = useState(false);
    const [name, setName] = useState('');

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        // Normalize URL string params exactly as requested by Zod schema without weakening TS checks
        const normalized: SavedSearchFilters = {};

        if (currentFilters.q) normalized.q = currentFilters.q;
        if (currentFilters.country) normalized.country = currentFilters.country;
        if (currentFilters.city) normalized.city = currentFilters.city;
        if (currentFilters.company) normalized.company = currentFilters.company;
        if (currentFilters.source_id) normalized.source_id = currentFilters.source_id;

        if (currentFilters.work_mode) normalized.work_mode = currentFilters.work_mode as SavedSearchFilters['work_mode'];
        if (currentFilters.employment_type) normalized.employment_type = currentFilters.employment_type as SavedSearchFilters['employment_type'];
        if (currentFilters.visa_sponsorship) normalized.visa_sponsorship = currentFilters.visa_sponsorship as SavedSearchFilters['visa_sponsorship'];
        if (currentFilters.sort) normalized.sort = currentFilters.sort as SavedSearchFilters['sort'];

        if (currentFilters.salary_min) normalized.salary_min = parseInt(currentFilters.salary_min, 10);
        if (currentFilters.experience_min) normalized.experience_min = parseInt(currentFilters.experience_min, 10);
        if (currentFilters.experience_max) normalized.experience_max = parseInt(currentFilters.experience_max, 10);

        if (currentFilters.skills && currentFilters.skills.trim()) {
            normalized.skills = currentFilters.skills.split(',').map(s => s.trim());
        }

        if (currentFilters.posted_after) {
            normalized.posted_after = new Date(currentFilters.posted_after).toISOString();
        }

        startTransition(async () => {
            const res = await createSavedSearch({
                name: name.trim(),
                filters: normalized
            });

            if (res.success) {
                toast.success("Search Saved", { description: "You can monitor this via your Saved Searches panel." });
                setIsOpen(false);
                setName('');
            } else {
                toast.error("Failed to save search", { description: res.error });
            }
        });
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
            >
                <Bookmark className="h-4 w-4" />
                <span className="hidden sm:inline">Save Search</span>
            </button>
        );
    }

    return (
        <form onSubmit={handleSave} className="flex items-center gap-2">
            <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Name this search..."
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-48"
                autoFocus
                required
            />
            <button
                type="submit"
                disabled={isPending}
                className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </button>
            <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-slate-500 hover:bg-slate-100 px-2 py-1.5 rounded-md text-sm"
            >
                Cancel
            </button>
        </form>
    );
}
