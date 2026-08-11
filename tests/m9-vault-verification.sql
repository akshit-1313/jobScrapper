-- tests/m9-vault-verification.sql
DO $$ 
DECLARE
    v_ext_name TEXT;
    v_schema TEXT;
BEGIN
    RAISE NOTICE 'Verifying Supabase Vault Extension...';
    
    -- Does the extension exist?
    SELECT extname, nspname INTO v_ext_name, v_schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE extname = 'supabase_vault';

    IF v_ext_name IS NULL THEN
        RAISE EXCEPTION 'SECURITY_VIOLATION: supabase_vault extension is NOT enabled.';
    END IF;

    IF v_schema != 'vault' THEN
        RAISE EXCEPTION 'SECURITY_VIOLATION: supabase_vault must be in the vault schema.';
    END IF;

    RAISE NOTICE 'Vault correctly architected.';
END $$;
