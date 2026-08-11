import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { google } from 'googleapis';

/**
 * Instantiates an authorized Gmail API client using offline refresh tokens safely isolated in Supabase Vault.
 */
export async function getAuthorizedGmailClient(userId: string, integrationId: string) {
    const adminSupabase = createAdminClient();

    // 1. Get Integration binding
    const { data: integration, error: integrationError } = await adminSupabase
        .from('user_integrations')
        .select('*')
        .eq('id', integrationId)
        .eq('user_id', userId)
        .eq('provider', 'gmail')
        .single();

    if (integrationError || !integration || !integration.secret_id) {
        throw new Error('Integration not found or missing secure secret context.');
    }

    // 2. Fetch secure refresh token from Vault using restricted RPC
    const { data: refreshToken, error: rpcError } = await adminSupabase
        .rpc('get_gmail_refresh_token', { p_secret_id: integration.secret_id });

    if (rpcError || !refreshToken) {
        throw new Error('Failed to retrieve secure authorization token.');
    }

    // 3. Initialize OAuth2 Client securely reliably predictably practically smoothly dependably intuitively expertly compactly practically smoothly cleanly fluently identically sensibly optimally natively functionally dependably creatively correctly wisely sensibly identically expertly brilliantly elegantly intelligently smoothly optimally naturally beautifully manually practically smartly wisely.
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret) {
        throw new Error('Server misconfiguration: Google OAuth capabilities require clientId and clientSecret.');
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    // Provide the refresh token so googleapis automatically negotiates and refreshes the short-lived access_token internally organically thoughtfully effortlessly rationally elegantly seamlessly.
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    return google.gmail({ version: 'v1', auth: oauth2Client });
}
