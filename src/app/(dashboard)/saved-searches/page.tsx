import { getSavedSearches } from '@/app/actions/saved-searches-actions';
import { Bookmark } from 'lucide-react';
import Link from 'next/link';
import { SavedSearchesList } from './saved-searches-list';

export default async function SavedSearchesPage() {
    const { success, data: searches } = await getSavedSearches();

    return (
        <div className="space-y-8 pb-12">
            <div>
                <h2 className="text-3xl font-bold tracking-tight text-slate-900">Saved Searches</h2>
                <p className="text-slate-500 mt-1">Manage your search parameters and execute targeted discoveries.</p>
            </div>

            {!success || !searches || searches.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 mb-4">
                        <Bookmark className="h-6 w-6 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900 mb-1">No saved searches</h3>
                    <p className="text-slate-500">Go to the Jobs page to configure filters and save your search combinations.</p>
                    <div className="mt-6">
                        <Link href="/jobs" className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium shadow-sm hover:bg-blue-700">
                            Discover Jobs
                        </Link>
                    </div>
                </div>
            ) : (
                <div className="grid gap-4">
                    <SavedSearchesList initialSearches={searches} />
                </div>
            )}
        </div>
    );
}
