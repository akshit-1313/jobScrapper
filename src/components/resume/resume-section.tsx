'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ResumeUpload } from '@/components/resume/resume-upload'
import { ResumeVersionsList } from '@/components/resume/resume-versions-list'
import { ParsedProfileReview } from '@/components/resume/parsed-profile-review'
import type { ParsedResumeData, ResumeVersion } from '@/lib/types/resume'
import { FileText } from 'lucide-react'

interface ResumeSectionProps {
    initialVersions: ResumeVersion[]
}

export function ResumeSection({ initialVersions }: ResumeSectionProps) {
    const router = useRouter()
    const [parsedData, setParsedData] = useState<ParsedResumeData | null>(null)
    const [showReview, setShowReview] = useState(false)

    const handleParsed = useCallback((data: ParsedResumeData, _version: ResumeVersion) => {
        setParsedData(data)
        setShowReview(true)
    }, [])

    const handleConfirmed = useCallback(() => {
        setShowReview(false)
        setParsedData(null)
        router.refresh()
    }, [router])

    const handleDismiss = useCallback(() => {
        setShowReview(false)
        setParsedData(null)
    }, [])

    const handleVersionChange = useCallback(() => {
        router.refresh()
    }, [router])

    return (
        <div className="space-y-6">
            {/* Upload Card */}
            <div className="glass-panel rounded-xl p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                        <FileText className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-slate-900">Resume</h3>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Upload your resume to auto-fill your profile
                        </p>
                    </div>
                </div>

                <ResumeUpload onParsed={handleParsed} />

                {/* Version list */}
                {initialVersions.length > 0 && (
                    <div className="mt-6">
                        <ResumeVersionsList
                            versions={initialVersions}
                            onVersionChange={handleVersionChange}
                        />
                    </div>
                )}
            </div>

            {/* Parsed profile review — shown only after upload */}
            {showReview && parsedData && (
                <ParsedProfileReview
                    parsedData={parsedData}
                    onConfirmed={handleConfirmed}
                    onDismiss={handleDismiss}
                />
            )}
        </div>
    )
}
