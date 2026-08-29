import { createClient } from '@/utils/supabase/server';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
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

            {/* Daily Job Search and Firecrawl Usage moved to Search & Discovery.
                They are linked rather than duplicated: two copies of the same
                toggle and the same snapshot invite drift and confusion about
                which one is authoritative. */}
            <Link
                href="/search-discovery"
                className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:bg-slate-50"
            >
                <span>
                    <span className="block font-semibold text-slate-900">Manage Search &amp; Discovery</span>
                    <span className="mt-0.5 block text-sm text-slate-500">
                        Daily job search, search parameters, job sources and Firecrawl usage.
                    </span>
                </span>
                <ArrowRight className="h-5 w-5 shrink-0 text-slate-400" />
            </Link>

            {/* Injected dynamically cleanly seamlessly intuitively securely correctly smartly functionally dependably accurately stably. */}
            <IntegrationPanel integrations={integrations} />
        </div>
    );
}
