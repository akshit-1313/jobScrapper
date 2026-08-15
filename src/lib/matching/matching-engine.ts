import { JobWithLocationsAndSkills } from "../types/jobs";
import { Profile, CandidateSkill, CandidateExperience, CandidatePreferences } from "../types/profile";
import { normalizeSkill, isSkillMatch } from "./skill-normalizer";

export type CandidateState = {
    profile: Profile | null;
    skills: CandidateSkill[];
    experience: CandidateExperience[];
    preferences: CandidatePreferences | null;
};

export type MatchResult = {
    overall_score: number;
    skills_score: number;
    experience_score: number;
    role_score: number;
    location_score: number;
    work_mode_score: number;
    seniority_score: number;
    emp_type_score: number;

    matching_skills: string[];
    missing_required_skills: string[];
    missing_preferred_skills: string[];
    positive_reasons: string[];
    concerns: string[];
    recommendation: 'strong_match' | 'good_match' | 'possible_match' | 'weak_match' | 'skip';
};

export class DeterministicMatcher {

    static match(candidate: CandidateState, job: JobWithLocationsAndSkills): MatchResult {
        const positive_reasons: string[] = [];
        const concerns: string[] = [];

        const descriptionNorm = (job.description || '').toLowerCase();

        let hardIncompatibility = false;

        // 1. Role Match (20%)
        let role_score = 0;
        const candidateTitles = [
            candidate.profile?.headline || '',
            ...(candidate.preferences?.desired_roles || []),
            ...candidate.experience.map(e => e.title)
        ].map(t => t.toLowerCase()).filter(Boolean);

        const jobTitleNorm = job.title.toLowerCase();
        const roleExcluded = candidate.preferences?.excluded_roles?.some(er => jobTitleNorm.includes(er.toLowerCase()));

        if (roleExcluded) {
            hardIncompatibility = true;
            role_score = 0;
            concerns.push(`Job role '${job.title}' is in your excluded roles.`);
        } else {
            // Very simple deterministic title inclusion
            let matchCount = 0;
            for (const t of candidateTitles) {
                if (t === jobTitleNorm) { role_score = 100; positive_reasons.push(`Exact role match: ${job.title}.`); break; }
                if (jobTitleNorm.includes(t) || t.includes(jobTitleNorm)) {
                    matchCount++;
                }
            }
            if (role_score === 0) {
                if (matchCount > 0) {
                    role_score = 80;
                    positive_reasons.push(`Strong role similarity to ${job.title}.`);
                } else {
                    // Check if candidate titles appear in description (proving description materiality)
                    let containedInDesc = 0;
                    for (const t of candidateTitles) {
                        if (t.length > 3 && new RegExp(`\\b${t}\\b`, 'i').test(descriptionNorm)) containedInDesc++;
                    }
                    if (containedInDesc > 0) {
                        role_score = 60;
                        positive_reasons.push(`Job description reflects your experience in related roles.`);
                    } else {
                        role_score = 20; // Weak default
                        concerns.push(`Job role is largely unrelated to your stated experience.`);
                    }
                }
            }
        }

        // 2. Skills Match (35%)
        let skills_score = 0;
        const matching_skills: string[] = [];
        const missing_required_skills: string[] = [];
        const missing_preferred_skills: string[] = [];

        const candidateSkillSet = new Set(candidate.skills.map(s => normalizeSkill(s.skill_name)));

        // Enhance explicit job_skills by parsing the description deterministically to correct LLM-extracted schema inaccuracies
        const explicityRequired: string[] = [];
        const explicityPreferred: string[] = [];

        for (const s of (job.job_skills || [])) {
            const norm = normalizeSkill(s.skill_name);
            let isReq = s.is_required;

            // Safe pattern for skill name bounded searching
            const sPat = norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const reqPattern = new RegExp(`(required|must have|mandatory|essential|minimum).{0,60}\\b${sPat}\\b|\\b${sPat}\\b.{0,60}(required|must have|mandatory|essential|minimum)`, 'i');
            const prefPattern = new RegExp(`(preferred|nice to have|bonus|plus|desirable).{0,60}\\b${sPat}\\b|\\b${sPat}\\b.{0,60}(preferred|nice to have|bonus|plus|desirable)`, 'i');

            if (!isReq && reqPattern.test(descriptionNorm)) {
                isReq = true;
            } else if (isReq && prefPattern.test(descriptionNorm) && !reqPattern.test(descriptionNorm)) {
                isReq = false; // Demote if strictly contextualized as a bonus
            }

            if (isReq) explicityRequired.push(norm);
            else explicityPreferred.push(norm);
        }

        // For skills not strictly in job schemas, check if candidate's stated skills appear in description (material impact)
        let matchedByDescription = 0;
        for (const cSkill of candidateSkillSet) {
            if (cSkill.length > 2 && new RegExp(`\\b${cSkill}\\b`, 'i').test(descriptionNorm)) {
                if (!explicityRequired.includes(cSkill) && !explicityPreferred.includes(cSkill)) {
                    // The job mentions the skill in description even if not tagged explicitly
                    matching_skills.push(cSkill);
                    matchedByDescription++;
                }
            }
        }

        // Process explicitly Required
        let reqMatched = 0;
        for (const req of explicityRequired) {
            if (candidateSkillSet.has(req)) {
                reqMatched++;
                matching_skills.push(req);
            } else {
                // Determine if it was just organically in the description attached to 'required'
                // This is a naive heuristic just for deterministic coverage if `job_skills` was malformed
                missing_required_skills.push(req);
            }
        }

        // Process explicitly Preferred
        let prefMatched = 0;
        for (const pref of explicityPreferred) {
            if (candidateSkillSet.has(pref)) {
                prefMatched++;
                matching_skills.push(pref);
            } else {
                missing_preferred_skills.push(pref);
            }
        }

        // Score required strictly
        if (explicityRequired.length > 0) {
            const reqRatio = reqMatched / explicityRequired.length;
            skills_score += reqRatio * 75; // 75 of the skill score bounds to required
            if (reqRatio === 1) positive_reasons.push('Matches all required skills.');
            else if (reqRatio >= 0.5) { /* neutral */ }
            else { concerns.push(`Missing critical required skills (${missing_required_skills.join(', ')}).`); }
        } else {
            skills_score += 75; // Default safe bound if no hard required skills listed
        }

        if (explicityPreferred.length > 0) {
            const prefRatio = prefMatched / explicityPreferred.length;
            skills_score += prefRatio * 25;
        } else {
            skills_score += Math.min(25, matchedByDescription * 5); // bonus from description matches
        }
        skills_score = Math.min(100, skills_score);

        // Preference Excluded Skills handling
        if (candidate.preferences?.excluded_skills?.length) {
            for (const excl of candidate.preferences.excluded_skills) {
                const normExcl = normalizeSkill(excl);
                if (explicityRequired.includes(normExcl) || new RegExp(`\\b${normExcl}\\b`, 'i').test(descriptionNorm)) {
                    hardIncompatibility = true;
                    skills_score = 0;
                    concerns.push(`Job contains excluded skill: ${excl}.`);
                }
            }
        }

        // 3. Experience Match (15%)
        let experience_score = 100;

        let candExp = candidate.profile?.years_of_experience;
        if (candExp === undefined || candExp === null) {
            let totalMonths = 0;
            const now = new Date();
            for (const exp of candidate.experience) {
                const start = new Date(exp.start_date);
                const end = exp.is_current || !exp.end_date ? now : new Date(exp.end_date);
                if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
                    const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
                    if (months > 0) totalMonths += months;
                }
            }
            candExp = totalMonths > 0 ? totalMonths / 12 : 0;
        }

        if (job.experience_min !== null && job.experience_min !== undefined) {
            if (candExp < job.experience_min) {
                experience_score = Math.max(0, 100 - ((job.experience_min - candExp) * 20));
                concerns.push(`Candidate experience (${Math.round(candExp)}y) is below required minimum (${job.experience_min}y).`);
            } else if (job.experience_max && candExp > job.experience_max + 3) {
                // Overqualified penalty only if extremely overqualified
                experience_score -= 20;
                concerns.push(`Candidate might be overqualified (Max ${job.experience_max}y preferred).`);
            } else {
                positive_reasons.push('Experience level fits perfectly.');
                experience_score = 100;
            }
        } else {
            // Try to extract experience heuristically from description if Job doesn't have it explicitly bound
            const expMatch = descriptionNorm.match(/(\d+)[\+ -]*years?\s+of\s+experience/);
            if (expMatch && parseInt(expMatch[1]) > (candExp + 1)) {
                experience_score = 60;
            }
        }

        // 4. Location & Work Mode Match (20%)
        // Split weight: Location (10), Mode (10)
        let location_score = 100;
        let work_mode_score = 100;

        const candPrefs = candidate.preferences || {} as CandidatePreferences;

        // Work Mode handling
        const prefModes = (candPrefs.work_modes || []).map((m: string) => m.toLowerCase());
        const jobMode = (job.work_mode || '').toLowerCase();

        if (prefModes.length > 0 && jobMode && jobMode !== 'unknown') {
            const wantsAny = prefModes.includes('any');
            const modeFound = prefModes.includes(jobMode);
            if (!wantsAny && !modeFound) {
                work_mode_score = 0;
                hardIncompatibility = true;
                concerns.push(`Job work mode (${jobMode}) does not match your preferences.`);
            } else {
                positive_reasons.push(`Work mode matches preference.`);
            }
        }

        // Location handling
        const prefGeos = (candPrefs.geographic_preferences || []).map((g: string) => g.toLowerCase());
        const isRemote = jobMode === 'remote';

        if (prefGeos.length > 0) {
            let locationMatched = false;
            const checkRegions = [...job.job_locations.map(l => l.country), ...job.job_locations.map(l => l.city)].filter(Boolean).map(s => s!.toLowerCase());
            if (isRemote && job.remote_scope) checkRegions.push(job.remote_scope.toLowerCase());

            if (checkRegions.length > 0) {
                for (const geo of prefGeos) {
                    if (geo === 'worldwide' || geo === 'any') { locationMatched = true; break; }
                    if (checkRegions.some(cr => cr.includes(geo) || geo.includes(cr))) {
                        locationMatched = true;
                        break;
                    }
                }

                if (!locationMatched) {
                    // One last check in the description
                    if (prefGeos.some((geo: string) => geo !== 'worldwide' && new RegExp(`\\b${geo}\\b`, 'i').test(descriptionNorm))) {
                        locationMatched = true;
                    } else {
                        location_score = 0;
                        if (!isRemote || (isRemote && job.remote_scope && job.remote_scope.toLowerCase() !== 'worldwide')) {
                            // If it's worldwide remote we wouldn't heavily penalise, but if there's a scope...
                            hardIncompatibility = true;
                            concerns.push('Job location/remote-scope does not match geographic preferences.');
                        }
                    }
                }
            }
        }

        // 5. Seniority (10%)
        let seniority_score = 100;
        const candSeniorityMatch = (candAcc: string) => {
            if (candAcc.includes('principal') || candAcc.includes('director')) return 5;
            if (candAcc.includes('senior') || candAcc.includes('lead') || candAcc.includes('manager')) return 4;
            if (candAcc.includes('mid')) return 3;
            if (candAcc.includes('junior')) return 2;
            if (candAcc.includes('intern')) return 1;
            return 3; // Default Mid
        }

        const candidateComposite = candidateTitles.join(' ');
        const cS = candSeniorityMatch(candidateComposite);
        const jS = candSeniorityMatch(jobTitleNorm + ' ' + descriptionNorm.substring(0, 500)); // check top of JD

        if (jS > cS + 1) { // Job requires MUCH higher
            seniority_score = 30;
            concerns.push('Job appears to require a higher seniority level.');
        } else if (cS > jS + 1) {
            seniority_score = 70;
            // usually fine, slight knock
        }


        // 6. Employment Type (5%)
        let emp_type_score = 100;
        if (candPrefs.employment_type && candPrefs.employment_type !== 'any') {
            if (job.employment_type && job.employment_type !== 'unknown') {
                if (candPrefs.employment_type !== job.employment_type) {
                    emp_type_score = 0;
                    concerns.push(`Job employment type (${job.employment_type}) doesn't match your preference (${candPrefs.employment_type}).`);
                } else {
                    positive_reasons.push('Employment type matches your preference.');
                }
            }
        }

        // Combine Scores
        let overall_score = (
            (role_score * 0.20) +
            (skills_score * 0.35) +
            (experience_score * 0.15) +
            (location_score * 0.10) +
            (work_mode_score * 0.10) +
            (seniority_score * 0.05) +
            (emp_type_score * 0.05)
        );

        if (hardIncompatibility) {
            overall_score = Math.min(overall_score, 35); // Hard cap on dealbreakers
        }

        let recommendation: MatchResult['recommendation'] = 'skip';
        if (overall_score >= 85) recommendation = 'strong_match';
        else if (overall_score >= 70) recommendation = 'good_match';
        else if (overall_score >= 55) recommendation = 'possible_match';
        else if (overall_score >= 40) recommendation = 'weak_match';

        // Limit positive reasons to top 3 to keep UX clean
        const finalPositive = positive_reasons.slice(0, 3);
        const finalConcerns = concerns.slice(0, 3);

        return {
            overall_score: Math.round(overall_score * 10) / 10,
            skills_score: Math.round(skills_score * 10) / 10,
            experience_score: Math.round(experience_score * 10) / 10,
            role_score: Math.round(role_score * 10) / 10,
            location_score: Math.round(location_score * 10) / 10,
            work_mode_score: Math.round(work_mode_score * 10) / 10,
            seniority_score: Math.round(seniority_score * 10) / 10,
            emp_type_score: Math.round(emp_type_score * 10) / 10,
            matching_skills: [...new Set(matching_skills)],
            missing_required_skills,
            missing_preferred_skills,
            positive_reasons: finalPositive,
            concerns: finalConcerns,
            recommendation
        };
    }
}
