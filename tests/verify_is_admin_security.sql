-- =========================================================================
-- M8 PHASE D - FINAL SECURITY SIGN-OFF VERIFICATION SCRIPT
-- =========================================================================
-- Description: 
-- This script natively tests the 015_m8_final_security_pass.sql PostgreSQL trigger.
-- It proves that the trigger correctly isolates the `is_admin` column from
-- client tampering during both INSERT and UPDATE operations, while still
-- allowing administrative access via service_role.
-- 
-- Usage: 
-- Run this directly in your Supabase SQL Editor. 
-- It will RAISE EXCEPTION if any security boundary fails, 
-- or print 'ALL SECURITY BOUNDARY TESTS PASSED' if successful.

DO $$
DECLARE
  test_user_id UUID := gen_random_uuid();
  check_is_admin BOOLEAN;
  claims_json TEXT;
BEGIN
  -- SETUP: Create a temporary test user in auth.users securely
  INSERT INTO auth.users (id, email) VALUES (test_user_id, 'test_security@example.com');
  
  -- Create the JWT claims JSON to emulate Supabase PostgREST identical context
  claims_json := format('{"sub": "%s", "role": "authenticated"}', test_user_id::text);

  -------------------------------------------------------------------------
  -- SCENARIO 1: Authenticated User attempts to self-promote during INSERT
  -------------------------------------------------------------------------
  -- 1. Set Postgres Role cleanly
  SET LOCAL role = 'authenticated';
  -- 2. Construct the JWT Environment correctly
  PERFORM set_config('request.jwt.claims', claims_json, true);
  
  -- The user attempts to inject is_admin = true during account creation
  INSERT INTO public.profiles (user_id, name, is_admin)
  VALUES (test_user_id, 'Test Hacker', true);

  -- Retrieve the resulting row (RLS allows select for themselves)
  SELECT is_admin INTO check_is_admin FROM public.profiles WHERE user_id = test_user_id;
  
  IF check_is_admin THEN
    RAISE EXCEPTION '❌ FAILED: Authenticated user was able to INSERT is_admin = true';
  END IF;
  RAISE NOTICE '✅ PASSED: Authenticated user INSERT is_admin=true -> stored false (Trigger correctly overrode value)';

  -------------------------------------------------------------------------
  -- SCENARIO 2: Authenticated User attempts to self-promote during UPDATE
  -------------------------------------------------------------------------
  -- Reset context explicitly
  SET LOCAL role = 'authenticated';
  PERFORM set_config('request.jwt.claims', claims_json, true);
  
  -- The user attempts to mutate their own profile to become an admin
  UPDATE public.profiles SET is_admin = true WHERE user_id = test_user_id;
  
  SELECT is_admin INTO check_is_admin FROM public.profiles WHERE user_id = test_user_id;

  IF check_is_admin THEN
    RAISE EXCEPTION '❌ FAILED: Authenticated user was able to UPDATE is_admin = true';
  END IF;
  RAISE NOTICE '✅ PASSED: Authenticated user UPDATE is_admin=true -> remains false (Trigger correctly reverted value)';

  -------------------------------------------------------------------------
  -- SCENARIO 3: Trusted Service Role (Admin) attempts to promote the user
  -------------------------------------------------------------------------
  -- Emulate an internal server action / superuser modifying the row implicitly bypassing RLS
  SET LOCAL role = 'service_role';
  -- service_role does not strictly require JWT claims for RLS because it bypasses RLS naturally,
  -- but we ensure the trigger accurately permits this mutation because current_user != 'authenticated'.
  
  UPDATE public.profiles SET is_admin = true WHERE user_id = test_user_id;
  
  -- Read back (as service_role to bypass RLS)
  SELECT is_admin INTO check_is_admin FROM public.profiles WHERE user_id = test_user_id;

  IF NOT check_is_admin THEN
    RAISE EXCEPTION '❌ FAILED: service_role/admin was blocked from setting is_admin = true';
  END IF;
  RAISE NOTICE '✅ PASSED: service_role UPDATE is_admin=true -> stored true (Trigger correctly bypassed)';

  -------------------------------------------------------------------------
  -- TEARDOWN
  -------------------------------------------------------------------------
  SET LOCAL role = 'postgres';
  DELETE FROM auth.users WHERE id = test_user_id;
  
  RAISE NOTICE '🎉 ALL SECURITY BOUNDARY TESTS PASSED SUCCESSFULLY AGAINST GENUINE SUPABASE JWT CONTEXT! 🎉';
END $$;
