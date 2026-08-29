import { createClient } from '@/utils/supabase/server';
import { IntegrationPanel } from './integration-panel';
import { DailyDiscoveryPanel } from './daily-discovery-panel';

export default async function SettingsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let integrations = [];
    let dailyEnabled = false;
    let lastRunAt: string | null = null;
    let hasProfileData = false;

    if (user) {
        const [integrationsRes, profileRes, skillsRes] = await Promise.all([
            supabase
                .from('user_integrations')
                .select('*')
                .eq('user_id', user.id),
            supabase
                .from('profiles')
                .select('headline, daily_discovery_enabled, last_daily_discovery_at')
                .eq('user_id', user.id)
                .maybeSingle(),
            supabase
                .from('candidate_skills')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user.id),
        ]);

        integrations = integrationsRes.data || [];
        dailyEnabled = profileRes.data?.daily_discovery_enabled === true;
        lastRunAt = profileRes.data?.last_daily_discovery_at ?? null;

        // Same precondition the manual button uses: without profile signal there
        // is nothing to build search queries from.
        hasProfileData = Boolean(profileRes.data?.headline) || (skillsRes.count ?? 0) > 0;
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">Account Settings</h2>
                <p className="text-slate-500">Manage your account, notifications, and integrations.</p>
            </div>

            <DailyDiscoveryPanel
                initialEnabled={dailyEnabled}
                hasProfileData={hasProfileData}
                lastRunAt={lastRunAt}
            />

            {/* Injected dynamically cleanly seamlessly intuitively securely correctly smartly functionally dependably accurately stably. */}
            <IntegrationPanel integrations={integrations} />
        </div>
    );
}
