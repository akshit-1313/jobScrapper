'use client';

import { useState } from 'react';
import { initiateGmailConnection, disconnectGmail } from '@/app/actions/integrations-actions';

interface Integration {
    id: string;
    provider: string;
    provider_account_id: string;
    status: string;
}

export function IntegrationPanel({ integrations }: { integrations: Integration[] }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const activeGmail = integrations.find(i => i.provider === 'gmail' && i.status === 'active');

    const handleConnect = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await initiateGmailConnection();
            if (res.success && res.url) {
                window.location.href = res.url;
            } else {
                setError(res.error || 'Failed to connect.');
                setLoading(false);
            }
        } catch (e: any) {
            setError('System error establishing connection.');
            setLoading(false);
        }
    };

    const handleDisconnect = async (id: string) => {
        setLoading(true);
        setError('');
        try {
            const res = await disconnectGmail(id);
            if (res.success) {
                window.location.reload();
            } else {
                setError(res.error || 'Failed to disconnect.');
                setLoading(false);
            }
        } catch (e: any) {
            setError('System error tearing down connection.');
            setLoading(false);
        }
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm mt-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Integrations</h3>

            {error && (
                <div className="mb-4 rounded-md bg-red-50 p-4 text-sm text-red-600">
                    {error}
                </div>
            )}

            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <div>
                    <h4 className="font-medium text-slate-900">Gmail</h4>
                    <p className="text-sm text-slate-500">
                        {activeGmail
                            ? `Connected as ${activeGmail.provider_account_id}`
                            : 'Connect Gmail to enable AI-powered email discovery.'}
                    </p>
                </div>

                {activeGmail ? (
                    <button
                        onClick={() => handleDisconnect(activeGmail.id)}
                        disabled={loading}
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                        {loading ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                ) : (
                    <button
                        onClick={handleConnect}
                        disabled={loading}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {loading ? 'Connecting...' : 'Connect Gmail'}
                    </button>
                )}
            </div>
        </div>
    );
}
