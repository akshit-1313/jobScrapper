'use client';

import { SavedSearch } from '@/lib/types/saved-search';
import { deleteSavedSearch, updateSavedSearch } from '@/app/actions/saved-searches-actions';
import { Trash2, Play, Pencil, Bookmark, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function SavedSearchesList({ initialSearches }: { initialSearches: SavedSearch[] }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [editingSearchId, setEditingSearchId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    const handleDelete = (id: string, name: string) => {
        if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

        startTransition(async () => {
            const res = await deleteSavedSearch(id);
            if (res.success) {
                toast.success("Saved search deleted");
            } else {
                toast.error("Deletion failed", { description: res.error });
            }
        });
    }

    const handleRun = (filters: SavedSearch['filters']) => {
        const params = new URLSearchParams();
        if (filters.q) params.set('q', filters.q);
        if (filters.country) params.set('country', filters.country);
        if (filters.city) params.set('city', filters.city);
        if (filters.work_mode) params.set('work_mode', filters.work_mode);
        if (filters.employment_type) params.set('employment_type', filters.employment_type);
        if (filters.salary_min) params.set('salary_min', filters.salary_min.toString());
        if (filters.experience_min) params.set('experience_min', filters.experience_min.toString());
        if (filters.experience_max) params.set('experience_max', filters.experience_max.toString());
        if (filters.company) params.set('company', filters.company);
        if (filters.source_id) params.set('source_id', filters.source_id);
        if (filters.posted_after) params.set('posted_after', filters.posted_after);
        if (filters.visa_sponsorship) params.set('visa_sponsorship', filters.visa_sponsorship);
        if (filters.sort) params.set('sort', filters.sort);
        if (filters.skills && filters.skills.length > 0) params.set('skills', filters.skills.join(','));

        router.push(`/jobs?${params.toString()}`);
    }

    const startEditing = (search: SavedSearch) => {
        setEditingSearchId(search.id);
        setEditName(search.name);
    }

    const handleUpdateName = (id: string) => {
        if (!editName.trim()) return;

        startTransition(async () => {
            const res = await updateSavedSearch(id, { name: editName.trim() });
            if (res.success) {
                toast.success("Saved search updated");
                setEditingSearchId(null);
            } else {
                toast.error("Update failed", { description: res.error });
            }
        });
    }

    return (
        <div className="space-y-4">
            {initialSearches.map((search) => (
                <div key={search.id} className="glass-panel p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex-1 min-w-0">
                            {editingSearchId === search.id ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none flex-1 max-w-sm"
                                        autoFocus
                                    />
                                    <button
                                        onClick={() => handleUpdateName(search.id)}
                                        disabled={isPending}
                                        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                                    >Save</button>
                                    <button
                                        onClick={() => setEditingSearchId(null)}
                                        className="text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-lg text-sm"
                                    >Cancel</button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <Bookmark className="h-5 w-5 text-blue-600 shrink-0" />
                                    <h3 className="text-lg font-bold text-slate-900 truncate pr-4">{search.name}</h3>
                                    <button
                                        onClick={() => startEditing(search)}
                                        className="text-slate-400 hover:text-blue-600 transition-colors"
                                        title="Rename Search"
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            )}

                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                                {search.filters.q && <span className="bg-slate-100 px-2 py-1 rounded-md text-slate-700 border border-slate-200">&quot;{search.filters.q}&quot;</span>}
                                {search.filters.work_mode && <span className="bg-slate-100 px-2 py-1 rounded-md text-slate-700 border border-slate-200 capitalize">{search.filters.work_mode}</span>}
                                {search.filters.employment_type && <span className="bg-slate-100 px-2 py-1 rounded-md text-slate-700 border border-slate-200 capitalize">{search.filters.employment_type}</span>}
                                {search.filters.country && <span className="bg-slate-100 px-2 py-1 rounded-md text-slate-700 border border-slate-200">{search.filters.country}</span>}
                                {(!search.filters.q && !search.filters.work_mode && !search.filters.employment_type && !search.filters.country) && (
                                    <span className="text-slate-400">All Jobs (No Filters)</span>
                                )}
                            </div>

                            <div className="flex items-center gap-1 mt-3 text-xs text-slate-400">
                                <Clock className="h-3 w-3" />
                                <span>Saved {formatDistanceToNow(new Date(search.created_at), { addSuffix: true })}</span>
                            </div>
                        </div>

                        <div className="flex gap-2 shrink-0">
                            <button
                                onClick={() => handleDelete(search.id, search.name)}
                                disabled={isPending}
                                className="flex items-center gap-1.5 px-3 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                <Trash2 className="h-4 w-4" />
                                <span className="hidden sm:inline">Delete</span>
                            </button>
                            <button
                                onClick={() => handleRun(search.filters)}
                                className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-lg text-sm font-medium transition-colors shadow-sm"
                            >
                                <Play className="h-4 w-4" />
                                <span>Run Search</span>
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
