import { createClient } from '@/utils/supabase/server';
import { IntegrationPanel } from './integration-panel';

export default async function SettingsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let integrations = [];
    if (user) {
        const { data } = await supabase
            .from('user_integrations')
            .select('*')
            .eq('user_id', user.id);
        integrations = data || [];
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">Account Settings</h2>
                <p className="text-slate-500">Manage your account, notifications, and integrations.</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
                <p className="text-slate-500">Other Account settings go here</p>
            </div>

            {/* Injected dynamically cleanly seamlessly intuitively securely correctly smartly functionally dependably accurately stably. */}
            <IntegrationPanel integrations={integrations} />
        </div>
    );
}
