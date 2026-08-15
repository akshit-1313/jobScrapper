'use client';

import { useState } from 'react';
import { triggerJobMatch } from '@/app/actions/match-actions';
import { BrainCircuit, CheckCircle2, AlertTriangle, Info, Loader2 } from 'lucide-react';
import type { MatchResult } from '@/lib/matching/matching-engine';
import type { JobMatchRecord } from '@/lib/types/jobs';

export function JobMatchCard({ jobId, initialMatch }: { jobId: string, initialMatch: JobMatchRecord | null }) {
    const [match, setMatch] = useState<JobMatchRecord | null>(initialMatch);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const calculate = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await triggerJobMatch(jobId);
            if (res.success && res.match) {
                setMatch(res.match);
            } else {
                setError(res.error || 'Failed to calculate match');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to calculate match');
        } finally {
            setLoading(false);
        }
    };

    if (!match && !loading && !error) {
        return (
            <div className="mb-8 rounded-xl border border-blue-100 bg-blue-50/50 p-6">
                <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-blue-100 p-2 text-blue-600">
                        <BrainCircuit className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-slate-900">Personalized Match Analysis</h3>
                        <p className="text-sm text-slate-600 mt-1 mb-4">
                            Analyze this job against your profile, skills, and preferences to see if it&apos;s a good fit.
                        </p>
                        <button
                            onClick={calculate}
                            className="text-sm font-medium bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                        >
                            Analyze Match
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="mb-8 rounded-xl border border-slate-100 bg-white p-6 flex flex-col items-center justify-center py-8">
                <Loader2 className="h-8 w-8 text-blue-500 animate-spin mb-3" />
                <p className="text-sm font-medium text-slate-600">Calculating your match score...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="mb-8 rounded-xl border border-red-100 bg-red-50 p-6 flex items-start gap-3 text-red-700">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <div>
                    <h3 className="font-semibold text-sm">Analysis Failed</h3>
                    <p className="text-xs mt-1">{error}</p>
                    <button onClick={calculate} className="text-xs font-medium underline mt-2 hover:text-red-900">Try again</button>
                </div>
            </div>
        );
    }

    if (!match) return null;

    // Colors based on score/recommendation
    const isStrong = match.overall_score >= 85;
    const isGood = match.overall_score >= 70;
    const isPossible = match.overall_score >= 55;

    let badgeColor = 'bg-slate-100 text-slate-700';
    let ringColor = 'ring-slate-500/20';
    let progressColor = 'bg-slate-500';

    if (isStrong) { badgeColor = 'bg-green-50 text-green-700'; ringColor = 'ring-green-600/20'; progressColor = 'bg-green-500'; }
    else if (isGood) { badgeColor = 'bg-blue-50 text-blue-700'; ringColor = 'ring-blue-600/20'; progressColor = 'bg-blue-500'; }
    else if (isPossible) { badgeColor = 'bg-amber-50 text-amber-700'; ringColor = 'ring-amber-600/20'; progressColor = 'bg-amber-500'; }

    return (
        <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className={`border-b border-slate-100 p-5 flex items-center justify-between ${isStrong ? 'bg-green-50/30' : isGood ? 'bg-blue-50/30' : ''}`}>
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center h-10 w-10 rounded-full bg-white shadow-sm border border-slate-100">
                        <span className="font-bold text-lg tracking-tighter text-slate-800">{Math.round(match.overall_score)}</span>
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 leading-tight">Match Score</h3>
                        <p className="text-xs font-medium text-slate-500 capitalize">{match.recommendation?.replace('_', ' ')}</p>
                    </div>
                </div>
                <button onClick={calculate} className="text-xs text-slate-400 hover:text-slate-700" title="Recalculate">
                    <BrainCircuit className="h-4 w-4" />
                </button>
            </div>

            <div className="p-5 space-y-6">
                <div>
                    <div className="flex justify-between text-xs font-medium text-slate-500 mb-1">
                        <span>Breakdown</span>
                    </div>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase font-bold text-slate-400 w-16">Skills</span>
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-400" style={{ width: `${match.skills_score}%` }} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase font-bold text-slate-400 w-16">Role</span>
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-purple-400" style={{ width: `${match.role_score}%` }} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase font-bold text-slate-400 w-16">Exp.</span>
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-amber-400" style={{ width: `${match.experience_score}%` }} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase font-bold text-slate-400 w-16">Location</span>
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-green-400" style={{ width: `${match.location_score}%` }} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase font-bold text-slate-400 w-16">Mode</span>
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-teal-400" style={{ width: `${match.work_mode_score}%` }} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase font-bold text-slate-400 w-16">Seniority</span>
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-orange-400" style={{ width: `${match.seniority_score}%` }} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase font-bold text-slate-400 w-16">Emp Type</span>
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-pink-400" style={{ width: `${match.emp_type_score}%` }} />
                                </div>
                            </div>
                        </div>

                        {match.missing_required_skills?.length > 0 && (
                            <div className="mt-4 p-3 bg-red-50 rounded-lg border border-red-100">
                                <h4 className="text-[11px] font-bold uppercase tracking-wider text-red-700 mb-2">Missing Required</h4>
                                <div className="flex flex-wrap gap-1">
                                    {match.missing_required_skills.map((s, i) => (
                                        <span key={i} className="px-2 py-0.5 rounded text-[10px] font-medium bg-white text-red-600 border border-red-200">
                                            {s}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {match.missing_preferred_skills?.length > 0 && (
                            <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2">Missing Preferred</h4>
                                <div className="flex flex-wrap gap-1">
                                    {match.missing_preferred_skills.map((s, i) => (
                                        <span key={i} className="px-2 py-0.5 rounded text-[10px] font-medium bg-white text-slate-500 border border-slate-200">
                                            {s}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {match.matching_skills?.length > 0 && (
                            <div className="mt-2 p-3 bg-green-50 rounded-lg border border-green-100">
                                <h4 className="text-[11px] font-bold uppercase tracking-wider text-green-700 mb-2">Matched Skills</h4>
                                <div className="flex flex-wrap gap-1">
                                    {match.matching_skills.map((s, i) => (
                                        <span key={i} className="px-2 py-0.5 rounded text-[10px] font-medium bg-white text-green-600 border border-green-200">
                                            {s}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {match.positive_reasons?.length > 0 && (
                    <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-green-500" /> Strengths
                        </h4>
                        <ul className="space-y-1">
                            {match.positive_reasons.map((p: string, i: number) => (
                                <li key={i} className="text-sm text-slate-700 pl-4 relative before:content-[''] before:absolute before:left-0 before:top-2 before:w-1.5 before:h-1.5 before:bg-green-400 before:rounded-full">
                                    {p}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {match.concerns?.length > 0 && (
                    <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 text-amber-500" /> Considerations
                        </h4>
                        <ul className="space-y-1">
                            {match.concerns.map((c: string, i: number) => (
                                <li key={i} className="text-sm text-slate-700 pl-4 relative before:content-[''] before:absolute before:left-0 before:top-2 before:w-1.5 before:h-1.5 before:bg-amber-400 before:rounded-full">
                                    {c}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}
