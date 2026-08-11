import type { ParsedResumeData, ParsedSkill, ParsedExperience, ParsedProfileData } from '@/lib/types/resume'

// ── PDF/DOCX text extraction ────────────────────────────────────────────────

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    const result = await parser.getText()
    return result.text
}

async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value
}

export async function extractText(buffer: Buffer, fileType: 'pdf' | 'docx'): Promise<string> {
    if (fileType === 'pdf') {
        return extractTextFromPDF(buffer)
    }
    return extractTextFromDOCX(buffer)
}

// ── Section extraction helpers ──────────────────────────────────────────────

/** Split text into lines, trimming whitespace */
function lines(text: string): string[] {
    return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
}

// All known section headings — used both as start anchors and stop anchors
const ALL_SECTION_HEADINGS = [
    'SUMMARY', 'PROFESSIONAL SUMMARY', 'PROFILE', 'ABOUT', 'ABOUT ME', 'OBJECTIVE',
    'EXPERIENCE', 'WORK EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'WORK HISTORY',
    'EMPLOYMENT HISTORY', 'EMPLOYMENT',
    'SKILLS', 'TECHNICAL SKILLS', 'CORE SKILLS', 'KEY SKILLS',
    'TECHNOLOGIES', 'TOOLS & TECHNOLOGIES', 'TOOLS AND TECHNOLOGIES',
    'EDUCATION', 'ACADEMIC BACKGROUND',
    'CERTIFICATIONS', 'CERTIFICATES', 'CERTIFICATIONS & LICENSES',
    'PROJECTS', 'KEY PROJECTS', 'NOTABLE PROJECTS',
    'LANGUAGES', 'INTERESTS', 'AWARDS', 'PUBLICATIONS', 'REFERENCES',
    'CONTACT', 'CONTACT INFORMATION',
]

/**
 * Extract text between a set of start headings and any other known section heading.
 * Headings are matched case-insensitively as a standalone line (possibly followed by : or -).
 */
function extractSection(text: string, headings: string[]): string | null {
    const escapedHeadings = headings.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const escapedStops = ALL_SECTION_HEADINGS.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

    const startPattern = escapedHeadings.join('|')
    const stopPattern = escapedStops.join('|')

    const sectionRegex = new RegExp(
        `(?:^|\\n)\\s*(?:${startPattern})\\s*[:\\-]?\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:${stopPattern})\\s*[:\\-]?\\s*\\n|$)`,
        'i'
    )
    const match = text.match(sectionRegex)
    return match ? match[1].trim() : null
}

// ── Profile extraction ──────────────────────────────────────────────────────

// Common contact label prefixes to skip
const CONTACT_LABEL_RE = /^(?:email|phone|address|tel|mobile|linkedin|github|portfolio|contact|fax|website|web)\b/i;
const EMAIL_RE = /@.*\.\w{2,}/;
const PHONE_RE = /^\+?[\d][\d\s\-().]{6,}$/;
const URL_RE = /^https?:\/\//i;
const DIGITS_ONLY_RE = /^\d+$/;
const ALL_CAPS_HEADING_RE = /^[A-Z0-9 &/\-]{5,}$/;
const LOCATION_PATTERN_RE = /^([A-Za-z\s.'-]{2,30}),\s*([A-Za-z\s.'-]{2,30})(?:,\s*[A-Za-z\s.'-]{2,30})?$/;
const NAME_PARTICLES = new Set(['of', 'de', 'van', 'von', 'le', 'la', 'da', 'bin', 'binti']);

export function looksLikeName(line: string): boolean {
    if (line.length < 3 || line.length > 60) return false;
    if (EMAIL_RE.test(line)) return false;
    if (PHONE_RE.test(line)) return false;
    if (URL_RE.test(line)) return false;
    if (DIGITS_ONLY_RE.test(line)) return false;
    if (CONTACT_LABEL_RE.test(line)) return false;
    if (ALL_CAPS_HEADING_RE.test(line)) return false;
    if (/\d/.test(line)) return false;
    if (LOCATION_PATTERN_RE.test(line)) return false;

    const words = line.trim().split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;

    for (const word of words) {
        const segments = word.split('-');
        for (const seg of segments) {
            const lower = seg.toLowerCase();
            if (NAME_PARTICLES.has(lower)) continue;
            if (!/^[A-Z]/.test(seg)) return false;
        }
    }
    return true;
}

const PROFESSIONAL_TITLE_SIGNAL_RE =
    /\b(?:engineer|developer|manager|director|analyst|designer|consultant|architect|specialist|lead|senior|junior|intern|officer|executive|founder|product|sales|marketing|data|software|technology|scientist|researcher|associate|coordinator|administrator|strategist|principal|vp|cto|ceo|coo|cfo|professional|creator|enthusiast|expert|innovator|student|graduate)\b/i;

export function looksLikeHeadline(line: string): boolean {
    if (!line || line.length > 150 || line.length < 3) return false;
    if (EMAIL_RE.test(line)) return false;
    if (PHONE_RE.test(line)) return false;
    if (URL_RE.test(line)) return false;
    if (CONTACT_LABEL_RE.test(line)) return false;
    if (ALL_CAPS_HEADING_RE.test(line)) return false;
    if (/\d{7,}/.test(line)) return false;
    if (LOCATION_PATTERN_RE.test(line)) return false;
    return true;
}

export function extractProfile(text: string) {
    const textLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    const nameCandidates: { line: string; score: number }[] = [];

    const isContextualAnchor = (l: string) =>
        EMAIL_RE.test(l) ||
        PHONE_RE.test(l) ||
        URL_RE.test(l) ||
        LOCATION_PATTERN_RE.test(l) ||
        PROFESSIONAL_TITLE_SIGNAL_RE.test(l) ||
        CONTACT_LABEL_RE.test(l);

    for (let i = 0; i < Math.min(8, textLines.length); i++) {
        const line = textLines[i];
        if (looksLikeName(line)) {
            let score = 0;
            if (PROFESSIONAL_TITLE_SIGNAL_RE.test(line)) score -= 2;

            const wordsCount = line.split(/\s+/).length;
            if (wordsCount === 2) score += 1;

            if (i === 0) score += 1;

            const prev = i > 0 ? textLines[i - 1] : null;
            const next = i < textLines.length - 1 ? textLines[i + 1] : null;

            if (prev && isContextualAnchor(prev)) score += 2;
            if (next && isContextualAnchor(next)) score += 2;

            nameCandidates.push({ line, score });
        }
    }

    let name: string | null = null;
    if (nameCandidates.length > 0) {
        nameCandidates.sort((a, b) => b.score - a.score);
        name = nameCandidates[0].line;
    }

    let headline: string | null = null;
    if (name) {
        const nameIdx = textLines.indexOf(name);
        if (nameIdx >= 0) {
            const headlineCandidates: { line: string; score: number }[] = [];
            for (let i = nameIdx + 1; i <= Math.min(nameIdx + 5, textLines.length - 1); i++) {
                const candidate = textLines[i];
                if (looksLikeHeadline(candidate) && candidate !== name) {
                    const score = PROFESSIONAL_TITLE_SIGNAL_RE.test(candidate) ? 1 : 0;
                    headlineCandidates.push({ line: candidate, score });
                }
            }
            if (headlineCandidates.length > 0) {
                headlineCandidates.sort((a, b) => b.score - a.score);
                headline = headlineCandidates[0].line;
            }
        }
    }

    // ── Professional Summary ──
    const summary = extractSection(text, [
        'SUMMARY', 'PROFESSIONAL SUMMARY', 'PROFILE', 'ABOUT', 'ABOUT ME', 'OBJECTIVE',
    ])

    // ── Education / Certifications / Projects → fold into professional_summary ──
    const education = extractSection(text, ['EDUCATION', 'ACADEMIC BACKGROUND'])
    const certifications = extractSection(text, ['CERTIFICATIONS', 'CERTIFICATES', 'CERTIFICATIONS & LICENSES'])
    const projects = extractSection(text, ['PROJECTS', 'KEY PROJECTS', 'NOTABLE PROJECTS'])

    let professionalSummary = summary || null
    const extras: string[] = []
    if (education) extras.push(`Education:\n${education}`)
    if (certifications) extras.push(`Certifications:\n${certifications}`)
    if (projects) extras.push(`Projects:\n${projects}`)
    if (extras.length > 0) {
        const extraText = extras.join('\n\n')
        professionalSummary = professionalSummary
            ? `${professionalSummary}\n\n${extraText}`
            : extraText
    }

    // ── Years of experience ──
    // Explicit pattern takes priority
    let yearsOfExperience: number | null = null
    const yearsMatch = text.match(/(\d{1,2})\+?\s*(?:years?)\s*(?:of\s*)?(?:experience|exp)/i)
    if (yearsMatch) {
        yearsOfExperience = parseInt(yearsMatch[1], 10)
    }

    // ── Location ──
    let currentLocation: string | null = null

    // Try explicit keyword first
    const locationKeywordMatch = text.match(/(?:location|address|based in|located in)\s*[:\-]?\s*(.+)/i)
    if (locationKeywordMatch) {
        currentLocation = locationKeywordMatch[1].trim().replace(/\s*[|•·].*$/, '').trim()
    }

    // Fallback: scan first ~10 meaningful lines for City, State or City, Country pattern
    if (!currentLocation) {
        for (const line of textLines.slice(0, 10)) {
            if (line === name || line === headline) continue
            if (EMAIL_RE.test(line) || PHONE_RE.test(line) || URL_RE.test(line)) continue
            if (CONTACT_LABEL_RE.test(line)) continue
            const locMatch = line.match(LOCATION_PATTERN_RE)
            if (locMatch) {
                currentLocation = line.trim()
                break
            }
        }
    }

    // ── URLs ──
    let linkedinUrl: string | null = null
    let githubUrl: string | null = null
    let portfolioUrl: string | null = null
    const urlMatches = text.match(/https?:\/\/[^\s)]+/gi) || []
    for (const url of urlMatches) {
        const lower = url.toLowerCase()
        if (lower.includes('linkedin.com') && !linkedinUrl) linkedinUrl = url
        else if (lower.includes('github.com') && !githubUrl) githubUrl = url
        else if (!portfolioUrl && !lower.includes('linkedin.com') && !lower.includes('github.com')) portfolioUrl = url
    }

    return {
        name,
        headline,
        professional_summary: professionalSummary,
        years_of_experience: yearsOfExperience,
        current_location: currentLocation,
        linkedin_url: linkedinUrl,
        github_url: githubUrl,
        portfolio_url: portfolioUrl,
    }
}

// ── Skills extraction ───────────────────────────────────────────────────────

function extractSkills(text: string): ParsedSkill[] {
    const skillsSection = extractSection(text, [
        'SKILLS', 'TECHNICAL SKILLS', 'CORE SKILLS', 'KEY SKILLS',
        'TECHNOLOGIES', 'TOOLS & TECHNOLOGIES', 'TOOLS AND TECHNOLOGIES',
    ])
    if (!skillsSection) return []

    const skills: ParsedSkill[] = []
    const seen = new Set<string>()

    const candidates = skillsSection
        .split(/[,;|•·\n]/)
        .map(s => s.trim())
        .filter(Boolean)

    for (const candidate of candidates) {
        let skill = candidate.replace(/^[-–—*◦▪►]\s*/, '').trim()

        if (skill.endsWith(':') || skill.length > 80 || skill.length < 1) continue
        if (/^\d+$/.test(skill)) continue

        // Remove trailing proficiency annotations
        skill = skill.replace(/\s*\((?:beginner|intermediate|advanced|expert|proficient|familiar)\)\s*$/i, '').trim()

        const normalized = skill.toLowerCase()
        if (!seen.has(normalized) && skill.length > 0) {
            seen.add(normalized)
            skills.push({
                skill_name: skill,
                proficiency_level: null,
                years_used: null,
                is_primary: skills.length < 5,
            })
        }
    }

    return skills
}

// ── Experience extraction ───────────────────────────────────────────────────

/**
 * Parse a date string fragment into an ISO date string.
 * Supports:
 *   - "January 2023" / "Jan 2023"
 *   - "2023" (year-only)
 *   - "01/2023" or "1/2023" (numeric month/year)
 *   - "2023.01" (dot-separated)
 */
function parseMonthYear(text: string): string | null {
    if (!text) return null
    const cleaned = text.trim()

    // "January 2023" or "Jan 2023" (with optional trailing dot)
    const monthYearMatch = cleaned.match(
        /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*\.?\s*(\d{4})/i
    )
    if (monthYearMatch) {
        const monthWord = cleaned.replace(/\s*\.?\s*\d{4}$/, '')
        const month = monthToNumber(monthWord)
        const year = monthYearMatch[1]
        return `${year}-${String(month).padStart(2, '0')}-01`
    }

    // "01/2023" or "1/2023"
    const numericSlashMatch = cleaned.match(/^(\d{1,2})\/(\d{4})$/)
    if (numericSlashMatch) {
        const month = Math.min(12, Math.max(1, parseInt(numericSlashMatch[1], 10)))
        return `${numericSlashMatch[2]}-${String(month).padStart(2, '0')}-01`
    }

    // "2023.01"
    const dotMatch = cleaned.match(/^(\d{4})\.(\d{1,2})$/)
    if (dotMatch) {
        const month = Math.min(12, Math.max(1, parseInt(dotMatch[2], 10)))
        return `${dotMatch[1]}-${String(month).padStart(2, '0')}-01`
    }

    // "2023" (year only)
    const yearMatch = cleaned.match(/^(\d{4})$/)
    if (yearMatch) return `${yearMatch[1]}-01-01`

    return null
}

function monthToNumber(month: string): number {
    const months: Record<string, number> = {
        jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
        apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
        aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
        nov: 11, november: 11, dec: 12, december: 12,
    }
    return months[month.toLowerCase().trim()] ?? 1
}

/**
 * Build a date range regex that covers:
 *  - "Jan 2023 – Dec 2024"
 *  - "January 2023 - Present"
 *  - "2020 - 2023"
 *  - "2023 - Current"
 *  - "01/2023 - 03/2025"
 *  - "2023.01 - 2025.03"
 */
const DATE_SEGMENT =
    '(?:' +
    // Numeric month/year: 01/2023
    '\\d{1,2}\\/\\d{4}' +
    '|' +
    // Dot-separated: 2023.01
    '\\d{4}\\.\\d{1,2}' +
    '|' +
    // Month name + year: Jan 2023 / January 2023
    '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s*\\.?\\s*\\d{4}' +
    '|' +
    // Year only: 2023
    '\\d{4}' +
    ')'

const DATE_RANGE_RE = new RegExp(
    `(${DATE_SEGMENT})\\s*[-–—]\\s*(${DATE_SEGMENT}|Present|Current)`,
    'gi'
)

function parseTitleCompany(text: string): { title: string; company: string } {
    const atMatch = text.match(/^(.+?)\s+at\s+(.+)$/i)
    if (atMatch) return { title: atMatch[1].trim(), company: atMatch[2].trim() }

    const dashMatch = text.match(/^(.+?)\s*[-–—|]\s*(.+)$/)
    if (dashMatch) return { title: dashMatch[2].trim(), company: dashMatch[1].trim() }

    const commaMatch = text.match(/^(.+?),\s*(.+)$/)
    if (commaMatch) return { title: commaMatch[1].trim(), company: commaMatch[2].trim() }

    return { title: text, company: '' }
}

function extractExperience(text: string): ParsedExperience[] {
    const expSection = extractSection(text, [
        'EXPERIENCE', 'WORK EXPERIENCE', 'PROFESSIONAL EXPERIENCE',
        'WORK HISTORY', 'EMPLOYMENT HISTORY', 'EMPLOYMENT',
    ])
    if (!expSection) return []

    const experiences: ParsedExperience[] = []

    const expLines = expSection.split('\n').map(l => l.trim()).filter(Boolean)

    let currentEntry: {
        title: string
        company: string
        startDate: string | null
        endDate: string | null
        description: string[]
        isCurrent: boolean
    } | null = null

    for (const line of expLines) {
        // Normalise "Current" → "Present" for consistent matching
        const normLine = line.replace(/\bcurrent\b/gi, 'Present')
        DATE_RANGE_RE.lastIndex = 0
        const dateMatch = DATE_RANGE_RE.exec(normLine)

        if (dateMatch) {
            // Save previous entry
            if (currentEntry) {
                experiences.push({
                    company_name: currentEntry.company,
                    title: currentEntry.title,
                    start_date: currentEntry.startDate,
                    end_date: currentEntry.isCurrent ? null : currentEntry.endDate,
                    description: currentEntry.description.join('\n') || null,
                    is_current: currentEntry.isCurrent,
                })
            }

            const startRaw = dateMatch[1]
            const endRaw = dateMatch[2]
            const isCurrent = /present/i.test(endRaw)
            const startDate = parseMonthYear(startRaw)
            const endDate = isCurrent ? null : parseMonthYear(endRaw)

            // Strip date range from line to get title/company
            DATE_RANGE_RE.lastIndex = 0
            const remaining = normLine.replace(DATE_RANGE_RE, '').trim()
                .replace(/^[-–—|,]\s*/, '').replace(/\s*[-–—|,]\s*$/, '').trim()

            const { title, company } = parseTitleCompany(remaining)

            currentEntry = {
                title: title || 'Position',
                company: company || remaining || 'Company',
                startDate,
                endDate,
                description: [],
                isCurrent,
            }
        } else if (currentEntry) {
            const cleaned = line.replace(/^[-–—*•◦▪►]\s*/, '').trim()
            if (cleaned.length > 0) {
                currentEntry.description.push(cleaned)
            }
        }
    }

    // Save last entry
    if (currentEntry) {
        experiences.push({
            company_name: currentEntry.company,
            title: currentEntry.title,
            start_date: currentEntry.startDate,
            end_date: currentEntry.isCurrent ? null : currentEntry.endDate,
            description: currentEntry.description.join('\n') || null,
            is_current: currentEntry.isCurrent,
        })
    }

    return experiences
}

/**
 * Derive approximate years of experience from the earliest parsed experience start_date.
 * Returns null when experience is empty or start_date is unavailable/malformed.
 * Never returns a negative value.
 */
function deriveYearsOfExperienceFromDates(
    experience: ParsedExperience[],
    now: Date = new Date()
): number | null {
    if (experience.length === 0) return null

    let earliestYear: number | null = null

    for (const exp of experience) {
        if (!exp.start_date) continue
        const yearMatch = exp.start_date.match(/^(\d{4})/)
        if (yearMatch) {
            const y = parseInt(yearMatch[1], 10)
            if (earliestYear === null || y < earliestYear) {
                earliestYear = y
            }
        }
    }

    if (earliestYear === null) return null

    const derived = now.getFullYear() - earliestYear
    return derived >= 0 ? derived : null
}

// ── Main parse function ─────────────────────────────────────────────────────

export async function parseResume(buffer: Buffer, fileType: 'pdf' | 'docx'): Promise<ParsedResumeData> {
    const text = await extractText(buffer, fileType)

    const profile = extractProfile(text)
    const skills = extractSkills(text)
    const experience = extractExperience(text)

    // Derive years-of-experience fallback from experience dates when no explicit value was found
    if (profile.years_of_experience === null) {
        profile.years_of_experience = deriveYearsOfExperienceFromDates(experience)
    }

    return { profile, skills, experience }
}
