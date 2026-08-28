import { Briefcase, GraduationCap, Award, Layers, Users } from 'lucide-react'
import {
    groupSkillsByCategory,
    formatPeriod,
    formatDuration,
    type ViewSkill,
} from '@/lib/profile/profile-view'

export interface StructuredExperience {
    id: string
    company_name: string
    title: string
    start_date: string | null
    end_date: string | null
    is_current: boolean
    responsibilities?: string[] | null
    achievements?: string[] | null
}

export interface StructuredEngagement {
    id: string
    client_name: string
    parent_company: string | null
    start_date: string | null
    end_date: string | null
    is_current: boolean
    responsibilities?: string[] | null
    achievements?: string[] | null
    technologies?: string[] | null
    domains?: string[] | null
}

export interface StructuredEducation {
    id: string
    institution: string
    degree: string | null
    field_of_study: string | null
    start_date: string | null
    end_date: string | null
    grade: string | null
}

export interface StructuredCertification {
    id: string
    name: string
    issuer: string | null
    issue_date: string | null
}

interface Props {
    headline: string | null
    skills: ViewSkill[]
    experience: StructuredExperience[]
    engagements: StructuredEngagement[]
    education: StructuredEducation[]
    certifications: StructuredCertification[]
}

function Section({ icon, title, count, children }: {
    icon: React.ReactNode; title: string; count?: number; children: React.ReactNode
}) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
                <span className="text-slate-500">{icon}</span>
                <h3 className="font-semibold text-slate-900">{title}</h3>
                {typeof count === 'number' && (
                    <span className="text-xs text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{count}</span>
                )}
            </div>
            {children}
        </div>
    )
}

function Bullets({ label, items }: { label: string; items?: string[] | null }) {
    if (!items || items.length === 0) return null
    return (
        <div className="mt-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
            <ul className="mt-1 space-y-1">
                {items.map((item, i) => (
                    <li key={i} className="text-sm text-slate-600 pl-4 relative">
                        <span className="absolute left-0 text-slate-300">•</span>{item}
                    </li>
                ))}
            </ul>
        </div>
    )
}

/**
 * Read-only view of the structured resume data exactly as persisted.
 * Nothing here infers or fills in missing information — absent fields are
 * shown as absent.
 */
export function StructuredProfile({
    headline, skills, experience, engagements, education, certifications,
}: Props) {
    const skillGroups = groupSkillsByCategory(skills)
    const nothingParsed =
        skills.length === 0 && experience.length === 0 &&
        engagements.length === 0 && education.length === 0 && certifications.length === 0

    if (nothingParsed) {
        return (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <p className="text-slate-600 font-medium">No structured profile yet</p>
                <p className="text-slate-500 text-sm mt-1">
                    Upload a resume above and confirm the parsed details to build your profile.
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {headline && (
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Headline</p>
                    <p className="text-lg font-semibold text-slate-900 mt-1">{headline}</p>
                </div>
            )}

            {skillGroups.length > 0 && (
                <Section icon={<Layers size={18} />} title="Skills by category" count={skills.length}>
                    <div className="space-y-4">
                        {skillGroups.map(group => (
                            <div key={group.category}>
                                <p className="text-xs font-medium uppercase tracking-wide text-slate-400 mb-2">
                                    {group.label}
                                    <span className="ml-2 text-slate-300">{group.skills.length}</span>
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {group.skills.map((s, i) => (
                                        <span
                                            key={`${s.skill_name}-${i}`}
                                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm border ${s.is_primary
                                                ? 'bg-slate-900 text-white border-slate-900'
                                                : 'bg-slate-50 text-slate-700 border-slate-200'
                                                }`}
                                        >
                                            {s.skill_name}
                                            {s.proficiency_level && (
                                                <span className="text-xs opacity-70">· {s.proficiency_level}</span>
                                            )}
                                            {typeof s.years_used === 'number' && (
                                                <span className="text-xs opacity-70">· {s.years_used}y</span>
                                            )}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {experience.length > 0 && (
                <Section icon={<Briefcase size={18} />} title="Work experience" count={experience.length}>
                    <div className="space-y-5">
                        {experience.map(e => (
                            <div key={e.id} className="border-l-2 border-slate-200 pl-4">
                                <p className="font-medium text-slate-900">{e.title}</p>
                                <p className="text-sm text-slate-600">{e.company_name}</p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {formatPeriod(e.start_date, e.end_date, e.is_current)}
                                </p>
                                <Bullets label="Responsibilities" items={e.responsibilities} />
                                <Bullets label="Achievements" items={e.achievements} />
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {engagements.length > 0 && (
                <Section icon={<Users size={18} />} title="Client engagements" count={engagements.length}>
                    <div className="space-y-5">
                        {engagements.map(g => {
                            const duration = formatDuration(
                                g.start_date && (g.end_date || g.is_current)
                                    ? monthsBetween(g.start_date, g.is_current ? null : g.end_date)
                                    : null
                            )
                            return (
                                <div key={g.id} className="border-l-2 border-slate-200 pl-4">
                                    <p className="font-medium text-slate-900">{g.client_name}</p>
                                    {g.parent_company && (
                                        <p className="text-sm text-slate-600">via {g.parent_company}</p>
                                    )}
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        {formatPeriod(g.start_date, g.end_date, g.is_current)}
                                        {duration && <span> · {duration}</span>}
                                    </p>
                                    {g.technologies && g.technologies.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {g.technologies.map((t, i) => (
                                                <span key={`${t}-${i}`} className="rounded bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 text-xs">
                                                    {t}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    <Bullets label="Responsibilities" items={g.responsibilities} />
                                    <Bullets label="Achievements" items={g.achievements} />
                                </div>
                            )
                        })}
                    </div>
                </Section>
            )}

            {education.length > 0 && (
                <Section icon={<GraduationCap size={18} />} title="Education" count={education.length}>
                    <div className="space-y-4">
                        {education.map(ed => (
                            <div key={ed.id} className="border-l-2 border-slate-200 pl-4">
                                <p className="font-medium text-slate-900">
                                    {ed.degree || 'Qualification'}
                                    {ed.field_of_study && <span className="font-normal text-slate-600"> — {ed.field_of_study}</span>}
                                </p>
                                <p className="text-sm text-slate-600">{ed.institution}</p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {formatPeriod(ed.start_date, ed.end_date, false)}
                                    {ed.grade && <span> · {ed.grade}</span>}
                                </p>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {certifications.length > 0 && (
                <Section icon={<Award size={18} />} title="Certifications" count={certifications.length}>
                    <div className="space-y-3">
                        {certifications.map(c => (
                            <div key={c.id} className="border-l-2 border-slate-200 pl-4">
                                <p className="font-medium text-slate-900">{c.name}</p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {c.issuer || 'Issuer not specified'}
                                    {c.issue_date && <span> · {formatPeriod(c.issue_date, null, false)}</span>}
                                </p>
                            </div>
                        ))}
                    </div>
                </Section>
            )}
        </div>
    )
}

/** Whole months between two ISO dates; null end means "to now". */
function monthsBetween(start: string, end: string | null): number | null {
    const s = new Date(start)
    if (Number.isNaN(s.getTime())) return null
    const e = end ? new Date(end) : new Date()
    if (Number.isNaN(e.getTime())) return null
    const m = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth())
    return m >= 0 ? m : null
}
