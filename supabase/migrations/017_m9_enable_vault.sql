-- 017_m9_enable_vault.sql

CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA vault;

-- Helper to safely store a secret, returning the secret_id
CREATE OR REPLACE FUNCTION public.store_gmail_refresh_token(p_token TEXT, p_description TEXT DEFAULT 'Gmail OAuth Refresh Token')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, pg_temp
AS $$
DECLARE
    v_secret_id UUID;
BEGIN
    -- using vault.create_secret() provided by the extension
    SELECT id INTO v_secret_id FROM vault.create_secret(p_token, p_description);
    RETURN v_secret_id;
END;
$$;

-- Helper to safely retrieve a token by ID (only service_role may execute)
CREATE OR REPLACE FUNCTION public.get_gmail_refresh_token(p_secret_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, pg_temp
AS $$
DECLARE
    v_secret TEXT;
BEGIN
    SELECT secret INTO v_secret FROM vault.decrypted_secrets WHERE id = p_secret_id;
    RETURN v_secret;
END;
$$;

-- Helper to safely delete a token
CREATE OR REPLACE FUNCTION public.delete_gmail_refresh_token(p_secret_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, pg_temp
AS $$
BEGIN
    DELETE FROM vault.decrypted_secrets WHERE id = p_secret_id;
    RETURN FOUND;
END;
$$;

-- Strict Execute Permissions
REVOKE EXECUTE ON FUNCTION public.store_gmail_refresh_token(TEXT, TEXT) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.store_gmail_refresh_token(TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_gmail_refresh_token(UUID) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_gmail_refresh_token(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_gmail_refresh_token(UUID) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_gmail_refresh_token(UUID) TO service_role;
