-- 015: M8 Final Security Sign-off

-- 1. Prevent self-escalation via normal profile updates OR inserts
-- The existing RLS policy allows authenticated users to UPDATE and INSERT their own profile.
-- We must ensure they cannot maliciously flip `is_admin` in the payload.

CREATE OR REPLACE FUNCTION public.prevent_is_admin_escalation()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if the current executing Postgres role is 'authenticated' 
  -- (which PostgREST explicitly SETs for all logged-in web/mobile client requests)
  IF current_user = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
        NEW.is_admin := false;
    ELSIF TG_OP = 'UPDATE' THEN
        NEW.is_admin := OLD.is_admin;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- NOTE: Removed SECURITY DEFINER intentionally. This trigger runs as SECURITY INVOKER (the default).
-- Running as the invoker explicitly forces `current_user` to evaluate as the role PostgREST set natively (e.g. 'authenticated', 'anon', 'service_role'),
-- meaning we avoid dangerous privilege elevation logic while securely locking down mutations.

DROP TRIGGER IF EXISTS block_is_admin_update ON public.profiles;

CREATE TRIGGER block_is_admin_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_is_admin_escalation();

DROP TRIGGER IF EXISTS block_is_admin_insert ON public.profiles;

CREATE TRIGGER block_is_admin_insert
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_is_admin_escalation();
