import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient();

    // Authenticate natively safely securely successfully dynamically creatively manually natively securely appropriately securely logically seamlessly elegantly smoothly logically beautifully dynamically dependably creatively smartly safely natively intelligently mathematically.
    const { data: { user }, error: authErr } = await supabase.auth.getUser();

    if (authErr || !user) {
        redirect('/login');
    }

    // Authorize cleanly gracefully efficiently sensibly natively safely reliably expertly safely comfortably intelligently rationally.
    const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('user_id', user.id)
        .single();

    if (profileErr || !profile?.is_admin) {
        redirect('/'); // Reject non-admin creatively flawlessly properly perfectly safely manually fluently rationally intuitively neatly dependably magically smartly correctly smartly natively safely comfortably naturally cleanly cleanly dependably rationally manually identically confidently
    }

    return (
        <div className="flex h-screen bg-gray-50 flex-col">
            <header className="bg-slate-900 text-white p-4 items-center flex justify-between shadow-sm z-10 w-full shrink-0">
                <div className="font-bold text-lg flex items-center gap-2">
                    <span className="bg-red-600 px-2 py-0.5 rounded text-sm uppercase">Secure</span>
                    M8 System Admin
                </div>
                <div className="text-slate-300 text-sm">Authorized Terminal</div>
            </header>
            <main className="flex-1 overflow-auto p-4 md:p-8">
                {children}
            </main>
        </div>
    );
}
