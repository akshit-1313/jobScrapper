-- 010: Notifications and automated pg_cron architecture for M7

-- 1. Applications extension
ALTER TABLE public.applications 
ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ;

-- 2. Notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  reference_id UUID, 
  dedup_key TEXT UNIQUE NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. RLS Policies on Notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can mark their own notifications as read"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (is_read = true); -- Can only change is_read to true

-- No INSERT or DELETE policies provided publicly. Only the server/DB can generate Notifications.

-- 4. Enable pg_cron
CREATE EXTENSION IF NOT EXISTS "pg_cron" SCHEMA extensions;
-- Note: 'pg_cron' may require superuser, but in Supabase it is natively provisioned in the extensions schema on standard instances.

-- 5. Automated Procedures
CREATE OR REPLACE FUNCTION public.generate_automated_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- A. Stale application notifications
  -- Condition: status = 'applied' AND exactly 14 days passed (or more, just keeping it bounded to less than highly aged entries to prevent huge floods if turned on later, but strict rule is updated_at <= 14 days ago)
  INSERT INTO public.notifications (user_id, title, message, type, reference_id, dedup_key)
  SELECT 
    user_id,
    'Stale Application',
    'It has been 14 days since you applied. Consider following up.',
    'stale_app',
    id,
    'stale:' || id
  FROM public.applications
  WHERE status = 'applied'
    AND updated_at <= now() - interval '14 days'
  ON CONFLICT (dedup_key) DO NOTHING;

  -- B. Follow-up notifications
  -- Condition: follow_up_date <= CURRENT_DATE AND active statuses
  INSERT INTO public.notifications (user_id, title, message, type, reference_id, dedup_key)
  SELECT 
    user_id,
    'Follow up Reminder',
    'You have a scheduled follow-up today.',
    'follow_up',
    id,
    'followup:' || id || ':' || (follow_up_date::date)::text
  FROM public.applications
  WHERE follow_up_date <= CURRENT_DATE
    AND status IN ('applied', 'interested', 'recruiter_contacted', 'interview', 'technical_round', 'offer')
  ON CONFLICT (dedup_key) DO NOTHING;

END;
$$;

-- 6. Schedule pg_cron
-- We wrap in an anonymous block to safely handle if it already exists or if pg_cron is available
DO $$
BEGIN
  -- Assumes pg_cron is accessible
  PERFORM cron.schedule('daily-notifications-cron', '0 0 * * *', 'SELECT public.generate_automated_notifications();');
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'pg_cron extension not fully registered in this block, skipping direct schedule bind.';
END $$;
