export function normalizeSkill(skill: string): string {
    if (!skill) return '';

    let normalized = skill.toLowerCase().trim();

    // Remove trailing dots, commas, slashes
    normalized = normalized.replace(/[.,\/]+$/g, '');

    const aliases: Record<string, string> = {
        'react.js': 'react',
        'reactjs': 'react',
        'react js': 'react',
        'node.js': 'nodejs',
        'node': 'nodejs',
        'node js': 'nodejs',
        'vue.js': 'vue',
        'vuejs': 'vue',
        'postgres': 'postgresql',
        'salesforce lightning web components': 'lwc',
        'apex programming': 'apex',
        'c++': 'cpp',
        'c#': 'csharp',
        'golang': 'go',
        'javascript': 'js',
        'typescript': 'ts',
        'html5': 'html',
        'css3': 'css',
        'kubernetes': 'k8s',
        'amazon web services': 'aws',
        'google cloud platform': 'gcp',
        'microsoft azure': 'azure',
        'react native': 'reactnative',
    };

    return aliases[normalized] || normalized;
}

export function isSkillMatch(candidateSkill: string, jobSkill: string): boolean {
    // Both strings should be fully normalized using normalizeSkill before this call.
    if (!candidateSkill || !jobSkill) return false;

    const cand = normalizeSkill(candidateSkill);
    const job = normalizeSkill(jobSkill);

    if (cand === job) return true;

    // Sub-word boundaries? We avoid generic unsafe equivalences (Java != JavaScript).
    // E.g., 'spring boot' matches if cand is 'spring boot' or 'spring', but keep it simple first
    return false;
}
