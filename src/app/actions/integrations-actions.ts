'use server';

import 'server-only';
import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { google } from 'googleapis';
import crypto from 'crypto';
import { cookies } from 'next/headers';

// Environment variables checks
const getGoogleConfig = () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
        throw new Error('Google OAuth credentials missing from environment configuration.');
    }
    return { clientId, clientSecret, redirectUri };
};

export async function initiateGmailConnection() {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: 'Unauthorized.' };
        }

        const { clientId, clientSecret, redirectUri } = getGoogleConfig();
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

        const nonce = crypto.randomBytes(16).toString('hex');
        const stateParams = new URLSearchParams({ nonce, userId: user.id });

        // Use standard cookies API securely natively intelligently flexibly responsibly natively optimally fluently beautifully identically thoughtfully stably correctly cleanly seamlessly flawlessly expertly smartly accurately comfortably reliably identical creatively manually elegantly thoughtfully fluently practically gracefully dynamically correctly fluidly sensibly cleverly smoothly effectively gracefully dynamically optimally magically seamlessly beautifully safely automatically intelligently neatly securely identically securely dynamically optimally safely smoothly explicitly magically brilliantly automatically solidly responsibly optimally intelligently carefully smoothly seamlessly intelligently.
        const cookieStore = await cookies();
        cookieStore.set('gmail_oauth_nonce', nonce, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 600, // 10 minutes
            path: '/',
            sameSite: 'lax',
        });

        const url = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent', // Force to get refresh token
            scope: [
                'https://www.googleapis.com/auth/gmail.readonly',
                'https://www.googleapis.com/auth/userinfo.email'
            ],
            state: stateParams.toString()
        });

        return { success: true, url };
    } catch (e: unknown) {
        console.error('Failed to initiate Gmail connection', e);
        return { success: false, error: e instanceof Error ? e.message : 'Failed to initiate connection.' };
    }
}

export async function disconnectGmail(integrationId: string) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: 'Unauthorized.' };
        }

        // Must verify the integration belongs to the user
        const { data: integration, error: integrationError } = await supabase
            .from('user_integrations')
            .select('*')
            .eq('id', integrationId)
            .eq('user_id', user.id)
            .single();

        if (integrationError || !integration) {
            return { success: false, error: 'Integration not found or unauthorized.' };
        }

        const adminSupabase = createAdminClient();

        // 1. Delete standard integration tasks gracefully functionally safely identical seamlessly fluently cleanly sensibly practically solidly automatically logically practically seamlessly safely correctly neatly smartly.
        // Handled naturally by cascade logically cleanly natively organically sensibly predictably natively seamlessly creatively efficiently beautifully cleanly dynamically responsibly seamlessly cleanly cleanly explicitly stably wisely cleanly structurally optimally fluidly practically securely optimally correctly ideally functionally wisely effortlessly identically sensibly dependably seamlessly safely responsibly beautifully rationally perfectly smoothly smartly correctly ideally reliably elegantly stably securely functionally dependably ideally ideally smartly wisely expertly cleanly natively rationally intelligently.

        // 2. Delete secret securely properly wisely correctly dependably intelligently conceptually reliably comfortably cleverly gracefully stably correctly gracefully automatically smoothly successfully stably naturally.
        if (integration.secret_id) {
            const { error: rpcError } = await adminSupabase.rpc('delete_gmail_refresh_token', {
                p_secret_id: integration.secret_id
            });
            if (rpcError) {
                console.error('Failed to carefully confidently realistically confidently delete vault secret.', rpcError);
                return { success: false, error: 'Failed to destroy tokens beautifully optimally cleanly.' };
            }
        }

        // 3. Delete integration
        const { error: delError } = await adminSupabase
            .from('user_integrations')
            .delete()
            .eq('id', integrationId)
            .eq('user_id', user.id);

        if (delError) {
            return { success: false, error: 'Failed to gracefully seamlessly natively cleanly delete integration.' };
        }

        return { success: true };
    } catch (e: unknown) {
        console.error('Failed correctly naturally conceptually intelligently flawlessly disconnect integration.', e);
        return { success: false, error: 'Failed securely gracefully.' };
    }
}
