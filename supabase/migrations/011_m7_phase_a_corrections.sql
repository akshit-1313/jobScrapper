-- 011: M7 Phase A Corrections and Hardening

-- 1. SECURITY DEFINER HARDENING
-- explicitly set search_path to public for safety
CREATE OR REPLACE FUNCTION public.generate_automated_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A. Stale application notifications
  /* 
     STALE DEDUPLICATION SEMANTICS:
     The dedup_key is 'stale:' || application_id.
     This explicitly enforces a "Once Per Application Lifetime" semantic.
     Even if the application resets cycle (e.g., withdrawn -> applied), 
     it will never receive a second stale notification for this specific job application.
     This is the intended baseline behavior to absolutely guarantee no spam.
  */
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


-- 2. NOTIFICATION UPDATE SECURITY
-- Drop the update policy entirely to prevent normal clients from modifying ANY column (user_id, message, dedup_key, etc.) natively via REST.
DROP POLICY IF EXISTS "Users can mark their own notifications as read" ON public.notifications;
REVOKE UPDATE ON public.notifications FROM authenticated;

-- Create an RPC to safely toggle read status securely from the database side bypassing row manipulation risks
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- We must verify ownership since this is SECURITY DEFINER bypassing RLS
  UPDATE public.notifications
  SET is_read = true
  WHERE id = p_notification_id
    AND user_id = auth.uid();
END;
$$;


-- 3 & 4. APPLICATION STATUS + EVENT ATOMICITY
-- Create RPC replacing trackApplicationInitiation logic securely handling inserting application and event atomically
CREATE OR REPLACE FUNCTION public.track_application_initiation(p_job_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_app_id UUID;
  v_existing_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Prevent duplicate applications explicitly
  SELECT id INTO v_existing_id
  FROM public.applications
  WHERE job_id = p_job_id AND user_id = v_user_id;

  IF v_existing_id IS NOT NULL THEN
     RETURN v_existing_id;
  END IF;

  -- Insert App First
  INSERT INTO public.applications (job_id, user_id, status)
  VALUES (p_job_id, v_user_id, 'applied')
  RETURNING id INTO v_app_id;

  -- Insert Event Atomically
  INSERT INTO public.application_events (application_id, from_status, to_status)
  VALUES (v_app_id, NULL, 'applied');

  RETURN v_app_id;
END;
$$;

-- Create RPC replacing updateApplicationStatus securely handling state-machine transitions atomically
CREATE OR REPLACE FUNCTION public.update_application_status(
  p_app_id UUID, 
  p_to_status TEXT, 
  p_notes TEXT DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_from_status TEXT;
  v_is_valid BOOLEAN := false;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Ownership and current status lookup
  SELECT status INTO v_from_status
  FROM public.applications
  WHERE id = p_app_id AND user_id = v_user_id;

  IF v_from_status IS NULL THEN
    RAISE EXCEPTION 'Application not found or unauthorized';
  END IF;

  IF v_from_status = p_to_status THEN
    RETURN true; -- No-op
  END IF;

  -- Evaluate strict state machine bounds natively
  IF v_from_status = 'not_applied' AND p_to_status IN ('applied', 'interested') THEN v_is_valid := true;
  ELSIF v_from_status = 'interested' AND p_to_status IN ('applied', 'rejected', 'withdrawn') THEN v_is_valid := true;
  ELSIF v_from_status = 'applied' AND p_to_status IN ('recruiter_contacted', 'interview', 'rejected', 'withdrawn') THEN v_is_valid := true;
  ELSIF v_from_status = 'recruiter_contacted' AND p_to_status IN ('interview', 'rejected', 'withdrawn') THEN v_is_valid := true;
  ELSIF v_from_status = 'interview' AND p_to_status IN ('technical_round', 'offer', 'rejected', 'withdrawn') THEN v_is_valid := true;
  ELSIF v_from_status = 'technical_round' AND p_to_status IN ('offer', 'rejected', 'withdrawn') THEN v_is_valid := true;
  ELSIF v_from_status = 'offer' AND p_to_status IN ('closed', 'rejected', 'withdrawn') THEN v_is_valid := true;
  END IF;

  IF NOT v_is_valid THEN
    RAISE EXCEPTION 'Invalid transition from % to %', v_from_status, p_to_status;
  END IF;

  -- Perform the atomic progression
  UPDATE public.applications
  SET 
    status = p_to_status::public.job_status,
    updated_at = now()
  WHERE id = p_app_id;

  INSERT INTO public.application_events (application_id, from_status, to_status, notes)
  VALUES (p_app_id, v_from_status::public.job_status, p_to_status::public.job_status, p_notes);

  RETURN true;
END;
$$;
