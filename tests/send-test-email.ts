import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });

async function run() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Get integration
    const { data: integrations } = await supabase.from('user_integrations').select('*').limit(1);
    if (!integrations || integrations.length === 0) {
        console.error('No integrations found.');
        return;
    }
    const integration = integrations[0];

    // Get token
    const { data: token } = await supabase.rpc('get_gmail_refresh_token', { p_secret_id: integration.secret_id });
    if (!token) {
        console.error('Failed to get token');
        return;
    }

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: token });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Create email
    const subject = 'Interview invitation';
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
        `From: ${integration.provider_account_id}`,
        `To: ${integration.provider_account_id}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${utf8Subject}`,
        '',
        'This is to confirm your interview for the Software Engineer position. Please let us know if you are available tomorrow.'
    ];
    const message = messageParts.join('\n');
    const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
            raw: encodedMessage,
        },
    });

    console.log('Email sent successfully. Message ID:', res.data.id);
}

run().catch(console.error);
