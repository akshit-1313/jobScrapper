'use server'

import { createClient } from '@/utils/supabase/server'

export async function getNotifications() {
    try {
        const supabase = await createClient()

        // 1. Authenticate user strictly
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized', data: null }
        }

        // 2. Fetch Notifications (RLS naturally bounds to user_id)
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error('Error fetching notifications:', error)
            return { success: false, error: 'Failed to fetch notifications', data: null }
        }

        return { success: true, data }
    } catch (error) {
        console.error('getNotifications Error:', error)
        return { success: false, error: 'An unexpected internal error occurred.', data: null }
    }
}

export async function getUnreadNotificationCount() {
    try {
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized', data: null }
        }

        const { count, error } = await supabase
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('is_read', false);

        if (error) {
            console.error('Error fetching unread notification count:', error)
            return { success: false, error: 'Failed to fetch notification count', data: null }
        }

        return { success: true, data: count || 0 }
    } catch (error) {
        console.error('getUnreadNotificationCount Error:', error)
        return { success: false, error: 'An unexpected internal error occurred.', data: null }
    }
}

export async function markNotificationRead(notificationId: string) {
    try {
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        // Using the approved DB RPC function
        const { error: rpcError } = await supabase.rpc('mark_notification_read', {
            p_notification_id: notificationId
        });

        if (rpcError) {
            console.error('mark_notification_read RPC error:', rpcError)
            return { success: false, error: 'Failed to mark notification as read' }
        }

        return { success: true }
    } catch (error) {
        console.error('markNotificationRead Error:', error)
        return { success: false, error: 'An unexpected internal error occurred.' }
    }
}
