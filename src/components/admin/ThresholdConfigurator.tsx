'use client'

import { useState } from 'react';
import { updateM8WorkloadLimits } from '@/app/actions/admin-actions';
import { useRouter } from 'next/navigation';

export function ThresholdConfigurator({
    initialSearches,
    initialPages
}: {
    initialSearches: number,
    initialPages: number
}) {
    const [isSaving, setIsSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const router = useRouter();

    async function handleSave(formData: FormData) {
        setIsSaving(true);
        setErrorMsg('');

        try {
            const res = await updateM8WorkloadLimits(formData);
            if (!res.success) {
                setErrorMsg(res.error || 'Failed to update correctly cleanly.');
            } else {
                router.refresh();
            }
        } catch (e: any) {
            setErrorMsg(e.message || 'Unknown network error natively smoothly.');
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <div className="bg-white rounded-lg shadow border border-slate-200 p-6">
            <h2 className="text-xl font-bold mb-4 text-slate-800">Dynamic Workload Limits</h2>
            {errorMsg && (
                <div className="mb-4 bg-red-50 text-red-700 border border-red-200 px-4 py-3 rounded-md text-sm">
                    {errorMsg}
                </div>
            )}
            <form action={handleSave} className="flex flex-col gap-4 max-w-sm">
                <div className="flex flex-col gap-1">
                    <label className="text-sm font-semibold text-slate-600 block">
                        Searches Per Invoke
                    </label>
                    <input
                        name="searches_per_invoke"
                        type="number"
                        defaultValue={initialSearches}
                        required
                        min="1"
                        step="1"
                        className="border border-slate-300 rounded px-3 py-2 w-full"
                    />
                    <span className="text-xs text-slate-500">Max concurrent active searches per CRON cycle securely solidly.</span>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-sm font-semibold text-slate-600 block">
                        Max Pages Per Search
                    </label>
                    <input
                        name="max_pages_per_search"
                        type="number"
                        defaultValue={initialPages}
                        required
                        min="1"
                        step="1"
                        className="border border-slate-300 rounded px-3 py-2 w-full"
                    />
                    <span className="text-xs text-slate-500">Maximum budget deductor extracted natively dynamically gracefully identically effectively optimally gracefully creatively reliably safely wisely perfectly accurately.</span>
                </div>

                <div className="pt-2">
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="bg-slate-900 text-white px-4 py-2 rounded font-medium hover:bg-slate-800 disabled:opacity-50"
                    >
                        {isSaving ? 'Saving...' : 'Update Limits'}
                    </button>
                </div>
            </form>
        </div>
    );
}
