'use client'

import React, { useEffect, useState } from 'react'
import { getApplicationDetails, updateApplicationStatus, updateApplicationDetails, ApplicationStatus } from '@/app/actions/applications-actions'
import { ApplicationKanbanData } from './application-kanban'
import { X, Building, MapPin, Calendar, Clock, AlertCircle } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'

interface ApplicationDetailSheetProps {
    applicationId: string;
    onClose: () => void;
    onUpdate: (data: Partial<ApplicationKanbanData> & { id: string }) => void;
}

const ALL_STATUSES: ApplicationStatus[] = [
    'not_applied', 'interested', 'applied', 'recruiter_contacted',
    'interview', 'technical_round', 'offer', 'rejected', 'withdrawn', 'closed'
];

function formatStatusText(status: string) {
    return status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export function ApplicationDetailSheet({ applicationId, onClose, onUpdate }: ApplicationDetailSheetProps) {
    const [details, setDetails] = useState<(ApplicationKanbanData & { application_events: { id: string, created_at: string, from_status: string, to_status: string, notes: string | null }[] }) | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [selectedStatus, setSelectedStatus] = useState<ApplicationStatus | ''>('');
    const [statusNotes, setStatusNotes] = useState('');

    const [updatingDate, setUpdatingDate] = useState(false);
    const [followUpDate, setFollowUpDate] = useState('');

    useEffect(() => {
        async function fetchDetails() {
            setLoading(true);
            const { data, error, success } = await getApplicationDetails(applicationId);
            if (!success || error || !data) {
                setError(error || 'Failed to load details');
            } else {
                setDetails(data);
                setSelectedStatus(data.status as ApplicationStatus);
                if (data.follow_up_date) {
                    setFollowUpDate(data.follow_up_date.split('T')[0]); // yyyy-mm-dd
                }
            }
            setLoading(false);
        }
        fetchDetails();
    }, [applicationId]);

    const handleUpdateStatus = async () => {
        if (!details || !selectedStatus || selectedStatus === details.status) return;

        setUpdatingStatus(true);
        setError(null);

        // This relies strictly on the server to throw Invalid Transition minimizing client-side rules natively as requested
        const { success, error: updateError } = await updateApplicationStatus(applicationId, selectedStatus, statusNotes);

        if (!success) {
            setError(updateError || 'Invalid status transition');
            setSelectedStatus(details.status as ApplicationStatus); // Rollback optimistic state
        } else {
            // Force a refetch to update events natively from the DB acting as source of truth
            const { data } = await getApplicationDetails(applicationId);
            if (data) {
                setDetails(data);
                onUpdate({ id: applicationId, status: selectedStatus });
                setStatusNotes('');
            }
        }
        setUpdatingStatus(false);
    };

    const handleUpdateDate = async () => {
        setUpdatingDate(true);
        setError(null);

        const dateVal = followUpDate ? new Date(followUpDate).toISOString() : null;

        const { success, error: updateError } = await updateApplicationDetails(applicationId, { follow_up_date: dateVal });

        if (!success) {
            setError(updateError || 'Failed to update follow-up date');
        } else {
            const castedData = dateVal;
            setDetails(prev => prev ? { ...prev, follow_up_date: castedData } : null);
            onUpdate({ id: applicationId, follow_up_date: castedData });
        }
        setUpdatingDate(false);
    };

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm" onClick={onClose} />

            {/* Slide-over panel */}
            <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-xl flex flex-col transform transition-transform border-l border-slate-200">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <h2 className="text-lg font-semibold text-slate-800">Application Details</h2>
                    <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {error && (
                    <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <p>{error}</p>
                    </div>
                )}

                {loading ? (
                    <div className="p-6 flex justify-center text-slate-400">Loading details...</div>
                ) : details ? (
                    <div className="flex-1 overflow-y-auto">
                        <div className="px-6 py-5 bg-slate-50/50">
                            <h3 className="text-xl font-semibold text-slate-900">{details.jobs?.title || 'Unknown Role'}</h3>
                            <div className="mt-2 space-y-2 text-sm text-slate-600">
                                {details.jobs?.company_name && (
                                    <div className="flex items-center gap-2">
                                        <Building className="w-4 h-4 text-slate-400" />
                                        <span>{details.jobs.company_name}</span>
                                    </div>
                                )}
                                {(details.jobs?.location || details.jobs?.work_mode) && (
                                    <div className="flex items-center gap-2">
                                        <MapPin className="w-4 h-4 text-slate-400" />
                                        <span>{[details.jobs?.location, details.jobs?.work_mode].filter(Boolean).join(' • ')}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Status Mutation Form securely relying on RPC for validation boundaries */}
                        <div className="px-6 py-5 border-t border-slate-100">
                            <h4 className="text-sm font-medium text-slate-900 mb-3">Update Status</h4>
                            <div className="space-y-3">
                                <select
                                    value={selectedStatus}
                                    onChange={(e) => setSelectedStatus(e.target.value as ApplicationStatus)}
                                    className="block w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2 bg-white"
                                >
                                    {ALL_STATUSES.map(s => (
                                        <option key={s} value={s}>{formatStatusText(s)}</option>
                                    ))}
                                </select>

                                {selectedStatus !== details.status && (
                                    <>
                                        <textarea
                                            placeholder="Notes for this transition (optional)"
                                            value={statusNotes}
                                            onChange={(e) => setStatusNotes(e.target.value)}
                                            className="block w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                                            rows={2}
                                        />
                                        <button
                                            onClick={handleUpdateStatus}
                                            disabled={updatingStatus}
                                            className="w-full justify-center inline-flex items-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                                        >
                                            {updatingStatus ? 'Updating...' : 'Save New Status'}
                                        </button>
                                        <p className="text-xs text-slate-500">
                                            The server actively restricts illegal transition pathways. Errors will be reported if the mutation is invalid natively.
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Edit Follow Up Date */}
                        <div className="px-6 py-5 border-t border-slate-100">
                            <h4 className="text-sm font-medium text-slate-900 mb-3">Follow-up Reminder</h4>
                            <div className="flex gap-2">
                                <input
                                    type="date"
                                    value={followUpDate}
                                    onChange={(e) => setFollowUpDate(e.target.value)}
                                    className="block w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                                />
                                <button
                                    onClick={handleUpdateDate}
                                    disabled={updatingDate || followUpDate === (details.follow_up_date?.split('T')[0] || '')}
                                    className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                                >
                                    Save
                                </button>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                                Changing this date automatically updates the deterministic deduplication engine for daily cron alerts.
                            </p>
                        </div>

                        {/* Events Ledger */}
                        <div className="px-6 py-5 border-t border-slate-100 mb-8">
                            <h4 className="text-sm font-medium text-slate-900 mb-4">Tracking History</h4>
                            <div className="space-y-4">
                                {details.application_events?.map((ev) => (
                                    <div key={ev.id} className="relative flex gap-4 pl-4 before:absolute before:left-0 before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-slate-300 after:absolute after:bottom-[-1rem] after:left-[3px] after:top-[1.2rem] after:w-px after:bg-slate-200 last:after:hidden">
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-slate-800">
                                                {ev.from_status ? `Moved from ${formatStatusText(ev.from_status)} to ` : 'Started tracking at '}
                                                <span className="text-blue-600">{formatStatusText(ev.to_status)}</span>
                                            </p>
                                            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-500">
                                                <Clock className="w-3.5 h-3.5" />
                                                <time>{format(new Date(ev.created_at), "MMM d, yyyy 'at' h:mm a")}</time>
                                            </div>
                                            {ev.notes && (
                                                <div className="mt-2 text-sm text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-100">
                                                    {ev.notes}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                ) : (
                    <div className="p-6 text-slate-500 text-center">Application not found.</div>
                )}
            </div>
        </>
    )
}
