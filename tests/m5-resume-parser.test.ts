/**
 * @jest-environment node
 *
 * M5 Structured Resume Parser.
 *
 * The parser is fully deterministic — regex + a static dictionary, no LLM, no
 * network, no API cost. These tests assert structure AND the no-invention
 * guarantee: nothing may appear in the output that is not in the input.
 */
import {
    parseResumeText,
    categorizeSkill,
    classifyBullet,
    computeDurationMonths,
} from '@/lib/resume/resume-parser'

// ── Fixtures ────────────────────────────────────────────────────────────────

const FULL_RESUME = `
Akshit Gupta
Salesforce Developer
Bengaluru, Karnataka
someone@example.com
https://linkedin.com/in/example

SUMMARY
Salesforce developer with 5 years of experience building CRM integrations.

TECHNICAL SKILLS
Apex, Lightning Web Components, JavaScript (Advanced), SOQL, Python (3 years)
PostgreSQL, MongoDB, AWS, Docker, Git, Jira, Agile, CRM

EXPERIENCE
Senior Salesforce Developer at Acme Corp
Jan 2022 - Present
- Responsible for maintaining the Apex integration layer
- Improved batch job runtime by 40%
- Collaborated with the platform team on release planning
- Reduced deployment failures from 12 per month to 2

Salesforce Developer - Globex
March 2019 - Dec 2021
- Developed Lightning Web Components for the sales console
- Delivered a $2M revenue reporting dashboard

EDUCATION
B.Tech in Computer Science
Indian Institute of Technology, Delhi
2015 - 2019
CGPA: 8.5/10

CERTIFICATIONS
Salesforce Certified Platform Developer I by Salesforce, June 2021
AWS Certified Solutions Architect - Amazon Web Services, 2022
`.trim()

const MINIMAL_RESUME = `
Jane Doe
jane@example.com
`.trim()

// ── Skill categorisation ────────────────────────────────────────────────────

describe('M5 — skill categorisation (deterministic)', () => {
    test('classifies programming languages', () => {
        expect(categorizeSkill('Python')).toBe('language')
        expect(categorizeSkill('TypeScript')).toBe('language')
        expect(categorizeSkill('Apex')).toBe('language')
        expect(categorizeSkill('SOQL')).toBe('language')
    })

    test('classifies frameworks and libraries distinctly', () => {
        expect(categorizeSkill('React')).toBe('framework')
        expect(categorizeSkill('Django')).toBe('framework')
        expect(categorizeSkill('Lightning Web Components')).toBe('framework')
        expect(categorizeSkill('pandas')).toBe('library')
        expect(categorizeSkill('Jest')).toBe('library')
    })

    test('classifies databases, cloud and tools', () => {
        expect(categorizeSkill('PostgreSQL')).toBe('database')
        expect(categorizeSkill('MongoDB')).toBe('database')
        expect(categorizeSkill('AWS')).toBe('cloud')
        expect(categorizeSkill('Kubernetes')).toBe('cloud')
        expect(categorizeSkill('Git')).toBe('tool')
        expect(categorizeSkill('Jira')).toBe('tool')
    })

    test('classifies domains', () => {
        expect(categorizeSkill('CRM')).toBe('domain')
        expect(categorizeSkill('Agile')).toBe('domain')
        expect(categorizeSkill('Machine Learning')).toBe('domain')
    })

    test('is insensitive to case and punctuation variants', () => {
        expect(categorizeSkill('node.js')).toBe('framework')
        expect(categorizeSkill('Node JS')).toBe('framework')
        expect(categorizeSkill('NODEJS')).toBe('framework')
    })

    test('returns "other" for unrecognised skills rather than guessing', () => {
        expect(categorizeSkill('Underwater Basket Weaving')).toBe('other')
        expect(categorizeSkill('Zzzyx')).toBe('other')
        expect(categorizeSkill('')).toBe('other')
    })
})

// ── Bullet classification ───────────────────────────────────────────────────

describe('M5 — responsibility vs achievement classification', () => {
    test('quantified outcomes are achievements', () => {
        expect(classifyBullet('Improved batch job runtime by 40%')).toBe('achievement')
        expect(classifyBullet('Delivered a $2M revenue reporting dashboard')).toBe('achievement')
        expect(classifyBullet('Reduced deployment failures from 12 per month to 2')).toBe('achievement')
    })

    test('outcome verbs without metrics are still achievements', () => {
        expect(classifyBullet('Launched the new customer portal')).toBe('achievement')
        expect(classifyBullet('Automated the release pipeline')).toBe('achievement')
    })

    test('ongoing duties are responsibilities', () => {
        expect(classifyBullet('Responsible for maintaining the Apex integration layer')).toBe('responsibility')
        expect(classifyBullet('Collaborated with the platform team on release planning')).toBe('responsibility')
        expect(classifyBullet('Developed Lightning Web Components for the sales console')).toBe('responsibility')
    })
})

// ── Duration ────────────────────────────────────────────────────────────────

describe('M5 — duration derivation', () => {
    const NOW = new Date('2026-08-26T00:00:00Z')

    test('computes whole months between two dates', () => {
        expect(computeDurationMonths('2019-03-01', '2021-12-01', false, NOW)).toBe(33)
        expect(computeDurationMonths('2022-01-01', '2022-07-01', false, NOW)).toBe(6)
    })

    test('measures a current role to now', () => {
        expect(computeDurationMonths('2022-01-01', null, true, NOW)).toBe(55)
    })

    test('returns null rather than guessing when dates are missing or incoherent', () => {
        expect(computeDurationMonths(null, '2021-01-01', false, NOW)).toBeNull()
        expect(computeDurationMonths('2021-01-01', null, false, NOW)).toBeNull()
        expect(computeDurationMonths('2023-01-01', '2020-01-01', false, NOW)).toBeNull()
        expect(computeDurationMonths('not-a-date', '2021-01-01', false, NOW)).toBeNull()
    })
})

// ── Skills extraction ───────────────────────────────────────────────────────

describe('M5 — skills extraction', () => {
    const parsed = parseResumeText(FULL_RESUME)

    test('extracts skills from the technical skills section', () => {
        const names = parsed.skills.map(s => s.skill_name.toLowerCase())
        expect(names).toContain('apex')
        expect(names).toContain('postgresql')
        expect(names).toContain('docker')
    })

    test('every skill carries a category', () => {
        expect(parsed.skills.length).toBeGreaterThan(0)
        for (const s of parsed.skills) {
            expect(s.category).toBeTruthy()
            expect(['language', 'framework', 'library', 'database', 'cloud', 'tool', 'domain', 'other'])
                .toContain(s.category)
        }
    })

    test('reads explicit proficiency annotations only', () => {
        const js = parsed.skills.find(s => s.skill_name.toLowerCase() === 'javascript')
        expect(js?.proficiency_level).toBe('advanced')

        const apex = parsed.skills.find(s => s.skill_name.toLowerCase() === 'apex')
        expect(apex?.proficiency_level).toBeNull()
    })

    test('reads explicit years annotations only, and strips them from the name', () => {
        const py = parsed.skills.find(s => s.skill_name.toLowerCase() === 'python')
        expect(py).toBeDefined()
        expect(py?.years_used).toBe(3)

        const apex = parsed.skills.find(s => s.skill_name.toLowerCase() === 'apex')
        expect(apex?.years_used).toBeNull()
    })

    test('does not invent skills absent from the resume', () => {
        const names = parsed.skills.map(s => s.skill_name.toLowerCase())
        expect(names).not.toContain('java')
        expect(names).not.toContain('kubernetes')
        expect(names).not.toContain('ruby')
    })
})

// ── Experience extraction ───────────────────────────────────────────────────

describe('M5 — experience extraction', () => {
    const parsed = parseResumeText(FULL_RESUME)

    test('extracts both roles with company and title', () => {
        expect(parsed.experience.length).toBe(2)
        const companies = parsed.experience.map(e => e.company_name)
        expect(companies).toContain('Acme Corp')
        expect(companies).toContain('Globex')
    })

    test('parses dates and current-role flag', () => {
        const senior = parsed.experience.find(e => e.company_name === 'Acme Corp')
        expect(senior?.start_date).toBe('2022-01-01')
        expect(senior?.is_current).toBe(true)
        expect(senior?.end_date).toBeNull()

        const prior = parsed.experience.find(e => e.company_name === 'Globex')
        expect(prior?.start_date).toBe('2019-03-01')
        expect(prior?.end_date).toBe('2021-12-01')
        expect(prior?.is_current).toBe(false)
    })

    test('separates responsibilities from achievements', () => {
        const senior = parsed.experience.find(e => e.company_name === 'Acme Corp')!
        expect(senior.achievements.join(' ')).toContain('40%')
        expect(senior.achievements.join(' ')).toContain('Reduced deployment failures')
        expect(senior.responsibilities.join(' ')).toContain('Responsible for maintaining')
        expect(senior.responsibilities.join(' ')).toContain('Collaborated')
    })

    test('loses no bullet — every line lands in exactly one bucket', () => {
        for (const e of parsed.experience) {
            const bulletCount = (e.description || '').split('\n').filter(Boolean).length
            expect(e.responsibilities.length + e.achievements.length).toBe(bulletCount)
        }
    })

    test('retains description for backward compatibility', () => {
        for (const e of parsed.experience) {
            expect(typeof e.description === 'string' || e.description === null).toBe(true)
        }
    })

    test('derives duration_months where dates allow', () => {
        const prior = parsed.experience.find(e => e.company_name === 'Globex')
        expect(prior?.duration_months).toBe(33)
    })
})

// ── Education extraction ────────────────────────────────────────────────────

describe('M5 — structured education', () => {
    const parsed = parseResumeText(FULL_RESUME)

    test('extracts an education entry', () => {
        expect(parsed.education.length).toBeGreaterThanOrEqual(1)
    })

    test('captures degree and field of study', () => {
        const all = parsed.education
        expect(all.some(e => (e.degree || '').toLowerCase().includes('tech'))).toBe(true)
        expect(all.some(e => (e.field_of_study || '').toLowerCase().includes('computer science'))).toBe(true)
    })

    test('captures institution and grade', () => {
        const joined = parsed.education.map(e => e.institution).join(' ')
        expect(joined.toLowerCase()).toContain('indian institute of technology')
        expect(parsed.education.some(e => (e.grade || '').includes('8.5'))).toBe(true)
    })

    test('education is NOT flattened into professional_summary', () => {
        const summary = parsed.profile.professional_summary || ''
        expect(summary).not.toContain('Education:')
        expect(summary).not.toContain('Indian Institute of Technology')
    })
})

// ── Certification extraction ────────────────────────────────────────────────

describe('M5 — structured certifications', () => {
    const parsed = parseResumeText(FULL_RESUME)

    test('extracts one entry per certification line', () => {
        expect(parsed.certifications.length).toBe(2)
    })

    test('captures certification names', () => {
        const names = parsed.certifications.map(c => c.name.toLowerCase())
        expect(names.some(n => n.includes('platform developer'))).toBe(true)
        expect(names.some(n => n.includes('solutions architect'))).toBe(true)
    })

    test('captures issuer where the line states one', () => {
        const issuers = parsed.certifications.map(c => (c.issuer || '').toLowerCase())
        expect(issuers.some(i => i.includes('salesforce'))).toBe(true)
    })

    test('captures issue dates where present', () => {
        expect(parsed.certifications.some(c => c.issue_date !== null)).toBe(true)
    })

    test('certifications are NOT flattened into professional_summary', () => {
        const summary = parsed.profile.professional_summary || ''
        expect(summary).not.toContain('Certifications:')
    })
})

// ── Raw text preservation ───────────────────────────────────────────────────

describe('M5 — raw text preservation', () => {
    test('returns the extracted text verbatim for separate storage', () => {
        const parsed = parseResumeText(FULL_RESUME)
        expect(parsed.raw_text).toBe(FULL_RESUME)
    })
})

// ── No-invention and robustness ─────────────────────────────────────────────

describe('M5 — no-invention behaviour and malformed input', () => {
    test('a minimal resume yields empty structure, not fabricated data', () => {
        const parsed = parseResumeText(MINIMAL_RESUME)
        expect(parsed.skills).toEqual([])
        expect(parsed.experience).toEqual([])
        expect(parsed.education).toEqual([])
        expect(parsed.certifications).toEqual([])
        expect(parsed.profile.years_of_experience).toBeNull()
    })

    test('empty input does not throw and invents nothing', () => {
        const parsed = parseResumeText('')
        expect(parsed.skills).toEqual([])
        expect(parsed.experience).toEqual([])
        expect(parsed.education).toEqual([])
        expect(parsed.certifications).toEqual([])
        expect(parsed.profile.name).toBeNull()
        expect(parsed.raw_text).toBe('')
    })

    test('garbage input does not throw and produces no structured records', () => {
        const parsed = parseResumeText('!!!! ???? %%%% \n\n @@@@ ####')
        expect(parsed.skills).toEqual([])
        expect(parsed.experience).toEqual([])
        expect(parsed.education).toEqual([])
        expect(parsed.certifications).toEqual([])
    })

    test('a resume with headings but no content yields no records', () => {
        const parsed = parseResumeText(
            'John Smith\n\nSKILLS\n\nEXPERIENCE\n\nEDUCATION\n\nCERTIFICATIONS\n'
        )
        expect(parsed.skills).toEqual([])
        expect(parsed.experience).toEqual([])
        expect(parsed.certifications).toEqual([])
    })

    test('every extracted skill name appears in the source text', () => {
        const parsed = parseResumeText(FULL_RESUME)
        const lowerSource = FULL_RESUME.toLowerCase()
        for (const s of parsed.skills) {
            expect(lowerSource).toContain(s.skill_name.toLowerCase())
        }
    })

    test('every extracted certification name appears in the source text', () => {
        const parsed = parseResumeText(FULL_RESUME)
        const lowerSource = FULL_RESUME.toLowerCase()
        for (const c of parsed.certifications) {
            expect(lowerSource).toContain(c.name.toLowerCase())
        }
    })
})
