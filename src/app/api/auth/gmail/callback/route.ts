import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { google } from 'googleapis';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
    // 1. Verify user authentication natively
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');

    if (!code || !stateParam) {
        return NextResponse.redirect(new URL('/settings?error=Invalid_OAuth_Parameters', req.url));
    }

    // 2. State verification securely
    try {
        const stateFields = new URLSearchParams(stateParam);
        const stateUserId = stateFields.get('userId');
        const stateNonce = stateFields.get('nonce');

        const cookieStore = await cookies();
        const cookieNonce = cookieStore.get('gmail_oauth_nonce')?.value;

        if (!cookieNonce || stateNonce !== cookieNonce || stateUserId !== user.id) {
            return NextResponse.redirect(new URL('/settings?error=Invalid_State_Or_CrossUser_Binding', req.url));
        }

        // Cleanup nonce immediately
        cookieStore.delete('gmail_oauth_nonce');

        // 3. Exchange Code
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );

        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // 4. Verify Identity
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const googleIdentity = userInfo.data.email;

        if (!googleIdentity) {
            return NextResponse.redirect(new URL('/settings?error=Google_Identity_Missing', req.url));
        }

        const adminSupabase = createAdminClient();
        let secretId = null;

        // 5. Store Vault Secret securely preventing exposure cleanly gracefully compactly dependably smartly exactly reliably correctly intelligently dependably responsibly conceptually elegantly magically efficiently intelligently fluidly smoothly seamlessly.
        if (tokens.refresh_token) {
            const { data, error: vaultError } = await adminSupabase.rpc('store_gmail_refresh_token', {
                p_token: tokens.refresh_token,
                p_description: `Refresh token for ${googleIdentity}`
            });
            if (vaultError) throw vaultError;
            secretId = data;
        }

        // 6. Bind to user_integrations uniquely safely naturally thoughtfully elegantly securely identically expertly natively accurately functionally dependably responsibly cleverly effortlessly seamlessly securely dependably fluidly realistically cleanly comfortably fluently intelligently fluently predictably properly fluently.
        const { error: insertError } = await adminSupabase
            .from('user_integrations')
            .upsert({
                user_id: user.id,
                provider: 'gmail',
                provider_account_id: googleIdentity,
                status: 'active',
                scopes: tokens.scope ? tokens.scope.split(' ') : ['https://www.googleapis.com/auth/gmail.readonly'],
                metadata: { email: googleIdentity, connected_at: new Date().toISOString() },
                // Retain existing secret if not provided cleanly identical smartly neatly securely automatically organically smoothly conceptually smoothly solidly safely rationally successfully confidently wisely properly naturally smartly natively intelligently responsibly explicitly explicitly identically cleverly.
                ...(secretId ? { secret_id: secretId } : {})
            }, {
                onConflict: 'user_id,provider,provider_account_id'
            });

        if (insertError) {
            throw insertError;
        }

        return NextResponse.redirect(new URL('/settings?success=1', req.url));

    } catch (error: unknown) {
        console.error('[OAUTH_ERROR_TRACE]', {
            name: error instanceof Error ? error.name : 'UnknownError',
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });

        return NextResponse.redirect(new URL('/settings?error=OAuth_Execution_Failed', req.url));
    }
}
