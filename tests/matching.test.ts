import { DeterministicMatcher, CandidateState } from '../src/lib/matching/matching-engine';
import { JobWithLocationsAndSkills } from '../src/lib/types/jobs';
import { normalizeSkill } from '../src/lib/matching/skill-normalizer';

describe('DeterministicMatcher', () => {

    describe('Skill Normalization', () => {
        it('normalizes JS frameworks correctly', () => {
            expect(normalizeSkill('React.js')).toBe('react');
            expect(normalizeSkill('Node.js')).toBe('nodejs');
        });

        it('cleans trailing punctuation', () => {
            expect(normalizeSkill('Vue,')).toBe('vue');
            expect(normalizeSkill('Postgres.')).toBe('postgresql');
        });
    });

    describe('Engine Matching Core', () => {

        const baseCandidate: CandidateState = {
            profile: { id: 'test', user_id: 'test', name: 'Alice', years_of_experience: 5 } as unknown as CandidateState['profile'],
            skills: [
                { id: '1', user_id: '1', skill_name: 'React.js' },
                { id: '2', user_id: '1', skill_name: 'PostgreSQL' },
                { id: '3', user_id: '1', skill_name: 'TypeScript' }
            ] as unknown as CandidateState['skills'],
            experience: [],
            preferences: null
        };

        const baseJob: JobWithLocationsAndSkills = {
            id: 'job-1',
            title: 'Frontend Developer',
            company_name: 'Tech Co',
            description: 'Looking for a React developer.',
            work_mode: 'remote',
            employment_type: 'full_time',
            job_locations: [{ city: 'London' }],
            job_skills: [
                { skill_name: 'React', is_required: true },
                { skill_name: 'TypeScript', is_required: false }
            ]
        } as unknown as JobWithLocationsAndSkills;

        it('awards maximum skill points if all required skills match', () => {
            const result = DeterministicMatcher.match(baseCandidate, baseJob);
            expect(result.skills_score).toBeGreaterThan(95);
            expect(result.matching_skills).toContain('react');
        });

        it('deducts skill points if required skills are missing', () => {
            const strictJob = {
                ...baseJob,
                job_skills: [
                    { skill_name: 'Go', is_required: true }
                ]
            };
            const result = DeterministicMatcher.match(baseCandidate, strictJob as unknown as JobWithLocationsAndSkills);
            expect(result.skills_score).toBeLessThan(40); // 75 penalty
            expect(result.missing_required_skills).toContain('go');
        });

        it('discovers candidate skills organically in JD if not exactly in schema', () => {
            const organicJob = {
                ...baseJob,
                description: 'We need someone who knows PostgreSQL inside and out.',
                job_skills: []
            };
            const result = DeterministicMatcher.match(baseCandidate, organicJob as unknown as JobWithLocationsAndSkills);
            expect(result.matching_skills).toContain('postgresql');
            expect(result.skills_score).toBeGreaterThan(70);
        });

        it('drops work mode score on preference mismatch', () => {
            const onsiteCandidate = {
                ...baseCandidate,
                preferences: { work_modes: ['onsite'] }
            };
            const result = DeterministicMatcher.match(onsiteCandidate as unknown as CandidateState, baseJob);
            expect(result.work_mode_score).toBe(0);
            expect(result.overall_score).toBeLessThan(70); // Hard incompatibility cap trigger
        });

        it('respects excluded skills as absolute dealbreakers', () => {
            const antiReactCandidate = {
                ...baseCandidate,
                preferences: { excluded_skills: ['React'] }
            };
            const result = DeterministicMatcher.match(antiReactCandidate as unknown as CandidateState, baseJob);
            expect(result.skills_score).toBe(0); // Excluded skill in requirements sets score to 0
            expect(result.overall_score).toBeLessThanOrEqual(35); // Hard cap on dealbreaker
        });

        it('correctly calculates seniority mismatch', () => {
            const seniorJob = {
                ...baseJob,
                title: 'Principal Frontend Developer'
            };
            // Candidate has 0 indication of Seniority (assumes Mid)
            const result = DeterministicMatcher.match(baseCandidate, seniorJob);
            expect(result.seniority_score).toBe(30);
            expect(result.concerns.some(c => c.includes('seniority level'))).toBe(true);
        });

        it('docks points heavily for insufficient years of experience check', () => {
            const strictJob = {
                ...baseJob,
                experience_min: 10
            };
            const result = DeterministicMatcher.match(baseCandidate, strictJob);
            expect(result.experience_score).toBe(0); // Max penalty
            expect(result.concerns.some(c => c.includes('experience'))).toBe(true);
        });

        it('rewards perfect matches with strong recommendation', () => {
            const perfectCandidate = {
                ...baseCandidate,
                profile: { ...baseCandidate.profile, years_of_experience: 5, headline: 'Frontend Developer' },
                preferences: { work_modes: ['remote'], desired_roles: ['Frontend Developer'] }
            };

            const result = DeterministicMatcher.match(perfectCandidate as unknown as CandidateState, baseJob);
            expect(result.overall_score).toBeGreaterThanOrEqual(85);
            expect(result.recommendation).toBe('strong_match');
        });

        it('rewards matching employment type preference', () => {
            const tempCandidate = {
                ...baseCandidate,
                preferences: { employment_type: 'full_time' }
            };
            const result = DeterministicMatcher.match(tempCandidate as unknown as CandidateState, baseJob);
            expect(result.emp_type_score).toBe(100);
        });

        it('strictly penalizes differing employment type preference', () => {
            const contCandidate = {
                ...baseCandidate,
                preferences: { employment_type: 'contract' }
            };
            const result = DeterministicMatcher.match(contCandidate as unknown as CandidateState, baseJob);
            expect(result.emp_type_score).toBe(0);
        });

        it('strictly penalizes Title vs Description discrepancy (title matches, but description context does not)', () => {
            const discrepancyJob = {
                ...baseJob,
                title: 'Frontend Developer', // matches candidate exactly
                description: 'We are looking for a frontend developer. You must have 10 years of experience in Java and Spring Boot. No frontend technologies required actually.',
                job_skills: [
                    { skill_name: 'Java', is_required: true },
                    { skill_name: 'Spring Boot', is_required: true }
                ]
            };
            const result = DeterministicMatcher.match(baseCandidate, discrepancyJob as unknown as JobWithLocationsAndSkills);

            // Should bomb the skills match completely
            expect(result.skills_score).toBeLessThan(30);

            // Overall score should drag due to missing critical Java skills despite the title matching perfectly
            expect(result.overall_score).toBeLessThan(70);
            expect(result.recommendation).not.toBe('strong_match');
        });

        it('heuristically promotes skills to required if contextualized by mandatory tokens in description', () => {
            const malformedJob = {
                ...baseJob,
                description: 'You MUST HAVE strong skills in postgresql to be considered for this role.',
                job_skills: [
                    { skill_name: 'PostgreSQL', is_required: false } // Incorrectly marked as preferred by parser
                ]
            };

            // The engine should deterministically spot `must have` near `postgresql` and enforce it as required
            const result = DeterministicMatcher.match(baseCandidate, malformedJob as unknown as JobWithLocationsAndSkills);
            expect(result.matching_skills).toContain('postgresql');

            // Candidate has postgresql, so no penalty, but we can verify it checks it.
            // Let's test a candidate missing it to ensure it is flagged as missing_required_skills, not missing_preferred_skills.
            const candidateWithoutPostgres = {
                ...baseCandidate,
                skills: [{ skill_name: 'React', id: '1' }] as unknown as CandidateState['skills']
            };

            const missedResult = DeterministicMatcher.match(candidateWithoutPostgres as unknown as CandidateState, malformedJob as unknown as JobWithLocationsAndSkills);
            expect(missedResult.missing_required_skills).toContain('postgresql');
            expect(missedResult.missing_preferred_skills).not.toContain('postgresql');
        });
    });
});
