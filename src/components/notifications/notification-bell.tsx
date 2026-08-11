'use client'

import React, { useEffect, useState, useRef } from 'react'
import { Bell, CheckCircle, ExternalLink, RefreshCw } from 'lucide-react'
import { getNotifications, getUnreadNotificationCount, markNotificationRead } from '@/app/actions/notification-actions'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'

// Extend to represent the database row securely
type NotificationData = {
    id: string;
    title: string;
    message: string;
    type: string;
    reference_id: string | null;
    is_read: boolean;
    created_at: string;
}

export function NotificationBell() {
    const [open, setOpen] = useState(false)
    const [mounted, setMounted] = useState(false)

    const [notifications, setNotifications] = useState<NotificationData[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const popoverRef = useRef<HTMLDivElement>(null)

    // Click outside to close
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // Polling and initial fetch securely enforcing Server Bounds
    useEffect(() => {
        setMounted(true)
        const fetchInitialState = async () => {
            const { data } = await getUnreadNotificationCount()
            if (typeof data === 'number') {
                setUnreadCount(data)
            }
        }

        fetchInitialState()

        // Poll every 30s as explicitly instructed for refreshing safely
        const interval = setInterval(fetchInitialState, 30000)
        return () => clearInterval(interval)
    }, [])

    // Hydrate notification list when explicitly opened to spare RPC calls efficiently
    useEffect(() => {
        if (!open) return;

        const loadNotifications = async () => {
            setLoading(true)
            setError(null)

            const { data, success, error: fetchErr } = await getNotifications()
            if (!success || fetchErr) {
                setError(fetchErr || 'Failed to load notifications')
            } else if (data) {
                setNotifications(data as NotificationData[])
            }

            setLoading(false)
        }
        loadNotifications()
    }, [open])

    const handleNotificationClick = async (notif: NotificationData) => {
        // Enforce DB read state bound actively bypassing arbitrary requests
        if (!notif.is_read) {
            const { success } = await markNotificationRead(notif.id)
            if (success) {
                setUnreadCount(prev => Math.max(0, prev - 1))
                setNotifications(prev => prev.map(n =>
                    n.id === notif.id ? { ...n, is_read: true } : n
                ))
            }
        }
        setOpen(false) // auto close
    }

    const getLinkUrl = (notif: NotificationData) => {
        if (!notif.reference_id) return '#';

        // Follow routing bounds enforced per notification type structurally
        if (notif.type === 'match_alert') {
            return `/jobs/${notif.reference_id}`
        }
        if (notif.type === 'follow_up' || notif.type === 'stale_app') {
            // Integrate with deep-linking on Applications Kanban
            return `/applications?appId=${notif.reference_id}`
        }

        return '#'
    }

    if (!mounted) {
        return (
            <button className="relative p-2 text-slate-400 transition-colors pointer-events-none">
                <Bell className="h-5 w-5 opacity-50" />
            </button>
        )
    }

    return (
        <div className="relative" ref={popoverRef}>
            <button
                onClick={() => setOpen(!open)}
                className={`relative p-2 transition-colors rounded-full ${open ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                aria-label="Notifications"
            >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex h-2.5 w-2.5 items-center justify-center">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-blue-500 text-[8px] font-bold text-white">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white shadow-lg ring-1 ring-black ring-opacity-5 overflow-hidden z-50 flex flex-col max-h-[85vh]">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-slate-50">
                        <h3 className="font-semibold text-slate-800">Notifications</h3>
                        {unreadCount > 0 && (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                {unreadCount} unread
                            </span>
                        )}
                    </div>

                    <div className="overflow-y-auto flex-1 p-2 space-y-1">
                        {loading && (
                            <div className="flex flex-col items-center justify-center py-8 text-slate-400 gap-2">
                                <RefreshCw className="h-5 w-5 animate-spin" />
                                <span className="text-sm">Loading...</span>
                            </div>
                        )}

                        {error && (
                            <div className="p-4 text-center text-sm text-red-600">
                                {error}
                            </div>
                        )}

                        {!loading && !error && notifications.length === 0 && (
                            <div className="p-8 text-center flex flex-col items-center">
                                <CheckCircle className="h-10 w-10 text-emerald-400 mb-3" />
                                <p className="text-slate-900 font-medium">All caught up!</p>
                                <p className="text-slate-500 text-sm mt-1">Check back later for new alerts.</p>
                            </div>
                        )}

                        {!loading && !error && notifications.map((notif) => {
                            const destUrl = getLinkUrl(notif)

                            return (
                                <Link
                                    key={notif.id}
                                    href={destUrl}
                                    onClick={() => handleNotificationClick(notif)}
                                    className={`block text-left p-3 rounded-lg transition-colors border ${!notif.is_read ? 'bg-blue-50/50 border-blue-100/50' : 'bg-white border-transparent hover:bg-slate-50'}`}
                                >
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-1.5">
                                                <span className={`text-sm font-semibold flex-1 ${!notif.is_read ? 'text-slate-900' : 'text-slate-700'}`}>
                                                    {notif.title}
                                                </span>
                                                {!notif.is_read && (
                                                    <span className="h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0 mt-1"></span>
                                                )}
                                            </div>
                                            <p className={`text-xs mt-1 leading-relaxed line-clamp-2 ${!notif.is_read ? 'text-slate-700' : 'text-slate-500'}`}>
                                                {notif.message}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                        <span className="text-[10px] uppercase font-semibold text-slate-400">
                                            {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                                        </span>

                                        {notif.reference_id && (
                                            <span className="inline-flex items-center text-[10px] font-medium tracking-wide text-blue-600">
                                                View Details <ExternalLink className="ml-1 h-3 w-3" />
                                            </span>
                                        )}
                                    </div>
                                </Link>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
