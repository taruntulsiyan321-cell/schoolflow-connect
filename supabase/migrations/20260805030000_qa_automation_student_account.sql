-- Dedicated, clean student account reserved for automated Playwright
-- verification. Never reuse arjun.mehta@wisdomcampus.com for this again --
-- that account now carries hundreds of sessions/bookmarks/mistakes/history
-- entries from this engagement's own testing, which makes every new
-- verification run harder to reason about (stale backlogs, ambiguous
-- "before" counts, slow queue-paging).
--
-- Clones school_id and class_id from the current arjun.mehta student row
-- rather than hardcoding a class UUID, so this account is guaranteed to
-- resolve to the same board/stream/class (Class 11-A Commerce) Practice
-- already works against, regardless of which exact class row is live.
--
-- Idempotent: fixed UUID + ON CONFLICT, safe to re-run.
--
-- _demo_upsert_auth_user() turned out NOT to be live (confirmed by running
-- this migration: "function public._demo_upsert_auth_user(...) does not
-- exist") despite being defined in supabase/SEED_DEMO_DATA.sql -- same
-- silent hand-paste-migration gap this project has hit before (missing
-- tables/functions from migrations that partially failed to apply). So
-- this migration is now self-contained: it (re)creates the helper itself,
-- verbatim from SEED_DEMO_DATA.sql, rather than assuming it already exists.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public._demo_upsert_auth_user(
  _id uuid,
  _email text,
  _password text,
  _full_name text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $helper$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _id) THEN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      _id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      lower(_email),
      extensions.crypt(_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', _full_name),
      now(), now(),
      '', '', '', ''
    );
  ELSE
    UPDATE auth.users SET
      email = lower(_email),
      encrypted_password = extensions.crypt(_password, extensions.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      raw_user_meta_data = jsonb_build_object('full_name', _full_name),
      updated_at = now()
    WHERE id = _id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities WHERE user_id = _id AND provider = 'email'
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      _id, _id,
      jsonb_build_object('sub', _id::text, 'email', lower(_email)),
      'email', _id::text,
      now(), now(), now()
    );
  END IF;
END;
$helper$;

DO $qa$
DECLARE
  _pw text := 'QaAutomation123!';
  u_qa uuid := 'da000000-0001-4000-8000-000000000001';
  _source_user uuid := 'd1000003-0001-4000-8000-000000000001'; -- arjun.mehta
  _school_id uuid;
  _class_id uuid;
  _student_id uuid;
BEGIN
  SELECT school_id, class_id INTO _school_id, _class_id
  FROM public.students
  WHERE user_id = _source_user
  LIMIT 1;

  IF _school_id IS NULL THEN
    RAISE EXCEPTION 'Could not find school_id/class_id from source student row (user_id=%) -- update _source_user in this migration to a currently-working student account first', _source_user;
  END IF;

  PERFORM public._demo_upsert_auth_user(
    u_qa, 'qa.automation@wisdomcampus.com', _pw, 'QA Automation'
  );

  INSERT INTO public.profiles (id, full_name, email, school_id)
  VALUES (u_qa, 'QA Automation', 'qa.automation@wisdomcampus.com', _school_id)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    school_id = EXCLUDED.school_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (u_qa, 'student'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- admission_number is NOT NULL UNIQUE on this table -- fixed, idempotent value.
  INSERT INTO public.students (id, user_id, school_id, class_id, full_name, admission_number, roll_number)
  VALUES (
    gen_random_uuid(), u_qa, _school_id, _class_id,
    'QA Automation', 'QA-AUTOMATION-001', 'QA-01'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    school_id = EXCLUDED.school_id,
    class_id = EXCLUDED.class_id
  RETURNING id INTO _student_id;

  RAISE NOTICE 'QA automation account ready: qa.automation@wisdomcampus.com / % (school_id=%, class_id=%)', _pw, _school_id, _class_id;
END;
$qa$;
