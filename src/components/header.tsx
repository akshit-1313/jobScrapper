'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NotificationBell } from '@/components/notifications/notification-bell'

export function Header() {
    const router = useRouter()
    const supabase = createClient()
    const [email, setEmail] = useState<string | null>(null)

    useEffect(() => {
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                setEmail(user.email ?? null)
            }
        }
        getUser()
    }, [supabase])

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        router.push('/login')
        router.refresh()
    }

    return (
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/70 px-6 backdrop-blur-md">
            <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-800 hidden md:block">
                    Welcome back
                </h1>
            </div>

            <div className="flex items-center gap-4">
                <NotificationBell />

                <div className="h-8 w-px bg-slate-200"></div>

                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500 to-blue-500 text-white shadow-sm ring-2 ring-white">
                        <span className="text-sm font-bold">{email?.[0].toUpperCase() ?? 'U'}</span>
                    </div>
                    <div className="hidden flex-col md:flex">
                        <span className="text-sm font-medium text-slate-700">{email ?? 'User'}</span>
                        <span className="text-xs text-slate-500">Candidate Profile</span>
                    </div>
                </div>

                <button
                    onClick={handleSignOut}
                    className="ml-2 rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    title="Sign out"
                >
                    <LogOut className="h-5 w-5" />
                </button>
            </div>
        </header>
    )
}
