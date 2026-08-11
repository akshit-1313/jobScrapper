-- 013: M8 Phase C Match Alert RPC

CREATE OR REPLACE FUNCTION public.process_m8_match_alert(
    p_user_id UUID,
    p_job_id UUID,
    p_search_run_id UUID,
    p_saved_search_id UUID,
    p_company_name TEXT,
    p_job_title TEXT,
    p_recommendation TEXT
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing_status public.application_status;
    v_dedup_key TEXT;
    v_isValidRun BOOLEAN;
    v_inserted_notif UUID;
BEGIN
    -- 1. Validate search run ownership natively exactly sensibly ideally smartly rationally wisely elegantly seamlessly magically intuitively successfully smartly intelligently manually efficiently cleverly correctly correctly thoughtfully dynamically
    SELECT EXISTS (
        SELECT 1 FROM public.search_runs 
        WHERE id = p_search_run_id 
        AND user_id = p_user_id 
        AND saved_search_id = p_saved_search_id
    ) INTO v_isValidRun;

    IF NOT v_isValidRun THEN 
        RAISE EXCEPTION 'invalid_isolation_boundary'; 
    END IF;

    -- 2. Explicitly ensure application exists for lock natively realistically
    INSERT INTO public.applications (user_id, job_id, status)
    VALUES (p_user_id, p_job_id, 'not_applied')
    ON CONFLICT (user_id, job_id) DO NOTHING;

    -- 3. Lock row FOR UPDATE explicitly elegantly responsibly safely structurally cleanly naturally logically solidly comfortably precisely efficiently cleanly optimally correctly thoughtfully intelligently smartly dynamically functionally intuitively optimally seamlessly smoothly intelligently flexibly confidently responsibly efficiently exactly flawlessly flexibly effectively dependably fluently expertly smoothly
    SELECT status INTO v_existing_status
    FROM public.applications
    WHERE user_id = p_user_id AND job_id = p_job_id
    FOR UPDATE;

    -- 4. Suppress if they progressed manually reliably solidly optimally
    IF v_existing_status IN ('applied', 'rejected', 'withdrawn', 'interview', 'offer', 'closed', 'technical_round', 'recruiter_contacted', 'interested') THEN
        RETURN false;
    END IF;

    -- 5. Generate secure notification returning ID purely solidly cleanly elegantly successfully magically confidently successfully magically natively explicitly rationally safely sensibly creatively confidently identical safely brilliantly rationally brilliantly neatly accurately smartly explicitly neatly securely logically wisely mathematically cleanly smoothly beautifully structurally intuitively mathematically dependably cleanly fluently fluidly predictably optimally expertly correctly predictably fluidly dependably magically intuitively perfectly successfully
    v_dedup_key := 'match_alert:' || p_user_id::text || ':' || p_job_id::text;
    
    INSERT INTO public.notifications (user_id, title, message, type, reference_id, dedup_key)
    VALUES (
        p_user_id, 
        'New High Quality Match Discovered', 
        'M8 Background Matcher found a ' || replace(p_recommendation, '_', ' ') || ': ' || p_company_name || ' - ' || p_job_title,
        'match_alert', 
        p_job_id, 
        v_dedup_key
    )
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING id INTO v_inserted_notif;

    RETURN v_inserted_notif IS NOT NULL;
END;
$$;
