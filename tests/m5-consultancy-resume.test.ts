/**
 * @jest-environment node
 *
 * M5 — consultancy / client-engagement resume structure.
 *
 * This class of resume nests per-client work beneath a parent employer:
 *
 *   Professional Summary
 *   Education
 *   Work Experience
 *     └── Employer / Title / Dates
 *   Client Engagements
 *     ├── Client | Dates
 *     └── client-specific bullets
 *   Technical Skills
 *     └── Labelled subsections ("Integrations: REST API, Postman")
 *
 * The fixtures below are SYNTHETIC and deliberately use invented organisation
 * names. The parser must be generic — no real company from any source document
 * is referenced in the implementation or in these tests.
 */
import { parseResumeText, detectTechnologies, stripTrailingLocation, splitOutsideParens, stripPageFurniture, refineHeadline } from '@/lib/resume/resume-parser'

const CONSULTANCY_RESUME = `
Priya Raman
priya@example.com | +91-9000000000 | linkedin

Professional Summary
Salesforce Developer with hands-on experience in Apex, LWC, Flows and REST API
integrations across automotive and manufacturing projects.

Education
Northfield Institute of Technology, Example City, Country
Bachelor of Engineering in Information Technology 2021 - 2025
• CGPA: 8.71

Work Experience
Orbital Systems Springfield, Country
Software Engineer Jan 2025 - Present
• Owning end-to-end Salesforce delivery across multiple client engagements.
• Built custom solutions using Apex and Visualforce.

Client Engagements
Northwind Motors | May 2025 - Present
• Designed custom solutions using Apex, Visualforce and Lightning Web Components (LWC);
managed REST API integrations and end-to-end change requests.
Harbour Audio | Aug 2025 - Present
• Delivered a major business requirement during go-live, improving delivery time by 30%.
Cedar Papers | Dec 2025 - Present
• Automated REST API integration failure retriggering to PI/SAP systems, improving
operational efficiency by 40%.
Vantage Logistics | March 2026 - Present
• Worked on FTP-based integration workflows involving intermediate tables, endpoint
development, and CSV generation for external system processing.
Lumen Retail | Mar 2025 - Dec 2025
• Primary point of contact for support; resolved configurations, Apex and LWC issues.

Technical Skills
Salesforce Development: Apex, Lightning Web Components (LWC), Visualforce Pages, JavaScript, SOQL
Salesforce Platforms: Sales Cloud, Service Cloud, Salesforce Flows, Custom Objects
Integrations: REST API Integrations, External System Synchronization, Postman
Data & Deployment: Data Migration (Salesforce Inspector, Custom Scripts), Change Sets
Engineering Practices: Triggers, Test Classes, Debugging, Technical Documentation
-- 1 of 1 --
`.trim()

describe('M5 — consultancy resume: text utilities', () => {
    test('strips page furniture', () => {
        expect(stripPageFurniture('-- 1 of 1 --')).toBe('')
        expect(stripPageFurniture('Page 2 of 3')).toBe('')
        expect(stripPageFurniture('Apex, LWC')).toBe('Apex, LWC')
    })

    test('splits on separators outside parentheses only', () => {
        expect(splitOutsideParens('Data Migration (Inspector, Scripts), Change Sets'))
            .toEqual(['Data Migration (Inspector, Scripts)', ' Change Sets'])
    })

    test('strips a trailing location from a company name', () => {
        expect(stripTrailingLocation('Orbital Systems Springfield, Country')).toBe('Orbital Systems')
        expect(stripTrailingLocation('Orbital Systems')).toBe('Orbital Systems')
    })

    test('a multi-word city is ambiguous — keeps as much of the company as possible', () => {
        // Nothing in the text distinguishes a company's last word from a city's
        // first word. The parser removes the SHORTEST trailing location rather
        // than guessing, so the company is under-stripped, never over-stripped.
        expect(stripTrailingLocation('Orbital Systems New Delhi, Country')).toBe('Orbital Systems New')
    })

    test('leaves a company with no trailing location untouched', () => {
        expect(stripTrailingLocation('Acme, Inc')).toBe('Acme, Inc')
    })
})

describe('M5 — consultancy resume: technology detection', () => {
    test('detects technologies literally present', () => {
        const t = detectTechnologies('Automated REST API integration retriggering to PI/SAP systems')
        const lower = t.map(x => x.toLowerCase())
        expect(lower).toContain('pi/sap')
        expect(lower.some(x => x.includes('rest api'))).toBe(true)
    })

    test('detects hyphenated usage — "FTP-based" names FTP', () => {
        const t = detectTechnologies('Worked on FTP-based integration workflows and CSV generation')
        const lower = t.map(x => x.toLowerCase())
        expect(lower).toContain('ftp')
        expect(lower).toContain('csv')
    })

    test('does not emit short false positives from prose ("go-live" is not Go)', () => {
        const t = detectTechnologies('Delivered during final implementation and go-live')
        expect(t.map(x => x.toLowerCase())).not.toContain('go')
    })

    test('invents nothing — every term appears verbatim in the source', () => {
        const src = 'Built integrations with Apex and Flows'
        for (const t of detectTechnologies(src)) {
            expect(src.toLowerCase()).toContain(t.toLowerCase())
        }
    })

    test('returns nothing for text naming no known technology', () => {
        expect(detectTechnologies('Attended weekly stakeholder meetings')).toEqual([])
    })
})

describe('M5 — consultancy resume: structure', () => {
    const parsed = parseResumeText(CONSULTANCY_RESUME)

    test('employer is parsed from the two-line block, not the title', () => {
        expect(parsed.experience.length).toBe(1)
        expect(parsed.experience[0].company_name).toBe('Orbital Systems')
        expect(parsed.experience[0].title).toBe('Software Engineer')
        expect(parsed.experience[0].is_current).toBe(true)
    })

    test('client engagements are NOT flattened into the employer description', () => {
        const employerText = (parsed.experience[0].description || '').toLowerCase()
        expect(employerText).not.toContain('northwind motors')
        expect(employerText).not.toContain('cedar papers')
        expect(employerText).not.toContain('ftp-based')
    })

    test('client engagements are extracted as their own structured records', () => {
        expect(parsed.engagements.length).toBe(5)
        const clients = parsed.engagements.map(e => e.client_name)
        expect(clients).toContain('Northwind Motors')
        expect(clients).toContain('Cedar Papers')
        expect(clients).toContain('Vantage Logistics')
    })

    test('each engagement carries its own dates', () => {
        const cedar = parsed.engagements.find(e => e.client_name === 'Cedar Papers')!
        expect(cedar.start_date).toBe('2025-12-01')
        expect(cedar.is_current).toBe(true)

        const lumen = parsed.engagements.find(e => e.client_name === 'Lumen Retail')!
        expect(lumen.start_date).toBe('2025-03-01')
        expect(lumen.end_date).toBe('2025-12-01')
        expect(lumen.is_current).toBe(false)
        expect(lumen.duration_months).toBe(9)
    })

    test('each engagement is attributed to the parent employer', () => {
        for (const e of parsed.engagements) {
            expect(e.parent_company).toBe('Orbital Systems')
        }
    })

    test('engagement technologies are captured per client', () => {
        const cedar = parsed.engagements.find(e => e.client_name === 'Cedar Papers')!
        const cedarTech = cedar.technologies.map(t => t.toLowerCase())
        expect(cedarTech).toContain('pi/sap')
        expect(cedarTech.some(t => t.includes('rest api'))).toBe(true)

        const vantage = parsed.engagements.find(e => e.client_name === 'Vantage Logistics')!
        const vantageTech = vantage.technologies.map(t => t.toLowerCase())
        expect(vantageTech).toContain('ftp')
        expect(vantageTech).toContain('csv')

        const northwind = parsed.engagements.find(e => e.client_name === 'Northwind Motors')!
        const nwTech = northwind.technologies.map(t => t.toLowerCase())
        expect(nwTech).toContain('apex')
    })

    test('technologies are attributed to the correct engagement, not shared', () => {
        const northwind = parsed.engagements.find(e => e.client_name === 'Northwind Motors')!
        expect(northwind.technologies.map(t => t.toLowerCase())).not.toContain('ftp')

        const vantage = parsed.engagements.find(e => e.client_name === 'Vantage Logistics')!
        expect(vantage.technologies.map(t => t.toLowerCase())).not.toContain('pi/sap')
    })

    test('engagement bullets split into responsibilities and achievements', () => {
        const harbour = parsed.engagements.find(e => e.client_name === 'Harbour Audio')!
        expect(harbour.achievements.join(' ')).toContain('30%')

        const northwind = parsed.engagements.find(e => e.client_name === 'Northwind Motors')!
        expect(northwind.responsibilities.length).toBeGreaterThan(0)
    })

    test('domain/business context is captured where named', () => {
        const withDomains = parsed.engagements.filter(e => e.domains.length > 0)
        expect(withDomains.length).toBeGreaterThan(0)
        const allDomains = parsed.engagements.flatMap(e => e.domains).map(d => d.toLowerCase())
        expect(allDomains.some(d => d.includes('integration'))).toBe(true)
    })

    test('engagement technologies reach the skills list for job matching', () => {
        const names = parsed.skills.map(s => s.skill_name.toLowerCase())
        expect(names).toContain('ftp')
        expect(names).toContain('csv')
        expect(names.some(n => n.includes('pi/sap'))).toBe(true)
    })
})

describe('M5 — consultancy resume: labelled skill subsections', () => {
    const parsed = parseResumeText(CONSULTANCY_RESUME)
    const names = parsed.skills.map(s => s.skill_name)

    test('subsection labels are stripped, never stored as skills', () => {
        for (const n of names) {
            expect(n).not.toMatch(/^Salesforce Development:/)
            expect(n).not.toMatch(/^Integrations:/)
            expect(n).not.toMatch(/^Data & Deployment:/)
            expect(n).not.toMatch(/^Engineering Practices:/)
        }
    })

    test('the first skill after a label is captured cleanly', () => {
        expect(names).toContain('Apex')
        expect(names).toContain('Sales Cloud')
        expect(names).toContain('Triggers')
        expect(names.some(n => n.startsWith('REST API Integrations'))).toBe(true)
    })

    test('grouped values in parentheses are not split apart', () => {
        expect(names.some(n => n.includes('Salesforce Inspector, Custom Scripts'))).toBe(true)
    })

    test('page furniture never becomes a skill', () => {
        expect(names.some(n => n.includes('1 of 1'))).toBe(false)
    })

    test('skills carry categories', () => {
        const apex = parsed.skills.find(s => s.skill_name === 'Apex')
        expect(apex?.category).toBe('language')
        const salesCloud = parsed.skills.find(s => s.skill_name === 'Sales Cloud')
        expect(salesCloud?.category).toBe('cloud')
    })

    test('near-duplicate aliases are not piled up alongside the declared skill', () => {
        const lower = names.map(n => n.toLowerCase())
        expect(lower).toContain('lightning web components (lwc)')
        // The bare alias and the base phrase must not also appear as separate skills.
        expect(lower.filter(n => n === 'lwc').length).toBe(0)
        expect(lower.filter(n => n === 'lightning web components').length).toBe(0)
    })
})

describe('M5 — consultancy resume: education and no-invention', () => {
    const parsed = parseResumeText(CONSULTANCY_RESUME)

    test('institution is read from the line above the degree', () => {
        expect(parsed.education.length).toBe(1)
        expect(parsed.education[0].institution).toContain('Northfield Institute of Technology')
        expect(parsed.education[0].degree?.toLowerCase()).toContain('bachelor')
        expect(parsed.education[0].grade).toBe('8.71')
    })

    test('a grade line is never mistaken for the institution', () => {
        expect(parsed.education[0].institution).not.toContain('CGPA')
    })

    test('every extracted skill appears verbatim in the resume', () => {
        const lower = CONSULTANCY_RESUME.toLowerCase()
        for (const s of parsed.skills) {
            expect(lower).toContain(s.skill_name.toLowerCase())
        }
    })

    test('every engagement client appears verbatim in the resume', () => {
        const lower = CONSULTANCY_RESUME.toLowerCase()
        for (const e of parsed.engagements) {
            expect(lower).toContain(e.client_name.toLowerCase())
        }
    })

    test('a resume with no Client Engagements section yields no engagements', () => {
        const simple = parseResumeText(
            'Sam Lee\n\nWork Experience\nAcme Ltd\nEngineer Jan 2020 - Dec 2021\n• Built things\n'
        )
        expect(simple.engagements).toEqual([])
    })

    test('an empty Client Engagements section yields no engagements', () => {
        const empty = parseResumeText(
            'Sam Lee\n\nWork Experience\nAcme Ltd\nEngineer Jan 2020 - Dec 2021\n• Built things\n\nClient Engagements\n\nTechnical Skills\nApex\n'
        )
        expect(empty.engagements).toEqual([])
    })
})

describe('M5 — headline and location must not capture section text', () => {
    test('a section heading is never chosen as the headline', () => {
        const p = parseResumeText(CONSULTANCY_RESUME)
        expect(p.profile.headline).not.toBe('Professional Summary')
        expect(p.profile.headline).not.toBe('Work Experience')
        expect(p.profile.headline).not.toBe('Technical Skills')
    })

    test('"based in" does not match inside "FTP-based integration"', () => {
        const p = parseResumeText(
            'Sam Lee\nEngineer\n\nWork Experience\nAcme Ltd\nEngineer Jan 2020 - Dec 2021\n' +
            '• Worked on FTP-based integration workflows and CSV generation\n'
        )
        expect(p.profile.current_location ?? '').not.toContain('tegration')
        expect(p.profile.current_location ?? '').not.toContain('workflows')
    })

    test('a genuine location keyword is still captured', () => {
        const p = parseResumeText('Sam Lee\nEngineer\nLocation: Bengaluru, Karnataka\n')
        expect(p.profile.current_location).toContain('Bengaluru')
    })
})

describe('M5 — headline refinement', () => {
    test('a summary sentence is reduced to the role noun phrase', () => {
        expect(refineHeadline(
            'Salesforce Developer with hands-on experience in Apex, LWC, Visualforce, Flows'
        )).toBe('Salesforce Developer')
    })

    test('an already-concise headline is preserved', () => {
        expect(refineHeadline('Senior Backend Engineer')).toBe('Senior Backend Engineer')
    })

    test('returns null when nothing title-like remains', () => {
        expect(refineHeadline(
            'Passionate about building things that matter to people and organisations everywhere'
        )).toBeNull()
        expect(refineHeadline(null)).toBeNull()
        expect(refineHeadline('')).toBeNull()
    })

    test('the consultancy fixture yields a usable job title', () => {
        const p = parseResumeText(CONSULTANCY_RESUME)
        expect(p.profile.headline).toBe('Salesforce Developer')
    })
})
