/**
 * @jest-environment node
 *
 * M5 → M6 compatibility.
 *
 * Proves the structured parser output flows into CandidateState and is consumed
 * by the EXISTING M6 matcher without any change to M6. The new fields (category,
 * responsibilities, achievements, duration_months) are additive: M6 reads
 * skill_name / title / headline as before and must be unaffected by them.
 *
 * If this suite fails, the M5 change has broken the frozen M6 boundary.
 */
import { parseResumeText } from '@/lib/resume/resume-parser'
import { DeterministicMatcher, CandidateState } from '@/lib/matching/matching-engine'
import { JobWithLocationsAndSkills } from '@/lib/types/jobs'

const RESUME = `
Akshit Gupta
Salesforce Developer
Bengaluru, Karnataka

SUMMARY
Salesforce developer with 5 years of experience.

TECHNICAL SKILLS
Apex, JavaScript, PostgreSQL, AWS, Git, CRM

EXPERIENCE
Senior Salesforce Developer at Acme Corp
Jan 2022 - Present
- Responsible for the Apex integration layer
- Improved batch runtime by 40%
`.trim()

/**
 * Mirrors how phase-c-orchestrator assembles CandidateState from the four
 * candidate tables, using rows shaped exactly as the DB would return them
 * AFTER migration 020 (i.e. including the new additive columns).
 */
function toCandidateState(parsed: ReturnType<typeof parseResumeText>): CandidateState {
    return {
        profile: {
            id: 'p1',
            user_id: 'u1',
            name: parsed.profile.name,
            headline: parsed.profile.headline,
            years_of_experience: parsed.profile.years_of_experience,
            current_location: parsed.profile.current_location,
        } as unknown as CandidateState['profile'],

        // Rows as candidate_skills returns them post-020: category included.
        skills: parsed.skills.map((s, i) => ({
            id: String(i),
            user_id: 'u1',
            skill_name: s.skill_name,
            category: s.category,
            proficiency_level: s.proficiency_level,
            years_used: s.years_used,
            is_primary: s.is_primary,
        })) as unknown as CandidateState['skills'],

        // Rows as candidate_experience returns them post-020.
        experience: parsed.experience.map((e, i) => ({
            id: String(i),
            user_id: 'u1',
            company_name: e.company_name,
            title: e.title,
            start_date: e.start_date,
            end_date: e.end_date,
            description: e.description,
            responsibilities: e.responsibilities,
            achievements: e.achievements,
            is_current: e.is_current,
        })) as unknown as CandidateState['experience'],

        preferences: null,
    }
}

const JOB: JobWithLocationsAndSkills = {
    id: 'job-1',
    title: 'Salesforce Developer',
    company_name: 'Globex',
    description: 'Seeking a Salesforce developer with Apex and JavaScript experience.',
    work_mode: 'remote',
    employment_type: 'full_time',
    job_locations: [{ city: 'Bengaluru' }],
    job_skills: [
        { skill_name: 'Apex', is_required: true },
        { skill_name: 'JavaScript', is_required: true },
        { skill_name: 'PostgreSQL', is_required: false },
    ],
} as unknown as JobWithLocationsAndSkills

describe('M5 → M6 compatibility (M6 unmodified)', () => {
    const parsed = parseResumeText(RESUME)
    const candidate = toCandidateState(parsed)

    test('parser produces the fields CandidateState requires', () => {
        expect(candidate.profile).toBeTruthy()
        expect(candidate.skills.length).toBeGreaterThan(0)
        expect(candidate.experience.length).toBeGreaterThan(0)
    })

    test('M6 consumes the structured candidate and returns a full MatchResult', () => {
        const result = DeterministicMatcher.match(candidate, JOB)

        expect(typeof result.overall_score).toBe('number')
        expect(result.overall_score).toBeGreaterThanOrEqual(0)
        expect(result.overall_score).toBeLessThanOrEqual(100)
        expect(typeof result.skills_score).toBe('number')
        expect(typeof result.role_score).toBe('number')
        expect(Array.isArray(result.matching_skills)).toBe(true)
        expect([
            'strong_match', 'good_match', 'possible_match', 'weak_match', 'skip',
        ]).toContain(result.recommendation)
    })

    test('skills parsed from the resume are matched by M6', () => {
        const result = DeterministicMatcher.match(candidate, JOB)
        const matched = result.matching_skills.map(s => s.toLowerCase())
        expect(matched.some(s => s.includes('apex'))).toBe(true)
        expect(result.skills_score).toBeGreaterThan(0)
    })

    test('the experience title parsed from the resume drives role scoring', () => {
        const result = DeterministicMatcher.match(candidate, JOB)
        expect(result.role_score).toBeGreaterThan(0)
    })

    test('new additive fields do not change M6 output', () => {
        // Strip the post-020 additions; M6 must score identically.
        const stripped: CandidateState = {
            ...candidate,
            skills: candidate.skills.map(s => {
                const copy = { ...s } as Record<string, unknown>
                delete copy.category
                return copy
            }) as unknown as CandidateState['skills'],
            experience: candidate.experience.map(e => {
                const copy = { ...e } as Record<string, unknown>
                delete copy.responsibilities
                delete copy.achievements
                return copy
            }) as unknown as CandidateState['experience'],
        }

        const withNew = DeterministicMatcher.match(candidate, JOB)
        const withoutNew = DeterministicMatcher.match(stripped, JOB)

        expect(withNew.overall_score).toBe(withoutNew.overall_score)
        expect(withNew.skills_score).toBe(withoutNew.skills_score)
        expect(withNew.role_score).toBe(withoutNew.role_score)
        expect(withNew.recommendation).toBe(withoutNew.recommendation)
    })

    test('an empty resume yields a CandidateState M6 handles without throwing', () => {
        const empty = toCandidateState(parseResumeText(''))
        expect(() => DeterministicMatcher.match(empty, JOB)).not.toThrow()
    })
})
