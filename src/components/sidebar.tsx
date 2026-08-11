'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    LayoutDashboard,
    Briefcase,
    Bookmark,
    Send,
    User,
    Settings,
    SlidersHorizontal,
    Search
} from 'lucide-react'

const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Discover Jobs', href: '/jobs', icon: Search },
    { name: 'Saved', href: '/saved', icon: Bookmark },
    { name: 'Applications', href: '/applications', icon: Send },
    { name: 'Profile', href: '/profile', icon: User },
    { name: 'Preferences', href: '/preferences', icon: SlidersHorizontal },
    { name: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
    const pathname = usePathname()

    return (
        <div className="flex w-64 flex-col border-r border-slate-200 bg-white/50 backdrop-blur-xl h-screen sticky top-0">
            <div className="flex h-16 items-center px-6 border-b border-slate-200">
                <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-md">
                        <Search className="h-5 w-5" />
                    </div>
                    <span className="text-lg font-bold tracking-tight text-slate-900">JobDiscovery</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto py-6">
                <nav className="space-y-1.5 px-3">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${isActive
                                        ? 'bg-blue-50 text-blue-700 shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                    }`}
                            >
                                <item.icon className={`h-5 w-5 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                                {item.name}
                            </Link>
                        )
                    })}
                </nav>
            </div>

            <div className="p-4 border-t border-slate-200">
                <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
                    <p className="text-xs font-medium text-slate-500 mb-1">AI Engine Status</p>
                    <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
                        <span className="text-sm font-semibold text-slate-700">Active & Syncing</span>
                    </div>
                </div>
            </div>
        </div>
    )
}
