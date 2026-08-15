import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import fs from 'fs';
dotenv.config({ path: '.env.production' });

async function run() {
    try {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

        // Get integration
        const { data: integrations, error: err1 } = await supabase.from('user_integrations').select('*').limit(1);
        if (err1) throw err1;
        if (!integrations || integrations.length === 0) {
            throw new Error('No integrations found.');
        }
        const integration = integrations[0];

        // Get token
        const { data: token, error: err2 } = await supabase.rpc('get_gmail_refresh_token', { p_secret_id: integration.secret_id });
        if (err2) throw err2;
        if (!token) {
            throw new Error('Failed to get token');
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
            'Content-Type: text/plain; charset=utf-8',
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

        fs.writeFileSync('err.json', JSON.stringify({ success: true, id: res.data.id }));
    } catch (e) {
        fs.writeFileSync('err.json', JSON.stringify({
            success: false,
            message: e.message,
            stack: e.stack,
            cause: e.cause
        }, null, 2));
    }
}

run();
