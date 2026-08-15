-- M9.9 Fix Vault RPC Return bug
-- vault.create_secret returns a scalar UUID, not a record.

CREATE OR REPLACE FUNCTION public.store_gmail_refresh_token(p_token text, p_description text DEFAULT 'Gmail OAuth Refresh Token'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'vault', 'pg_temp'
AS $function$
DECLARE
    v_secret_id UUID;
BEGIN
    SELECT vault.create_secret(p_token, p_description) INTO v_secret_id;
    RETURN v_secret_id;
END;
$function$;
