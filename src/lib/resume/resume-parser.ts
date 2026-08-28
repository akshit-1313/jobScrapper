import type {
    ParsedResumeData,
    ParsedSkill,
    ParsedExperience,
    ParsedEducation,
    ParsedCertification,
    ParsedEngagement,
    SkillCategory,
} from '@/lib/types/resume'

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
    // Consultancy-style resumes list per-client work under the parent employer.
    // Registering these makes them a stop anchor for WORK EXPERIENCE so client
    // work is never flattened into the employer's bullet list.
    'CLIENT ENGAGEMENTS', 'CLIENT ENGAGEMENT', 'CLIENT PROJECTS', 'CLIENT WORK',
    'ENGAGEMENTS', 'CONSULTING ENGAGEMENTS', 'PROJECT ENGAGEMENTS',
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

/** True when the line is one of the known section headings, in any casing. */
export function isSectionHeading(line: string): boolean {
    const t = line.trim().replace(/[:\-\s]+$/, '').toUpperCase();
    return ALL_SECTION_HEADINGS.includes(t);
}

export function looksLikeName(line: string): boolean {
    if (line.length < 3 || line.length > 60) return false;
    if (isSectionHeading(line)) return false;
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
    // A section heading is never a headline. Title-cased headings ("Professional
    // Summary") slip past ALL_CAPS_HEADING_RE, so match the known list directly.
    if (isSectionHeading(line)) return false;
    if (EMAIL_RE.test(line)) return false;
    if (PHONE_RE.test(line)) return false;
    if (URL_RE.test(line)) return false;
    if (CONTACT_LABEL_RE.test(line)) return false;
    if (ALL_CAPS_HEADING_RE.test(line)) return false;
    if (/\d{7,}/.test(line)) return false;
    if (LOCATION_PATTERN_RE.test(line)) return false;
    return true;
}

/** Words that begin a qualifying clause after a role noun phrase. */
const HEADLINE_CLAUSE_RE =
    /\s+\b(?:with|having|who|whom|specializ\w*|experienced|skilled|possessing|offering|bringing|adept|proficient|seeking|passionate)\b/i

/**
 * Reduce a candidate headline to a job-title-like noun phrase.
 *
 * Résumés often have no dedicated headline line, so the first sentence of the
 * summary gets picked up ("Salesforce Developer with hands-on experience in
 * Apex, LWC, ..."). A full sentence is useless as a job title — it degrades both
 * search queries and M6 role matching — so trim it at the first qualifying
 * clause or comma and keep the result only if it still reads as a role.
 *
 * Returns null rather than guessing when nothing title-like remains.
 */
export function refineHeadline(raw: string | null): string | null {
    if (!raw) return null
    let candidate = raw.trim()
    if (!candidate) return null

    // Already concise and title-like — keep it.
    const wordCount = candidate.split(/\s+/).length
    if (candidate.length <= 60 && wordCount <= 8) return candidate

    // Cut at the first qualifying clause, then at the first comma.
    const clauseCut = candidate.search(HEADLINE_CLAUSE_RE)
    if (clauseCut > 0) candidate = candidate.slice(0, clauseCut)
    const commaIdx = candidate.indexOf(',')
    if (commaIdx > 0) candidate = candidate.slice(0, commaIdx)

    candidate = candidate.trim().replace(/[.;:–—-]+$/, '').trim()

    const words = candidate.split(/\s+/).filter(Boolean)
    if (words.length === 0 || words.length > 8) return null
    // Only accept it if it actually reads as a professional role.
    if (!PROFESSIONAL_TITLE_SIGNAL_RE.test(candidate)) return null

    return candidate
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
                headline = refineHeadline(headlineCandidates[0].line);
            }
        }
    }

    // ── Professional Summary ──
    const summary = extractSection(text, [
        'SUMMARY', 'PROFESSIONAL SUMMARY', 'PROFILE', 'ABOUT', 'ABOUT ME', 'OBJECTIVE',
    ])

    // ── Projects → still folded into professional_summary ──
    //
    // Education and certifications are NO LONGER flattened here: they are now
    // extracted as structured records (candidate_education / candidate_certifications)
    // so downstream job discovery can consume them. Projects have no dedicated
    // table, so they remain summary prose.
    const projects = extractSection(text, ['PROJECTS', 'KEY PROJECTS', 'NOTABLE PROJECTS'])

    let professionalSummary = summary || null
    if (projects) {
        const projectText = `Projects:\n${projects}`
        professionalSummary = professionalSummary
            ? `${professionalSummary}\n\n${projectText}`
            : projectText
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
    // Word boundaries are required: without \b, "based in" matches inside
    // "FTP-based integration" and captures the rest of that sentence as a location.
    const locationKeywordMatch = text.match(/\b(?:location|address|based in|located in)\b\s*[:\-]?\s*(.+)/i)
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

// ── Skill categorisation ────────────────────────────────────────────────────
//
// Fully deterministic: a static dictionary plus suffix heuristics. No LLM, no
// network, no API cost. A skill that cannot be classified is reported as
// 'other' — it is still a real skill from the resume, just unclassified. We
// never invent a skill that is not present in the text.

const SKILL_CATEGORY_DICTIONARY: Record<string, SkillCategory> = {}

function registerSkills(category: SkillCategory, names: string[]) {
    for (const n of names) SKILL_CATEGORY_DICTIONARY[n.toLowerCase()] = category
}

registerSkills('language', [
    'javascript', 'typescript', 'python', 'java', 'c', 'c++', 'c#', 'go', 'golang', 'rust',
    'ruby', 'php', 'swift', 'kotlin', 'scala', 'perl', 'r', 'matlab', 'dart', 'elixir',
    'haskell', 'clojure', 'lua', 'objective-c', 'visual basic', 'vb.net', 'f#', 'groovy',
    'apex', 'abap', 'cobol', 'fortran', 'solidity', 'bash', 'shell', 'powershell',
    'sql', 'plsql', 'pl/sql', 't-sql', 'html', 'css', 'sass', 'scss', 'less', 'soql', 'sosl',
])

registerSkills('framework', [
    'react', 'react.js', 'reactjs', 'angular', 'angularjs', 'vue', 'vue.js', 'vuejs', 'svelte',
    'next.js', 'nextjs', 'nuxt', 'nuxt.js', 'remix', 'astro', 'ember', 'backbone',
    'node.js', 'nodejs', 'express', 'express.js', 'nestjs', 'nest.js', 'fastify', 'koa',
    'django', 'flask', 'fastapi', 'pyramid', 'tornado',
    'spring', 'spring boot', 'springboot', 'struts', 'hibernate', 'quarkus', 'micronaut',
    'rails', 'ruby on rails', 'laravel', 'symfony', 'codeigniter', 'cakephp',
    'asp.net', '.net', '.net core', 'dotnet', 'blazor', 'xamarin',
    'flutter', 'react native', 'ionic', 'cordova', 'electron',
    'lwc', 'lightning web components', 'aura', 'visualforce', 'visualforce pages',
    'salesforce lightning', 'salesforce flows', 'flows', 'lightning components',
])

registerSkills('library', [
    'jquery', 'lodash', 'underscore', 'moment', 'moment.js', 'date-fns', 'axios',
    'redux', 'mobx', 'zustand', 'rxjs', 'react query', 'tanstack query',
    'numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn', 'scikit-learn', 'sklearn',
    'tensorflow', 'pytorch', 'keras', 'xgboost', 'lightgbm', 'opencv', 'nltk', 'spacy',
    'jest', 'mocha', 'chai', 'jasmine', 'pytest', 'unittest', 'junit', 'testng',
    'cypress', 'playwright', 'selenium', 'puppeteer', 'enzyme', 'testing library',
    'tailwind', 'tailwind css', 'bootstrap', 'material ui', 'mui', 'chakra ui', 'ant design',
    'd3', 'd3.js', 'three.js', 'chart.js', 'zod', 'graphql',
])

registerSkills('database', [
    'postgresql', 'postgres', 'mysql', 'mariadb', 'sqlite', 'oracle', 'oracle db',
    'sql server', 'mssql', 'microsoft sql server', 'db2',
    'mongodb', 'mongo', 'cassandra', 'couchdb', 'couchbase', 'dynamodb', 'redis',
    'elasticsearch', 'opensearch', 'solr', 'neo4j', 'influxdb', 'timescaledb',
    'snowflake', 'bigquery', 'redshift', 'clickhouse', 'supabase', 'firebase', 'firestore',
    'prisma', 'sequelize', 'typeorm', 'mongoose',
])

registerSkills('cloud', [
    'aws', 'amazon web services', 'azure', 'microsoft azure', 'gcp', 'google cloud',
    'google cloud platform', 'heroku', 'vercel', 'netlify', 'digitalocean', 'linode',
    'cloudflare', 'ec2', 's3', 'lambda', 'aws lambda', 'ecs', 'eks', 'rds', 'cloudfront',
    'azure functions', 'app engine', 'cloud run', 'cloud functions',
    'kubernetes', 'k8s', 'docker', 'openshift', 'terraform', 'pulumi', 'cloudformation',
    'salesforce', 'sfdc', 'servicenow', 'sap', 'sap pi', 'pi/sap', 'workday', 'netsuite',
    'sales cloud', 'service cloud', 'experience cloud', 'marketing cloud', 'commerce cloud',
])

registerSkills('tool', [
    'git', 'github', 'gitlab', 'bitbucket', 'svn', 'mercurial',
    'jenkins', 'circleci', 'travis', 'travis ci', 'github actions', 'gitlab ci', 'teamcity',
    'bamboo', 'argocd', 'ansible', 'chef', 'puppet', 'vagrant',
    'jira', 'confluence', 'trello', 'asana', 'notion', 'slack', 'linear',
    'postman', 'insomnia', 'swagger', 'soapui',
    'webpack', 'vite', 'rollup', 'babel', 'esbuild', 'parcel', 'gradle', 'maven', 'npm', 'yarn', 'pnpm',
    'figma', 'sketch', 'adobe xd', 'photoshop', 'illustrator',
    'datadog', 'grafana', 'prometheus', 'splunk', 'new relic', 'sentry', 'kibana',
    'kafka', 'rabbitmq', 'activemq', 'airflow', 'dbt', 'spark', 'apache spark', 'hadoop',
    'tableau', 'power bi', 'looker', 'excel', 'linux', 'unix', 'nginx', 'apache',
    'jira service desk', 'salesforce cli', 'sfdx', 'workbench', 'data loader',
    'salesforce inspector', 'change sets', 'triggers', 'test classes', 'debugging',
    'ftp', 'sftp', 'csv', 'xml', 'json', 'soap ui', 'custom objects', 'custom metadata',
])

registerSkills('domain', [
    'fintech', 'healthcare', 'e-commerce', 'ecommerce', 'edtech', 'insurtech', 'banking',
    'insurance', 'retail', 'logistics', 'supply chain', 'telecom', 'telecommunications',
    'manufacturing', 'automotive', 'aerospace', 'real estate', 'hospitality', 'travel',
    'media', 'gaming', 'advertising', 'marketing', 'cybersecurity', 'security',
    'machine learning', 'artificial intelligence', 'data science', 'devops', 'sre',
    'crm', 'erp', 'saas', 'b2b', 'b2c', 'payments', 'blockchain', 'iot', 'embedded systems',
    'agile', 'scrum', 'kanban', 'microservices', 'rest api', 'restful api', 'soap',
    'ci/cd', 'tdd', 'bdd', 'oop', 'system design',
    'rest api', 'rest api integrations', 'rest apis', 'api integration', 'integration',
    'integrations', 'data migration', 'uat', 'production support', 'technical documentation',
    'automotive', 'inventory', 'procurement', 'sales', 'field service',
])

/**
 * Classify a skill deterministically. Returns 'other' when the skill is present
 * in the resume but not recognised — never a guess at a specific category.
 */
export function categorizeSkill(skillName: string): SkillCategory {
    const raw = skillName.trim().toLowerCase()
    if (!raw) return 'other'

    // 1. Exact dictionary hit
    if (SKILL_CATEGORY_DICTIONARY[raw]) return SKILL_CATEGORY_DICTIONARY[raw]

    // 2. Normalised form: strip punctuation/spacing variants (e.g. "Node JS" → "nodejs")
    const collapsed = raw.replace(/[\s._-]/g, '')
    for (const [key, cat] of Object.entries(SKILL_CATEGORY_DICTIONARY)) {
        if (key.replace(/[\s._-]/g, '') === collapsed) return cat
    }

    // 3. Conservative suffix/keyword heuristics
    if (/\b(?:db|database)\b/.test(raw)) return 'database'
    if (/\bcloud\b/.test(raw)) return 'cloud'
    if (/\bframework\b/.test(raw)) return 'framework'
    if (/\b(?:library|lib)\b/.test(raw)) return 'library'

    return 'other'
}

// ── Text utilities ──────────────────────────────────────────────────────────

/** Page footers/headers such as "-- 1 of 1 --" or "Page 2 of 3" carry no content. */
export function stripPageFurniture(line: string): string {
    const t = line.trim()
    if (/^-*\s*\d+\s*(?:of|\/)\s*\d+\s*-*$/i.test(t)) return ''
    if (/^page\s+\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(t)) return ''
    if (/^-{2,}$/.test(t)) return ''
    return line
}

/**
 * Split on separators that sit OUTSIDE parentheses, so grouped values survive:
 *   "Data Migration (Salesforce Inspector, Custom Scripts), Change Sets"
 *     → ["Data Migration (Salesforce Inspector, Custom Scripts)", "Change Sets"]
 */
export function splitOutsideParens(text: string): string[] {
    const out: string[] = []
    let depth = 0
    let buf = ''

    for (const ch of text) {
        if (ch === '(' || ch === '[') depth++
        else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)

        if (depth === 0 && (ch === ',' || ch === ';' || ch === '|' || ch === '•' || ch === '·')) {
            out.push(buf)
            buf = ''
        } else {
            buf += ch
        }
    }
    out.push(buf)
    return out
}

// ── Skill annotations (only when explicitly written in the resume) ──────────

const PROFICIENCY_WORD_MAP: Record<string, 'beginner' | 'intermediate' | 'advanced' | 'expert'> = {
    beginner: 'beginner',
    familiar: 'beginner',
    intermediate: 'intermediate',
    proficient: 'advanced',
    advanced: 'advanced',
    expert: 'expert',
}

/** Reads "Python (Advanced)" → 'advanced'. Returns null unless explicitly annotated. */
function extractProficiency(rawCandidate: string): 'beginner' | 'intermediate' | 'advanced' | 'expert' | null {
    const m = rawCandidate.match(/\((beginner|intermediate|advanced|expert|proficient|familiar)\)/i)
    if (!m) return null
    return PROFICIENCY_WORD_MAP[m[1].toLowerCase()] ?? null
}

/** Reads "Java (5 years)" / "Java - 5+ yrs" → 5. Returns null unless explicitly annotated. */
function extractYearsUsed(rawCandidate: string): number | null {
    const m = rawCandidate.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i)
    if (!m) return null
    const n = parseInt(m[1], 10)
    return Number.isFinite(n) && n >= 0 && n <= 50 ? n : null
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

    // Technical-skills sections are frequently grouped into labelled subsections:
    //
    //   Salesforce Development: Apex, LWC, Visualforce Pages
    //   Integrations: REST API Integrations, Postman
    //
    // Split per LINE and strip the leading "Label:" so the label never becomes a
    // skill and never fuses with the first entry after it. The label itself is a
    // grouping heading, not a skill, so it is discarded.
    const candidates: string[] = []
    for (const rawLine of skillsSection.split('\n')) {
        const line = stripPageFurniture(rawLine).trim()
        if (!line) continue

        const withoutLabel = line.replace(/^\s*[-–—*◦▪►]?\s*[A-Za-z][A-Za-z0-9 &/+.'-]{2,40}\s*:\s*/, '')
        for (const part of splitOutsideParens(withoutLabel)) {
            const trimmed = part.trim()
            if (trimmed) candidates.push(trimmed)
        }
    }

    for (const candidate of candidates) {
        let skill = candidate.replace(/^[-–—*◦▪►]\s*/, '').trim()

        if (skill.endsWith(':') || skill.length > 80 || skill.length < 1) continue
        if (/^\d+$/.test(skill)) continue
        // An empty SKILLS section can let the NEXT section heading leak in as a
        // "skill". Never treat a known section heading as one.
        if (ALL_SECTION_HEADINGS.includes(skill.toUpperCase())) continue

        // Remove trailing proficiency annotations (already captured above)
        skill = skill.replace(/\s*\((?:beginner|intermediate|advanced|expert|proficient|familiar)\)\s*$/i, '').trim()
        // Remove trailing years annotations, e.g. "Java (5 years)" / "Java - 5+ yrs"
        skill = skill.replace(/\s*[-–—(]?\s*\d{1,2}\s*\+?\s*(?:years?|yrs?)\s*\)?\s*$/i, '').trim()

        const normalized = skill.toLowerCase()
        if (!seen.has(normalized) && skill.length > 0) {
            seen.add(normalized)
            skills.push({
                skill_name: skill,
                category: categorizeSkill(skill),
                proficiency_level: extractProficiency(candidate),
                years_used: extractYearsUsed(candidate),
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

// ── Responsibility vs achievement classification ────────────────────────────
//
// Deterministic heuristic. An achievement asserts a measurable outcome; a
// responsibility describes ongoing duties. Every bullet lands in exactly one
// bucket — nothing is dropped, and nothing is invented.

const ACHIEVEMENT_VERB_RE =
    /\b(?:achieved|improved|increased|reduced|decreased|saved|cut|grew|boosted|accelerated|optimi[sz]ed|eliminated|generated|delivered|launched|shipped|won|awarded|exceeded|surpassed|earned|drove|scaled|automated|streamlined)\b/i

/** A quantified outcome: percentage, currency, multiplier, or a magnitude figure. */
const METRIC_RE = /(?:\d+\s*%|%\s*\d+|[$₹€£]\s*\d|\b\d+(?:\.\d+)?\s*[xX]\b|\b\d[\d,.]*\s*(?:k|m|bn|million|billion|hours?|days?|weeks?|users?|customers?|requests?|records?)\b)/i

export function classifyBullet(line: string): 'achievement' | 'responsibility' {
    const hasMetric = METRIC_RE.test(line)
    const hasAchievementVerb = ACHIEVEMENT_VERB_RE.test(line)

    // A quantified result, or an explicit outcome verb, reads as an achievement.
    if (hasMetric && hasAchievementVerb) return 'achievement'
    if (hasMetric) return 'achievement'
    if (hasAchievementVerb) return 'achievement'
    return 'responsibility'
}

/**
 * Whole months between two ISO dates. `end` null means "current" → measured to `now`.
 * Returns null when the start date is missing or the range is incoherent.
 */
export function computeDurationMonths(
    startDate: string | null,
    endDate: string | null,
    isCurrent: boolean,
    now: Date = new Date()
): number | null {
    if (!startDate) return null
    const start = new Date(startDate)
    if (Number.isNaN(start.getTime())) return null

    let end: Date
    if (isCurrent || !endDate) {
        if (!isCurrent && !endDate) return null
        end = now
    } else {
        end = new Date(endDate)
        if (Number.isNaN(end.getTime())) return null
    }

    const months =
        (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
    return months >= 0 ? months : null
}

function parseTitleCompany(text: string): { title: string; company: string } {
    const atMatch = text.match(/^(.+?)\s+at\s+(.+)$/i)
    if (atMatch) return { title: atMatch[1].trim(), company: atMatch[2].trim() }

    const dashMatch = text.match(/^(.+?)\s*[-–—|]\s*(.+)$/)
    if (dashMatch) {
        const left = dashMatch[1].trim()
        const right = dashMatch[2].trim()
        // "Company - Title" and "Title - Company" are both common. Decide from the
        // professional-title signal; when only one side reads as a job title, that
        // side is the title. Ambiguous cases keep the original "Company - Title".
        const leftIsTitle = PROFESSIONAL_TITLE_SIGNAL_RE.test(left)
        const rightIsTitle = PROFESSIONAL_TITLE_SIGNAL_RE.test(right)
        if (leftIsTitle && !rightIsTitle) return { title: left, company: right }
        return { title: right, company: left }
    }

    const commaMatch = text.match(/^(.+?),\s*(.+)$/)
    if (commaMatch) return { title: commaMatch[1].trim(), company: commaMatch[2].trim() }

    return { title: text, company: '' }
}

interface ExperienceDraft {
    title: string
    company: string
    startDate: string | null
    endDate: string | null
    description: string[]
    isCurrent: boolean
}

/**
 * Employer header lines often append a location ("Acme Corp  Springfield, India").
 * Strip a trailing "City, Country" so the company name is usable for matching.
 *
 * The head is greedy, so the SHORTEST trailing location is removed. A multi-word
 * city is inherently ambiguous — nothing in the text distinguishes a company's
 * last word from a city's first word — so the conservative choice is to keep as
 * much of the company as possible rather than over-strip.
 */
export function stripTrailingLocation(company: string): string {
    const m = company.match(/^(.*)\s+([A-Za-z][A-Za-z\s.'-]{1,30},\s*[A-Za-z][A-Za-z\s.'-]{1,30})$/)
    if (!m) return company.trim()
    const head = m[1].trim()
    return head.length >= 2 ? head : company.trim()
}

/** Finalise a draft into a ParsedExperience, splitting bullets and deriving duration. */
function buildExperience(draft: ExperienceDraft): ParsedExperience {
    const responsibilities: string[] = []
    const achievements: string[] = []

    for (const bullet of draft.description) {
        if (classifyBullet(bullet) === 'achievement') achievements.push(bullet)
        else responsibilities.push(bullet)
    }

    const start_date = draft.startDate
    const end_date = draft.isCurrent ? null : draft.endDate

    return {
        company_name: stripTrailingLocation(draft.company),
        title: draft.title,
        start_date,
        end_date,
        // Retained verbatim for backward compatibility with the existing UI/DB column.
        description: draft.description.join('\n') || null,
        responsibilities,
        achievements,
        is_current: draft.isCurrent,
        duration_months: computeDurationMonths(start_date, end_date, draft.isCurrent),
    }
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

    // The line immediately before the current one, used to recover the
    // "Title at Company" header when the date sits on its own line beneath it.
    let prevLine: string | null = null

    for (const line of expLines) {
        // Normalise "Current" → "Present" for consistent matching
        const normLine = line.replace(/\bcurrent\b/gi, 'Present')
        DATE_RANGE_RE.lastIndex = 0
        const dateMatch = DATE_RANGE_RE.exec(normLine)

        if (dateMatch) {
            DATE_RANGE_RE.lastIndex = 0
            const residual = normLine.replace(DATE_RANGE_RE, '').trim()
                .replace(/^[-–—|,]\s*/, '').replace(/\s*[-–—|,]\s*$/, '').trim()

            // The preceding line may be part of THIS entry's header rather than a
            // bullet of the previous one — either the whole "Title at Company"
            // header (date on its own line) or just the company name (two-line
            // employer block). Reclaim it BEFORE the previous entry is closed,
            // otherwise the misattributed line is already baked into that entry.
            const cleanedPrev = prevLine
                ? stripPageFurniture(prevLine).replace(/^[-–—*•◦▪►]\s*/, '').trim()
                : ''

            let headerFromPrevLine: string | null = null
            let companyFromPrevLine: string | null = null

            if (cleanedPrev) {
                DATE_RANGE_RE.lastIndex = 0
                const prevHasDate = DATE_RANGE_RE.test(cleanedPrev.replace(/\bcurrent\b/gi, 'Present'))
                DATE_RANGE_RE.lastIndex = 0

                if (!residual) {
                    // Date-only line: the entire header is on the previous line.
                    headerFromPrevLine = cleanedPrev
                } else if (!parseTitleCompany(residual).company && !prevHasDate) {
                    // Residual gives a title but no company; the previous line is a
                    // bare company line only if it does not itself read as a job title.
                    if (!PROFESSIONAL_TITLE_SIGNAL_RE.test(cleanedPrev)) {
                        companyFromPrevLine = cleanedPrev
                    }
                }

                if ((headerFromPrevLine || companyFromPrevLine) && currentEntry &&
                    currentEntry.description[currentEntry.description.length - 1] === cleanedPrev) {
                    currentEntry.description.pop()
                }
            }

            // Save previous entry
            if (currentEntry) {
                experiences.push(buildExperience(currentEntry))
            }

            const startRaw = dateMatch[1]
            const endRaw = dateMatch[2]
            const isCurrent = /present/i.test(endRaw)
            const startDate = parseMonthYear(startRaw)
            const endDate = isCurrent ? null : parseMonthYear(endRaw)

            // Title/company come from this line once the date range is stripped;
            // if the line was date-only, they come from the preceding header line.
            const remaining: string = residual || headerFromPrevLine || ''

            const { title, company } = parseTitleCompany(remaining)

            // Two-line employer blocks ("Acme Corp / Software Engineer  Jan 2025 - Present")
            // put the company on the line above; it was reclaimed above.
            const resolvedCompany = company || companyFromPrevLine || ''

            currentEntry = {
                title: title || 'Position',
                company: resolvedCompany || remaining || 'Company',
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

        prevLine = line
    }

    // Save last entry
    if (currentEntry) {
        experiences.push(buildExperience(currentEntry))
    }

    return experiences
}

// ── Technology detection (dictionary-bounded, no invention) ─────────────────

// Longest-first so "rest api integrations" wins over "rest api", and
// "lightning web components" over "flows".
const DICTIONARY_TERMS_BY_LENGTH = Object.keys(SKILL_CATEGORY_DICTIONARY)
    .sort((a, b) => b.length - a.length)

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Find dictionary technologies that literally appear in the given text.
 *
 * Strictly extraction, never inference: a term is reported only when it occurs
 * verbatim (whole-token) in the text. Returns the resume's own casing where the
 * match is found, so downstream output mirrors the source document.
 */
export function detectTechnologies(text: string): string[] {
    if (!text) return []
    const lower = text.toLowerCase()
    const found: string[] = []
    const claimed: Array<[number, number]> = []

    for (const term of DICTIONARY_TERMS_BY_LENGTH) {
        // Very short terms are ambiguous in prose ("go" inside "go-live", "r",
        // "c"). Free-text detection requires 3+ characters; explicitly listed
        // skills are unaffected because they go through the dictionary directly.
        if (term.length < 3) continue

        // Alphanumeric boundaries only: hyphenated usage is still a real mention
        // ("FTP-based integration" names FTP). Longest-first matching with claimed
        // spans keeps "node.js" from also yielding "node".
        const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, 'gi')
        let m: RegExpExecArray | null
        while ((m = re.exec(lower)) !== null) {
            const start = m.index
            const end = start + m[0].length
            // Skip a match already covered by a longer term.
            if (claimed.some(([s, e]) => start >= s && end <= e)) continue
            claimed.push([start, end])
            found.push(text.slice(start, end))
            break // one occurrence per term is enough
        }
    }

    // De-duplicate case-insensitively, preserving first-seen casing.
    const seen = new Set<string>()
    const out: string[] = []
    for (const f of found) {
        const k = f.toLowerCase()
        if (!seen.has(k)) { seen.add(k); out.push(f) }
    }
    return out
}

// ── Client engagement extraction ────────────────────────────────────────────
//
// Consultancy/services resumes list per-client work beneath the parent employer:
//
//   Work Experience
//     <Employer>  <Location>
//     <Title>  <Dates>
//     • employer-level bullets
//   Client Engagements
//     <Client> | <Dates>
//     • client-specific bullets
//
// Flattening these into the employer's description destroys the per-client
// technology, responsibility and achievement signal. They are extracted as
// their own structured records instead.

const ENGAGEMENT_HEADINGS = [
    'CLIENT ENGAGEMENTS', 'CLIENT ENGAGEMENT', 'CLIENT PROJECTS', 'CLIENT WORK',
    'ENGAGEMENTS', 'CONSULTING ENGAGEMENTS', 'PROJECT ENGAGEMENTS',
]

/**
 * Best-effort parent employer: the most recent employment entry that is current,
 * else the first. Returns null when there is no employment context.
 */
function inferParentCompany(experience: ParsedExperience[]): string | null {
    if (experience.length === 0) return null
    const current = experience.find(e => e.is_current)
    return (current || experience[0]).company_name || null
}

function extractEngagements(text: string, experience: ParsedExperience[]): ParsedEngagement[] {
    const section = extractSection(text, ENGAGEMENT_HEADINGS)
    if (!section) return []

    const parentCompany = inferParentCompany(experience)
    const engagements: ParsedEngagement[] = []

    interface Draft {
        client: string
        startDate: string | null
        endDate: string | null
        isCurrent: boolean
        bullets: string[]
    }
    let draft: Draft | null = null

    const finalise = (d: Draft) => {
        const responsibilities: string[] = []
        const achievements: string[] = []
        for (const b of d.bullets) {
            if (classifyBullet(b) === 'achievement') achievements.push(b)
            else responsibilities.push(b)
        }
        const body = d.bullets.join(' ')
        const technologies = detectTechnologies(body)
        const domains = technologies.filter(
            t => SKILL_CATEGORY_DICTIONARY[t.toLowerCase()] === 'domain'
        )

        engagements.push({
            client_name: d.client,
            parent_company: parentCompany,
            start_date: d.startDate,
            end_date: d.isCurrent ? null : d.endDate,
            is_current: d.isCurrent,
            responsibilities,
            achievements,
            technologies,
            domains,
            duration_months: computeDurationMonths(
                d.startDate, d.isCurrent ? null : d.endDate, d.isCurrent
            ),
        })
    }

    for (const rawLine of section.split('\n')) {
        const line = stripPageFurniture(rawLine).trim()
        if (!line) continue

        const normLine = line.replace(/\bcurrent\b/gi, 'Present')
        DATE_RANGE_RE.lastIndex = 0
        const dateMatch = DATE_RANGE_RE.exec(normLine)

        const isBullet = /^[-–—*•◦▪►]/.test(line)

        // A client header carries a date range and is not a bullet.
        if (dateMatch && !isBullet) {
            if (draft) finalise(draft)

            const isCurrent = /present/i.test(dateMatch[2])
            DATE_RANGE_RE.lastIndex = 0
            const clientRaw = normLine
                .replace(DATE_RANGE_RE, '')
                .replace(/[|,\-–—]+\s*$/, '')
                .replace(/^\s*[|,\-–—]+/, '')
                .trim()

            draft = {
                client: clientRaw || 'Client',
                startDate: parseMonthYear(dateMatch[1]),
                endDate: isCurrent ? null : parseMonthYear(dateMatch[2]),
                isCurrent,
                bullets: [],
            }
        } else if (draft) {
            const cleaned = line.replace(/^[-–—*•◦▪►]\s*/, '').trim()
            if (cleaned) draft.bullets.push(cleaned)
        }
    }

    if (draft) finalise(draft)
    return engagements
}

// ── Education extraction ────────────────────────────────────────────────────

const DEGREE_RE =
    /\b(?:ph\.?d|doctorate|m\.?tech|b\.?tech|m\.?sc|b\.?sc|m\.?s|b\.?s|m\.?b\.?a|b\.?b\.?a|m\.?c\.?a|b\.?c\.?a|m\.?e|b\.?e|m\.?a|b\.?a|b\.?com|m\.?com|diploma|associate|bachelor(?:'?s)?|master(?:'?s)?)\b[.\w]*/i

const FIELD_RE = /\b(?:in|of)\s+([A-Za-z][A-Za-z\s&,'-]{2,60})/i
const GRADE_RE = /\b(?:cgpa|gpa|percentage|score)\s*[:\-]?\s*([\d.]+\s*(?:\/\s*[\d.]+)?%?)|\b(\d{1,2}\.\d{1,2})\s*\/\s*(?:10|4)\b|\b(\d{2}(?:\.\d+)?)\s*%/i

/**
 * Parse the EDUCATION section into structured entries.
 * An entry is anchored by a line containing a degree keyword or a year.
 * Conservative: only fields actually present in the text are populated.
 */
function extractEducation(text: string): ParsedEducation[] {
    const section = extractSection(text, ['EDUCATION', 'ACADEMIC BACKGROUND'])
    if (!section) return []

    const entries: ParsedEducation[] = []
    const sectionLines = section.split('\n').map(l => l.trim()).filter(Boolean)

    let current: ParsedEducation | null = null
    // Institution frequently precedes the degree line:
    //     Some University, City, Country
    //     Bachelor of Engineering in Information Technology 2021 - 2025
    let prevEduLine = ''

    for (const rawEduLine of sectionLines) {
        const line = stripPageFurniture(rawEduLine)
        const cleaned = line.replace(/^[-–—*•◦▪►]\s*/, '').trim()
        if (!cleaned) { prevEduLine = ''; continue }

        const degreeMatch = cleaned.match(DEGREE_RE)
        DATE_RANGE_RE.lastIndex = 0
        const rangeMatch = DATE_RANGE_RE.exec(cleaned.replace(/\bcurrent\b/gi, 'Present'))
        const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/)

        const startsEntry = !!degreeMatch || (!current && (!!rangeMatch || !!yearMatch))

        if (startsEntry) {
            if (current) entries.push(current)

            let start_date: string | null = null
            let end_date: string | null = null
            if (rangeMatch) {
                start_date = parseMonthYear(rangeMatch[1])
                end_date = /present/i.test(rangeMatch[2]) ? null : parseMonthYear(rangeMatch[2])
            } else if (yearMatch) {
                end_date = `${yearMatch[0]}-01-01`
            }

            // Institution = the line with dates and degree stripped out.
            DATE_RANGE_RE.lastIndex = 0
            let institution = cleaned
                .replace(DATE_RANGE_RE, '')
                .replace(/\b(19|20)\d{2}\b/g, '')
                .replace(DEGREE_RE, '')
                .replace(/[|,–—-]{1,2}\s*$/, '')
                .replace(/^\s*[|,–—-]{1,2}/, '')
                .trim()

            const fieldMatch = cleaned.match(FIELD_RE)
            const field_of_study = fieldMatch ? fieldMatch[1].trim().replace(/\s{2,}/g, ' ') : null
            if (field_of_study) {
                institution = institution.replace(new RegExp(`\\b(?:in|of)\\s+${field_of_study.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '').trim()
            }
            institution = institution.replace(/^[,\-–—|]+|[,\-–—|]+$/g, '').trim()

            const gradeMatch = cleaned.match(GRADE_RE)
            const grade = gradeMatch ? (gradeMatch[1] || gradeMatch[2] || gradeMatch[3] || null) : null

            // When the anchor line is purely a degree ("B.Tech in Computer Science"),
            // nothing is left for the institution. Prefer the line immediately above
            // (the common "Institution / Degree + dates" layout); otherwise leave it
            // empty so a following line can fill it. Never mislabel degree text as
            // the institution.
            const anchorIsDegreeOnly = !!degreeMatch && institution.length < 3
            if (anchorIsDegreeOnly && prevEduLine && !DEGREE_RE.test(prevEduLine)) {
                institution = prevEduLine
            }

            current = {
                institution: anchorIsDegreeOnly ? institution : (institution || cleaned),
                degree: degreeMatch ? degreeMatch[0].trim() : null,
                field_of_study,
                start_date,
                end_date,
                grade,
            }
        } else if (current) {
            // Continuation line: fill only fields still unknown.
            if (!current.field_of_study) {
                const fm = cleaned.match(FIELD_RE)
                if (fm) current.field_of_study = fm[1].trim()
            }
            if (!current.grade) {
                const gm = cleaned.match(GRADE_RE)
                if (gm) current.grade = gm[1] || gm[2] || gm[3] || null
            }
            // Only adopt a continuation line as the institution if it does not read
            // as a grade/detail line ("CGPA: 8.71"), which is not an institution.
            if ((!current.institution || current.institution.length < 3) && !GRADE_RE.test(cleaned)) {
                current.institution = cleaned
            }
        }

        prevEduLine = cleaned
    }

    if (current) entries.push(current)
    return entries.filter(e => e.institution && e.institution.length > 1)
}

// ── Certification extraction ────────────────────────────────────────────────

const ISSUER_SPLIT_RE = /\s+(?:by|from|[-–—|,])\s+/i
const CREDENTIAL_ID_RE = /\b(?:credential\s*id|cert(?:ificate)?\s*(?:id|no|number))\s*[:\-]?\s*([A-Za-z0-9-]{3,})/i

/**
 * Parse the CERTIFICATIONS section into structured entries — one per line.
 * Conservative: issuer/date only when the line actually contains them.
 */
function extractCertifications(text: string): ParsedCertification[] {
    const section = extractSection(text, [
        'CERTIFICATIONS', 'CERTIFICATES', 'CERTIFICATIONS & LICENSES',
    ])
    if (!section) return []

    const results: ParsedCertification[] = []
    const seen = new Set<string>()

    for (const rawLine of section.split('\n')) {
        const cleaned = rawLine.replace(/^[-–—*•◦▪►]\s*/, '').trim()
        if (!cleaned || cleaned.length < 3 || cleaned.endsWith(':')) continue

        const credMatch = cleaned.match(CREDENTIAL_ID_RE)
        const credential_id = credMatch ? credMatch[1] : null

        let working = cleaned.replace(CREDENTIAL_ID_RE, '').trim()

        // Dates
        let issue_date: string | null = null
        let expiry_date: string | null = null
        DATE_RANGE_RE.lastIndex = 0
        const range = DATE_RANGE_RE.exec(working.replace(/\bcurrent\b/gi, 'Present'))
        if (range) {
            issue_date = parseMonthYear(range[1])
            expiry_date = /present/i.test(range[2]) ? null : parseMonthYear(range[2])
            DATE_RANGE_RE.lastIndex = 0
            working = working.replace(DATE_RANGE_RE, '').trim()
        } else {
            const single = working.match(
                /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*\.?\s*\d{4}|\b(?:19|20)\d{2}\b/i
            )
            if (single) {
                issue_date = parseMonthYear(single[0])
                working = working.replace(single[0], '').trim()
            }
        }

        working = working.replace(/[(),|]+\s*$/, '').replace(/^\s*[(),|]+/, '').trim()
        if (!working) continue

        // Issuer, when the line separates it explicitly
        let name = working
        let issuer: string | null = null
        const parts = working.split(ISSUER_SPLIT_RE)
        if (parts.length >= 2 && parts[0].trim().length > 2 && parts[1].trim().length > 1) {
            name = parts[0].trim()
            issuer = parts.slice(1).join(' ').trim() || null
        }

        name = name.replace(/[,\-–—|]+$/, '').trim()
        if (!name) continue

        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)

        results.push({ name, issuer, issue_date, expiry_date, credential_id })
    }

    return results
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
    return parseResumeText(text)
}

/**
 * Parse already-extracted resume text. Split out from parseResume so the parsing
 * logic is testable without a PDF/DOCX fixture.
 *
 * Fully deterministic — no LLM, no network, no API cost.
 */
export function parseResumeText(text: string): ParsedResumeData {
    const profile = extractProfile(text)
    const skills = extractSkills(text)
    const experience = extractExperience(text)
    const engagements = extractEngagements(text, experience)
    const education = extractEducation(text)
    const certifications = extractCertifications(text)

    // Technologies named inside client engagements are real resume content and
    // must reach job matching. Merge any not already declared in the skills
    // section, marked non-primary so explicitly-listed skills keep precedence.
    // Bounded by the dictionary, so nothing is invented.
    const declaredNames = skills.map(s => s.skill_name.toLowerCase())
    const declared = new Set(declaredNames)

    /**
     * True when the term is already covered by a declared skill — either exactly,
     * or as a sub-phrase of one. Prevents "LWC" / "Lightning Web Components" /
     * "Visualforce" piling up alongside "Lightning Web Components (LWC)" and
     * "Visualforce Pages".
     */
    const isCoveredByDeclared = (term: string): boolean => {
        const t = term.toLowerCase()
        if (declared.has(t)) return true
        return declaredNames.some(d => d.includes(t) || t.includes(d))
    }

    for (const eng of engagements) {
        for (const tech of eng.technologies) {
            const key = tech.toLowerCase()
            if (isCoveredByDeclared(tech)) continue
            declared.add(key)
            declaredNames.push(key)
            skills.push({
                skill_name: tech,
                category: categorizeSkill(tech),
                proficiency_level: null,
                years_used: null,
                is_primary: false,
            })
        }
    }

    // Derive years-of-experience fallback from experience dates when no explicit value was found
    if (profile.years_of_experience === null) {
        profile.years_of_experience = deriveYearsOfExperienceFromDates(experience)
    }

    return { profile, skills, experience, engagements, education, certifications, raw_text: text }
}
