'use client'

import React, { useState } from 'react'
import { ApplicationStatus } from '@/app/actions/applications-actions'
import { KANBAN_COLUMNS } from './kanban-constants'
import { Building, MapPin, Clock, MoreVertical, Calendar } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { ApplicationDetailSheet } from './application-detail-sheet'

export type ApplicationKanbanData = {
    id: string;
    status: ApplicationStatus;
    applied_at: string | null;
    updated_at: string | null;
    follow_up_date: string | null;
    recruiter_name: string | null;
    job_id: string;
    jobs: {
        id: string;
        title: string;
        company_name: string;
        location: string | null;
        work_mode: string | null;
        employment_type: string | null;
    } | null;
}

interface ApplicationKanbanProps {
    initialApplications: ApplicationKanbanData[]
}

function formatStatusText(status: string) {
    return status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export function ApplicationKanban({ initialApplications }: ApplicationKanbanProps) {
    const [applications, setApplications] = useState<ApplicationKanbanData[]>(initialApplications);
    const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

    // Provide a callback to refresh state locally after sheet updates
    const handleApplicationUpdate = (updatedApp: Partial<ApplicationKanbanData> & { id: string }) => {
        setApplications(prev => prev.map(app =>
            app.id === updatedApp.id ? { ...app, ...updatedApp } : app
        ));
    };

    return (
        <div className="flex h-[calc(100vh-12rem)] w-full gap-4 overflow-x-auto pb-4 pt-2 no-scrollbar">
            {KANBAN_COLUMNS.map(column => {
                const columnApps = applications.filter(app => column.statuses.includes(app.status));

                return (
                    <div key={column.id} className="flex h-full w-[350px] min-w-[350px] flex-col rounded-xl bg-slate-50 border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-200 p-4 bg-slate-100/50 rounded-t-xl">
                            <h3 className="font-semibold text-slate-800">{column.title}</h3>
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-medium text-slate-600 shadow-sm">
                                {columnApps.length}
                            </span>
                        </div>

                        <div className="flex-1 overflow-y-auto p-3 space-y-3">
                            {columnApps.map(app => (
                                <div
                                    key={app.id}
                                    onClick={() => setSelectedAppId(app.id)}
                                    className="group cursor-pointer rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-blue-400 hover:shadow-md"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <h4 className="font-medium text-slate-900 line-clamp-2">{app.jobs?.title || 'Unknown Job'}</h4>
                                        <span className="inline-flex shrink-0 items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                                            {formatStatusText(app.status)}
                                        </span>
                                    </div>

                                    <div className="mt-2 space-y-1.5 text-sm text-slate-500">
                                        {app.jobs?.company_name && (
                                            <div className="flex items-center gap-1.5">
                                                <Building className="h-4 w-4 shrink-0 text-slate-400" />
                                                <span className="truncate">{app.jobs.company_name}</span>
                                            </div>
                                        )}
                                        {app.jobs?.location && (
                                            <div className="flex items-center gap-1.5">
                                                <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                                                <span className="truncate">{app.jobs.location}</span>
                                            </div>
                                        )}
                                        {app.follow_up_date && (
                                            <div className="flex items-center gap-1.5 text-amber-600 font-medium">
                                                <Calendar className="h-4 w-4 shrink-0" />
                                                <span>Follow-up: {format(new Date(app.follow_up_date), 'MMM d')}</span>
                                            </div>
                                        )}
                                        {app.applied_at && (
                                            <div className="flex items-center gap-1.5 text-xs">
                                                <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                                <span>Applied {formatDistanceToNow(new Date(app.applied_at), { addSuffix: true })}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            })}

            {selectedAppId && (
                <ApplicationDetailSheet
                    applicationId={selectedAppId}
                    onClose={() => setSelectedAppId(null)}
                    onUpdate={handleApplicationUpdate}
                />
            )}
        </div>
    )
}
