'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, FileText, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { uploadResume } from '@/app/actions/resume-actions'
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from '@/lib/types/resume'
import type { ParsedResumeData, ResumeVersion } from '@/lib/types/resume'

type UploadState = 'idle' | 'uploading' | 'parsing' | 'review_required' | 'failed'

interface ResumeUploadProps {
    onParsed: (data: ParsedResumeData, version: ResumeVersion) => void
}

export function ResumeUpload({ onParsed }: ResumeUploadProps) {
    const [state, setState] = useState<UploadState>('idle')
    const [error, setError] = useState<string | null>(null)
    const [isDragOver, setIsDragOver] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const validateFile = (file: File): string | null => {
        if (!ALLOWED_FILE_TYPES.includes(file.type as typeof ALLOWED_FILE_TYPES[number])) {
            return 'Only PDF and DOCX files are accepted'
        }
        if (file.size > MAX_FILE_SIZE) {
            return 'File size exceeds 10 MB limit'
        }
        const ext = file.name.split('.').pop()?.toLowerCase()
        if (!ext || !['pdf', 'docx'].includes(ext)) {
            return 'Invalid file extension'
        }
        return null
    }

    const handleUpload = useCallback(async (file: File) => {
        const validationError = validateFile(file)
        if (validationError) {
            setError(validationError)
            setState('failed')
            return
        }

        setError(null)
        setState('uploading')

        try {
            const formData = new FormData()
            formData.append('file', file)

            setState('parsing')
            const result = await uploadResume(formData)

            if (!result.success || !result.data) {
                setError(result.error || 'Upload failed')
                setState('failed')
                return
            }

            setState('review_required')
            onParsed(result.data.parsedData, result.data.version)
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'An unexpected error occurred'
            setError(message)
            setState('failed')
        }
    }, [onParsed])

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) handleUpload(file)
        // Reset input so same file can be re-selected
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file) handleUpload(file)
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)
    }

    const isProcessing = state === 'uploading' || state === 'parsing'

    return (
        <div className="space-y-4">
            {/* Drop Zone */}
            <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => !isProcessing && fileInputRef.current?.click()}
                className={`
                    relative border-2 border-dashed rounded-xl p-8 text-center transition-all
                    ${isProcessing ? 'cursor-wait opacity-70' : 'cursor-pointer'}
                    ${isDragOver
                        ? 'border-blue-400 bg-blue-50'
                        : state === 'failed'
                            ? 'border-red-300 bg-red-50 hover:border-red-400'
                            : state === 'review_required'
                                ? 'border-green-300 bg-green-50'
                                : 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50'
                    }
                `}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={isProcessing}
                />

                <div className="flex flex-col items-center gap-3">
                    {isProcessing ? (
                        <>
                            <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
                            <p className="text-sm font-medium text-blue-700">
                                {state === 'uploading' ? 'Uploading resume...' : 'Parsing resume content...'}
                            </p>
                            <p className="text-xs text-slate-500">This may take a moment</p>
                        </>
                    ) : state === 'failed' ? (
                        <>
                            <AlertCircle className="h-10 w-10 text-red-400" />
                            <p className="text-sm font-medium text-red-700">{error}</p>
                            <p className="text-xs text-slate-500">Click to try again</p>
                        </>
                    ) : state === 'review_required' ? (
                        <>
                            <CheckCircle className="h-10 w-10 text-green-500" />
                            <p className="text-sm font-medium text-green-700">Resume uploaded and parsed</p>
                            <p className="text-xs text-slate-500">Review your profile data below, or upload a new version</p>
                        </>
                    ) : (
                        <>
                            <div className="p-3 bg-blue-100 rounded-full">
                                <Upload className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-slate-700">
                                    Drag and drop your resume, or <span className="text-blue-600">browse</span>
                                </p>
                                <p className="text-xs text-slate-400 mt-1 flex items-center justify-center gap-2">
                                    <FileText className="h-3 w-3" />
                                    PDF or DOCX, up to 10 MB
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
