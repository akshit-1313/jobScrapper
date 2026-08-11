'use client'

import { useState } from 'react'
import { FileText, Download, Trash2, Star, Loader2, Clock, HardDrive } from 'lucide-react'
import { setActiveVersion, deleteResumeVersion, getResumeDownloadUrl } from '@/app/actions/resume-actions'
import type { ResumeVersion } from '@/lib/types/resume'
import { toast } from 'sonner'

interface ResumeVersionsListProps {
    versions: ResumeVersion[]
    onVersionChange: () => void
}

function formatFileSize(bytes: number | null): string {
    if (bytes === null || bytes === 0) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

export function ResumeVersionsList({ versions, onVersionChange }: ResumeVersionsListProps) {
    const [loadingAction, setLoadingAction] = useState<string | null>(null)
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

    if (versions.length === 0) {
        return null
    }

    const handleSetActive = async (versionId: string) => {
        setLoadingAction(`activate-${versionId}`)
        try {
            const result = await setActiveVersion(versionId)
            if (result.success) {
                toast.success('Active resume updated')
                onVersionChange()
            } else {
                toast.error(result.error || 'Failed to set active version')
            }
        } catch {
            toast.error('An unexpected error occurred')
        } finally {
            setLoadingAction(null)
        }
    }

    const handleDelete = async (versionId: string) => {
        setLoadingAction(`delete-${versionId}`)
        try {
            const result = await deleteResumeVersion(versionId)
            if (result.success) {
                toast.success('Resume version deleted')
                setConfirmDeleteId(null)
                onVersionChange()
            } else {
                toast.error(result.error || 'Failed to delete version')
            }
        } catch {
            toast.error('An unexpected error occurred')
        } finally {
            setLoadingAction(null)
        }
    }

    const handleDownload = async (versionId: string) => {
        setLoadingAction(`download-${versionId}`)
        try {
            const result = await getResumeDownloadUrl(versionId)
            if (result.success && result.data) {
                window.open(result.data.url, '_blank')
            } else {
                toast.error(result.error || 'Failed to generate download link')
            }
        } catch {
            toast.error('An unexpected error occurred')
        } finally {
            setLoadingAction(null)
        }
    }

    return (
        <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-700">Resume Versions</h4>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                {versions.map((version) => (
                    <div
                        key={version.id}
                        className={`flex items-center gap-4 p-4 transition-colors ${version.is_active ? 'bg-blue-50/50' : 'bg-white hover:bg-slate-50'
                            }`}
                    >
                        {/* File icon */}
                        <div className={`p-2 rounded-lg flex-shrink-0 ${version.file_type === 'pdf' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                            }`}>
                            <FileText className="h-5 w-5" />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-slate-900 truncate">
                                    {version.file_name}
                                </p>
                                {version.is_active && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                        <Star className="h-3 w-3 fill-current" />
                                        Active
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                                <span className="flex items-center gap-1">
                                    <HardDrive className="h-3 w-3" />
                                    {formatFileSize(version.file_size)}
                                </span>
                                <span className="uppercase font-medium">{version.file_type}</span>
                                <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {formatDate(version.created_at)}
                                </span>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                            {!version.is_active && (
                                <button
                                    onClick={() => handleSetActive(version.id)}
                                    disabled={loadingAction !== null}
                                    className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                                    title="Set as active"
                                >
                                    {loadingAction === `activate-${version.id}` ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Star className="h-4 w-4" />
                                    )}
                                </button>
                            )}

                            <button
                                onClick={() => handleDownload(version.id)}
                                disabled={loadingAction !== null}
                                className="p-2 text-slate-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                                title="Download"
                            >
                                {loadingAction === `download-${version.id}` ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Download className="h-4 w-4" />
                                )}
                            </button>

                            {confirmDeleteId === version.id ? (
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => handleDelete(version.id)}
                                        disabled={loadingAction !== null}
                                        className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                        {loadingAction === `delete-${version.id}` ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                            'Confirm'
                                        )}
                                    </button>
                                    <button
                                        onClick={() => setConfirmDeleteId(null)}
                                        className="px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setConfirmDeleteId(version.id)}
                                    disabled={loadingAction !== null}
                                    className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                                    title="Delete"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
