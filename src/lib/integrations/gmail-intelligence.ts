import 'server-only';
import { getAuthorizedGmailClient } from '@/lib/integrations/gmail-client';
import { createAdminClient } from '@/lib/supabase/admin';

type DetectedType = 'application_received' | 'interview' | 'assessment' | 'offer' | 'rejection' | 'recruiter_contact' | 'unknown';

interface IntelligenceResult {
    message_id: string;
    thread_id: string;
    detected_type: DetectedType;
    confidence: 'high' | 'medium' | 'low' | 'none';
    matched_application_id: string | null;
    matched_job_id: string | null;
    sender_domain: string | null;
    processed_at: string;
    subject: string | null;
}

export async function processGmailIntelligence(userId: string, integrationId: string, options: { maxMessages?: number } = {}) {
    const adminSupabase = createAdminClient();

    // 1. Verify ownership strictly avoiding client-trust payloads
    const { data: verifyAuth } = await adminSupabase
        .from('user_integrations')
        .select('id, provider, status')
        .eq('id', integrationId)
        .eq('user_id', userId)
        .single();

    if (!verifyAuth || verifyAuth.provider !== 'gmail' || verifyAuth.status !== 'active') {
        return { success: false, error: 'Unauthorized or invalid integration.' };
    }

    // 2. Authenticate & initialize (M9.2 Boundary explicitly respected without touching raw tokens)
    const gmail = await getAuthorizedGmailClient(userId, integrationId);

    // 3. Fetch list of potential emails (conservative heuristic querying bounds)
    const limit = options.maxMessages || 50;
    const query = 'subject:application OR subject:interview OR subject:offer OR subject:rejection OR subject:assessment OR "next steps"';

    let messagesResponse;
    try {
        messagesResponse = await gmail.users.messages.list({
            userId: 'me',
            maxResults: limit,
            q: query
        });
    } catch (e) {
        console.error('Gmail API list failed', e);
        return { success: false, error: 'Failed to access Gmail inbox safely.' };
    }

    const messages = messagesResponse.data.messages || [];
    if (messages.length === 0) return { success: true, processed: 0 };

    // 4. Process loop
    let processedCount = 0;
    for (const msg of messages) {
        if (!msg.id) continue;
        const msgId = msg.id;
        const threadId = msg.threadId || msgId;
        const idempotencyKey = `gmail_msg_intel:${msgId}`;

        // Idempotency: Check if already processed
        const { data: existingTask } = await adminSupabase
            .from('integration_tasks')
            .select('id')
            .eq('integration_id', integrationId)
            .eq('idempotency_key', idempotencyKey)
            .single();

        if (existingTask) {
            continue; // Already processed idempotently
        }

        // Fetch msg metadata securely without downloading massive email bodies
        let msgDetails;
        try {
            msgDetails = await gmail.users.messages.get({
                userId: 'me',
                id: msgId,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'Date']
            });
        } catch (e) {
            console.error(`Failed to fetch metadata for ${msgId}`, e);
            continue; // Fail isolated
        }

        const headers = msgDetails.data.payload?.headers || [];
        const subject = headers.find((h: { name?: string | null; value?: string | null }) => h.name?.toLowerCase() === 'subject')?.value || '';
        const from = headers.find((h: { name?: string | null; value?: string | null }) => h.name?.toLowerCase() === 'from')?.value || '';
        const snippet = msgDetails.data.snippet || '';

        // Extract sender domain strictly safely
        let senderDomain: string | null = null;
        let senderName: string | null = null;
        const emailMatch = from.match(/<([^>]+)>/);
        const rawEmail = emailMatch ? emailMatch[1] : from;
        const nameMatch = from.match(/^([^<]+)</);

        if (nameMatch) {
            senderName = nameMatch[1].replace(/"/g, '').trim();
        }

        if (rawEmail && rawEmail.includes('@')) {
            senderDomain = rawEmail.split('@')[1].toLowerCase().trim();
        }

        // 5. Intelligence Classification
        const classifyResult = classifyIntelligence(subject, snippet, from);

        // 6. Secure Application Correlation
        let matchedAppId: string | null = null;
        let matchedJobId: string | null = null;
        let matchedCompany: string | null = null;

        if (senderDomain || senderName) {
            // Find all applications for this user securely
            const { data: apps } = await adminSupabase
                .from('applications')
                .select(`
                    id,
                    job_id,
                    jobs (
                         id,
                         company_name,
                         company_domain
                    )
                `)
                .eq('user_id', userId);

            if (apps && apps.length > 0) {
                const candidates = apps.filter(app => {
                    const jobData = app.jobs as unknown as { id: string; company_name: string; company_domain: string | null } | { id: string; company_name: string; company_domain: string | null }[] | null | undefined;
                    const job = Array.isArray(jobData) ? jobData[0] : jobData;
                    if (!job) return false;

                    const domainMatch = senderDomain && job.company_domain && job.company_domain.toLowerCase() === senderDomain;
                    // Strict heuristic matching
                    const safeJobCompany = job.company_name ? job.company_name.toLowerCase() : null;
                    const nameMatch = senderName && safeJobCompany && senderName.toLowerCase().includes(safeJobCompany);
                    const subjectMatch = subject && safeJobCompany && subject.toLowerCase().includes(safeJobCompany);

                    return domainMatch || nameMatch || subjectMatch;
                });

                if (candidates.length === 1) { // Only if confident strictly non-ambiguous match
                    const matchedJobData = candidates[0].jobs as unknown as { id: string; company_name: string; company_domain: string | null } | { id: string; company_name: string; company_domain: string | null }[] | null;
                    const matchedJob = Array.isArray(matchedJobData) ? matchedJobData[0] : matchedJobData;
                    if (matchedJob) {
                        matchedAppId = candidates[0].id;
                        matchedJobId = matchedJob.id;
                        matchedCompany = matchedJob.company_name;
                    }
                }
            }
        }

        // 7. Persistence & Notification boundary check (preserves M7 constraints)
        const resultPayload: IntelligenceResult = {
            message_id: msgId,
            thread_id: threadId,
            detected_type: classifyResult.type,
            confidence: classifyResult.confidence,
            matched_application_id: matchedAppId,
            matched_job_id: matchedJobId,
            sender_domain: senderDomain,
            processed_at: new Date().toISOString(),
            subject: subject.substring(0, 200) // Safe truncation
        };

        const { error: insertError } = await adminSupabase
            .from('integration_tasks')
            .insert({
                user_id: userId,
                integration_id: integrationId,
                task_type: 'gmail_application_intelligence',
                status: 'completed',
                idempotency_key: idempotencyKey,
                result: resultPayload as unknown as Record<string, string | null>
            });

        // Trigger notification asynchronously bypassing RLS only if confident match is detected
        // Defensible boundary: Never call update_application_status directly!
        if (!insertError && matchedAppId && classifyResult.type !== 'unknown' && classifyResult.type !== 'recruiter_contact') {
            const dedupKey = `gmail_intel:${matchedAppId}:${msgId}`;
            const actionText = classifyResult.type.replace('_', ' ');

            await adminSupabase.from('notifications').insert({
                user_id: userId,
                title: 'Application Update Detected',
                message: `We detected a possible ${actionText} from ${matchedCompany || 'a recruiter'}. Would you like to review your application?`,
                type: 'gmail_intelligence',
                reference_id: matchedAppId,
                dedup_key: dedupKey
            });
        }

        processedCount++;
    }

    return { success: true, processed: processedCount };
}

/**
 * Highly conservative rule engine exclusively tracking explicitly bounded terms stably. No LLMs, avoiding unpredictability natively.
 */
function classifyIntelligence(subject: string, snippet: string, from: string): { type: DetectedType, confidence: 'high' | 'medium' | 'low' | 'none' } {
    const fullText = `${subject} ${snippet}`.toLowerCase();

    if (fullText.includes('interview') || fullText.includes('schedule a call') || fullText.includes('time to chat')) {
        return { type: 'interview', confidence: 'high' };
    }
    if (fullText.includes('offer letter') || fullText.includes('job offer') || fullText.includes('extend an offer')) {
        return { type: 'offer', confidence: 'high' };
    }
    if ((fullText.includes('unfortunately') || fullText.includes('not moving forward') || fullText.includes('other candidates') || fullText.includes('careful consideration')) && !fullText.includes('we have received')) {
        return { type: 'rejection', confidence: 'high' };
    }
    if ((fullText.includes('application received') || fullText.includes('thanks for applying') || subject.includes('application')) && !fullText.includes('unfortunately')) {
        return { type: 'application_received', confidence: 'medium' };
    }
    if (fullText.includes('assessment') || fullText.includes('online test') || fullText.includes('take-home')) {
        return { type: 'assessment', confidence: 'medium' };
    }
    if (from.toLowerCase().includes('talent') || from.toLowerCase().includes('recruiting') || from.toLowerCase().includes('careers')) {
        return { type: 'recruiter_contact', confidence: 'low' };
    }

    return { type: 'unknown', confidence: 'none' };
}
